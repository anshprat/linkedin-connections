// Guard against double-injection when using both manifest + programmatic injection
if (!window.__linkedinExporterLoaded) {
  window.__linkedinExporterLoaded = true;

  let isRunning = false;
  let scrollDelay = 1500;

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'startScraping') {
      scrollDelay = message.scrollDelay || 1500;
      startScraping();
      sendResponse({ ok: true });
    } else if (message.action === 'stopScraping') {
      stopScraping();
      sendResponse({ ok: true });
    } else if (message.action === 'ping') {
      sendResponse({ ok: true, running: isRunning });
    } else if (message.action === 'debugDOM') {
      sendResponse(debugDOM());
    }
    return true; // keep message channel open for async
  });

  async function startScraping() {
    if (isRunning) return;
    isRunning = true;

    const debug = debugDOM();
    console.log('[LinkedIn Exporter] Starting scrape. DOM debug:', debug);
    await chrome.storage.local.set({
      scrapeProgress: `Starting... Found ${debug.cardsFound} cards on page.`,
      scrapeDebug: debug
    });

    let noNewDataCount = 0;
    let previousCount = 0;

    while (isRunning) {
      const newCount = await extractConnections();

      await chrome.storage.local.set({
        scrapeProgress: `Scrolling... ${newCount} connections found`
      });

      if (newCount === previousCount) {
        noNewDataCount++;
        if (noNewDataCount >= 5) {
          console.log('[LinkedIn Exporter] No new connections after 5 scrolls. Done.');
          await chrome.storage.local.set({
            scrapeProgress: `Done! ${newCount} connections collected.`,
            scrapeState: 'idle'
          });
          isRunning = false;
          break;
        }
      } else {
        noNewDataCount = 0;
      }
      previousCount = newCount;

      // Try multiple scroll strategies
      scrollPage();

      await sleep(scrollDelay);
      await sleep(Math.random() * 500);
    }
  }

  function scrollPage() {
    // Strategy 1: Standard window scroll
    window.scrollTo(0, document.documentElement.scrollHeight);

    // Strategy 2: Also scroll document.body (some pages use this)
    window.scrollTo(0, document.body.scrollHeight);

    // Strategy 3: Scroll the main content element if it's the scroll container
    const main = document.querySelector('main') || document.querySelector('[role="main"]');
    if (main && main.scrollHeight > main.clientHeight) {
      main.scrollTop = main.scrollHeight;
    }

    // Strategy 4: Scroll the scaffold layout container
    const scaffold = document.querySelector('.scaffold-layout__main')
      || document.querySelector('.scaffold-finite-scroll')
      || document.querySelector('[class*="scaffold"]');
    if (scaffold && scaffold.scrollHeight > scaffold.clientHeight) {
      scaffold.scrollTop = scaffold.scrollHeight;
    }

    // Strategy 5: Scroll the last visible card into view to trigger lazy load
    const lastCard = document.querySelector('.scaffold-finite-scroll__content > ul > li:last-child')
      || document.querySelector('#main ul > li.mn-connection-card:last-child')
      || document.querySelector('#main ul > li:last-child');
    if (lastCard) {
      lastCard.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }

  function stopScraping() {
    isRunning = false;
    console.log('[LinkedIn Exporter] Scraping stopped by user.');
  }

  function debugDOM() {
    // Gather diagnostic info about the page DOM
    const info = {
      url: window.location.href,
      title: document.title,
      cardsFound: 0,
      selectorResults: {},
      scrollableElements: [],
      profileLinksCount: 0,
      sampleHTML: ''
    };

    const selectors = {
      'mn-connection-card': '.mn-connection-card',
      'mn-connection-card__container': 'li.mn-connection-card__container',
      'data-view-name': '[data-view-name="connection-card"]',
      'scaffold-finite-scroll li': '.scaffold-finite-scroll__content > ul > li',
      '#main ul > li': '#main ul > li',
      '#main ul > li.mn-connection-card': '#main ul > li.mn-connection-card',
      'a[href*="/in/"]': 'a[href*="/in/"]'
    };

    for (const [name, sel] of Object.entries(selectors)) {
      const count = document.querySelectorAll(sel).length;
      info.selectorResults[name] = count;
      if (count > 0 && info.cardsFound === 0 && name !== 'a[href*="/in/"]') {
        info.cardsFound = count;
      }
    }

    info.profileLinksCount = info.selectorResults['a[href*="/in/"]'] || 0;

    // Check which elements are scrollable
    for (const sel of ['html', 'body', 'main', '[role="main"]', '.scaffold-layout__main', '.scaffold-finite-scroll']) {
      const el = document.querySelector(sel);
      if (el) {
        info.scrollableElements.push({
          selector: sel,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          isScrollable: el.scrollHeight > el.clientHeight
        });
      }
    }

    // Grab sample HTML from the first connection card for debugging
    const firstCard = document.querySelector('.mn-connection-card')
      || document.querySelector('.scaffold-finite-scroll__content > ul > li')
      || document.querySelector('#main ul > li');
    if (firstCard) {
      info.sampleHTML = firstCard.outerHTML.substring(0, 1500);
    }

    return info;
  }

  async function extractConnections() {
    const result = await chrome.storage.local.get(['connections']);
    const connections = result.connections || {};

    const cards = findConnectionCards();
    console.log(`[LinkedIn Exporter] Found ${cards.length} cards on page`);

    for (const card of cards) {
      try {
        const data = parseConnectionCard(card);
        if (data && data.profileUrl) {
          const key = data.profileUrl.split('?')[0];
          if (!connections[key]) {
            data.scrapedAt = new Date().toISOString();
            connections[key] = data;
          }
        }
      } catch (e) {
        console.warn('[LinkedIn Exporter] Error parsing card:', e);
      }
    }

    await chrome.storage.local.set({ connections });
    return Object.keys(connections).length;
  }

  function findConnectionCards() {
    // Strategy 1: Most specific — the known class for connections
    let cards = document.querySelectorAll('#main ul > li.mn-connection-card');
    if (cards.length > 0) return cards;

    // Strategy 2: Just the class
    cards = document.querySelectorAll('.mn-connection-card');
    if (cards.length > 0) return cards;

    // Strategy 3: data attribute
    cards = document.querySelectorAll('[data-view-name="connection-card"]');
    if (cards.length > 0) return cards;

    // Strategy 4: Scaffold list items
    cards = document.querySelectorAll('.scaffold-finite-scroll__content > ul > li');
    if (cards.length > 0) return cards;

    // Strategy 5: Main section list items
    cards = document.querySelectorAll('#main ul > li');
    if (cards.length > 0) return cards;

    // Strategy 6: Any list item containing a /in/ profile link
    const allListItems = document.querySelectorAll('ul > li');
    const connectionItems = [];
    for (const li of allListItems) {
      if (li.querySelector('a[href*="/in/"]')) {
        connectionItems.push(li);
      }
    }
    if (connectionItems.length > 0) return connectionItems;

    // Strategy 7: Walk up from profile links
    const containers = [];
    const profileLinks = document.querySelectorAll('a[href*="/in/"]');
    for (const link of profileLinks) {
      const card = link.closest('li') || link.closest('[class*="card"]') || link.parentElement;
      if (card && !containers.includes(card)) {
        containers.push(card);
      }
    }
    return containers;
  }

  function parseConnectionCard(card) {
    const data = {
      name: '',
      profileUrl: '',
      headline: '',
      connectedTime: '',
      imageUrl: ''
    };

    // Extract profile URL
    const profileLink = card.querySelector('a[href*="/in/"]');
    if (profileLink) {
      data.profileUrl = profileLink.href.split('?')[0];

      const nameEl = profileLink.querySelector('span[aria-hidden="true"]')
        || profileLink.querySelector('.mn-connection-card__name')
        || profileLink.querySelector('span');
      if (nameEl) {
        data.name = nameEl.textContent.trim();
      } else {
        const text = profileLink.textContent.trim();
        if (text && !text.toLowerCase().includes('view profile')) {
          data.name = text.split('\n')[0].trim();
        }
      }
    }

    if (!data.profileUrl) return null;

    // Extract headline
    const headlineEl = card.querySelector('.mn-connection-card__occupation')
      || card.querySelector('[class*="occupation"]')
      || card.querySelector('[class*="headline"]');
    if (headlineEl) {
      data.headline = headlineEl.textContent.trim();
    } else {
      const spans = card.querySelectorAll('span');
      for (const span of spans) {
        const text = span.textContent.trim();
        if (text
          && text !== data.name
          && !text.toLowerCase().includes('connected')
          && !text.toLowerCase().includes('message')
          && text.length > 5
          && text.length < 200
          && !span.querySelector('a')) {
          data.headline = text;
          break;
        }
      }
    }

    // Extract connected time
    const timeEl = card.querySelector('time')
      || card.querySelector('[class*="time"]')
      || card.querySelector('[class*="connected"]');
    if (timeEl) {
      data.connectedTime = timeEl.textContent.trim();
    } else {
      const allText = card.querySelectorAll('span, p, div');
      for (const el of allText) {
        const text = el.textContent.trim();
        if (text.toLowerCase().includes('connected') && text.length < 100) {
          data.connectedTime = text;
          break;
        }
      }
    }

    // Extract profile image
    const img = card.querySelector('img[src*="profile"]')
      || card.querySelector('img[src*="media"]')
      || card.querySelector('img');
    if (img && img.src && !img.src.includes('data:image')) {
      data.imageUrl = img.src;
    }

    return data;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  console.log('[LinkedIn Exporter] Content script loaded on:', window.location.href);
}
