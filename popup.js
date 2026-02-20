document.addEventListener('DOMContentLoaded', async () => {
  const btnStart = document.getElementById('btn-start');
  const btnStop = document.getElementById('btn-stop');
  const btnExport = document.getElementById('btn-export');
  const btnClear = document.getElementById('btn-clear');
  const countEl = document.getElementById('count');
  const statusEl = document.getElementById('status');
  const progressEl = document.getElementById('progress');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');
  const notOnPage = document.getElementById('not-on-page');
  const scrollDelay = document.getElementById('scroll-delay');
  const debugLog = document.getElementById('debug-log');

  function log(msg) {
    const line = document.createElement('div');
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    debugLog.appendChild(line);
    debugLog.scrollTop = debugLog.scrollHeight;
    console.log('[LinkedIn Exporter Popup]', msg);
  }

  // Find the LinkedIn connections tab across all windows
  async function findConnectionsTab() {
    const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/mynetwork/invite-connect/connections/*' });
    return tabs.length > 0 ? tabs[0] : null;
  }

  // Ensure content script is injected (handles SPA navigation, pre-existing tabs, etc.)
  async function ensureContentScript(tabId) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
      if (response && response.ok) {
        log('Content script already active.');
        return true;
      }
    } catch {
      // Content script not loaded — inject it
      log('Content script not found, injecting...');
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
      log('Content script injected successfully.');
      // Give it a moment to initialize
      await new Promise(r => setTimeout(r, 500));
      return true;
    } catch (e) {
      log('ERROR injecting content script: ' + e.message);
      return false;
    }
  }

  let connectionsTab = await findConnectionsTab();

  function updatePageWarning() {
    if (!connectionsTab) {
      notOnPage.classList.remove('hidden');
    } else {
      notOnPage.classList.add('hidden');
    }
  }

  updatePageWarning();

  async function updateCount() {
    const result = await chrome.storage.local.get(['connections']);
    const connections = result.connections || {};
    const count = Object.keys(connections).length;
    countEl.textContent = count;
    return count;
  }

  async function updateState() {
    const result = await chrome.storage.local.get(['scrapeState']);
    const state = result.scrapeState || 'idle';
    statusEl.textContent = state === 'scraping' ? 'Scraping...' : 'Idle';
    if (state === 'scraping') {
      btnStart.classList.add('hidden');
      btnStop.classList.remove('hidden');
      progressEl.classList.remove('hidden');
    } else {
      btnStart.classList.remove('hidden');
      btnStop.classList.add('hidden');
      progressEl.classList.add('hidden');
    }
  }

  await updateCount();
  await updateState();

  // Poll for updates while the window is open
  const pollInterval = setInterval(async () => {
    await updateCount();
    await updateState();
    connectionsTab = await findConnectionsTab();
    updatePageWarning();
    const result = await chrome.storage.local.get(['scrapeProgress']);
    if (result.scrapeProgress) {
      progressText.textContent = result.scrapeProgress;
    }
  }, 1000);

  // Start scraping
  btnStart.addEventListener('click', async () => {
    connectionsTab = await findConnectionsTab();

    if (!connectionsTab) {
      log('No connections tab found. Opening one...');
      await chrome.tabs.create({ url: 'https://www.linkedin.com/mynetwork/invite-connect/connections/' });
      notOnPage.classList.remove('hidden');
      notOnPage.querySelector('p').textContent = 'Opening connections page... Click "Start Scraping" again once the page loads.';
      return;
    }

    log('Found connections tab: ' + connectionsTab.id);

    // Ensure content script is present
    const injected = await ensureContentScript(connectionsTab.id);
    if (!injected) {
      log('ERROR: Could not inject content script. Try refreshing the LinkedIn page.');
      return;
    }

    // Run DOM debug first
    try {
      const debugInfo = await chrome.tabs.sendMessage(connectionsTab.id, { action: 'debugDOM' });
      log('Page: ' + debugInfo.url);
      log('Selectors: ' + JSON.stringify(debugInfo.selectorResults));
      log('Profile links: ' + debugInfo.profileLinksCount);
      for (const s of debugInfo.scrollableElements) {
        if (s.isScrollable) {
          log('Scrollable: ' + s.selector + ' (' + s.scrollHeight + 'px)');
        }
      }
    } catch (e) {
      log('Debug failed: ' + e.message);
    }

    // Focus the connections tab
    await chrome.windows.update(connectionsTab.windowId, { focused: true });
    await chrome.tabs.update(connectionsTab.id, { active: true });

    const delay = parseInt(scrollDelay.value) || 1500;
    await chrome.storage.local.set({ scrapeState: 'scraping', scrapeTabId: connectionsTab.id });

    try {
      await chrome.tabs.sendMessage(connectionsTab.id, {
        action: 'startScraping',
        scrollDelay: delay
      });
      log('Scraping started with delay=' + delay + 'ms');
    } catch (e) {
      log('ERROR sending start message: ' + e.message);
      await chrome.storage.local.set({ scrapeState: 'idle' });
    }

    await updateState();
  });

  // Stop scraping
  btnStop.addEventListener('click', async () => {
    await chrome.storage.local.set({ scrapeState: 'idle' });
    connectionsTab = await findConnectionsTab();
    if (connectionsTab) {
      try {
        await chrome.tabs.sendMessage(connectionsTab.id, { action: 'stopScraping' });
      } catch {
        // content script gone, that's fine
      }
    }
    log('Scraping stopped.');
    await updateState();
  });

  // Export CSV
  btnExport.addEventListener('click', async () => {
    const result = await chrome.storage.local.get(['connections']);
    const connections = result.connections || {};
    const entries = Object.values(connections);

    if (entries.length === 0) {
      alert('No connections data to export. Start scraping first.');
      return;
    }

    const headers = [
      'Name',
      'LinkedIn Profile URL',
      'Headline',
      'Connected On (Relative)',
      'Profile Image URL',
      'Scraped At'
    ];

    const csvRows = [headers.join(',')];
    for (const entry of entries) {
      const row = [
        escapeCsv(entry.name || ''),
        escapeCsv(entry.profileUrl || ''),
        escapeCsv(entry.headline || ''),
        escapeCsv(entry.connectedTime || ''),
        escapeCsv(entry.imageUrl || ''),
        escapeCsv(entry.scrapedAt || '')
      ];
      csvRows.push(row.join(','));
    }

    const csvContent = csvRows.join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const a = document.createElement('a');
    a.href = url;
    a.download = `linkedin-connections-${timestamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    log('CSV exported: ' + entries.length + ' connections');
  });

  // Clear data
  btnClear.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all collected data?')) {
      await chrome.storage.local.remove(['connections', 'scrapeProgress']);
      await updateCount();
      log('Data cleared.');
    }
  });

  function escapeCsv(str) {
    if (str == null) return '';
    str = String(str);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  window.addEventListener('unload', () => {
    clearInterval(pollInterval);
  });

  log('Popup loaded. Connections tab: ' + (connectionsTab ? 'found' : 'NOT found'));
});
