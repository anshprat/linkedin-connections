// Background service worker
// Manages the standalone popout window and cleanup

let popoutWindowId = null;

chrome.runtime.onInstalled.addListener(() => {
  console.log('[LinkedIn Exporter] Extension installed.');
  chrome.storage.local.set({
    scrapeState: 'idle',
    scrapeProgress: ''
  });
});

// Open popout window when extension icon is clicked
chrome.action.onClicked.addListener(async () => {
  // If popout already exists, focus it
  if (popoutWindowId !== null) {
    try {
      const win = await chrome.windows.get(popoutWindowId);
      if (win) {
        chrome.windows.update(popoutWindowId, { focused: true });
        return;
      }
    } catch {
      // Window was closed, reset
      popoutWindowId = null;
    }
  }

  // Create a new popout window
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    width: 380,
    height: 480,
    focused: true
  });
  popoutWindowId = win.id;
});

// Track when the popout window is closed
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === popoutWindowId) {
    popoutWindowId = null;
  }
});

// Reset scrape state if the connections tab is closed while scraping
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const result = await chrome.storage.local.get(['scrapeTabId', 'scrapeState']);
  if (result.scrapeState === 'scraping' && result.scrapeTabId === tabId) {
    chrome.storage.local.set({ scrapeState: 'idle', scrapeTabId: null });
  }
});
