// Debugging function with timestamp
function debug(message, data = null) {
  const timestamp = new Date().toISOString();
  const logMessage = `[Edge Redirector ${timestamp}] ${message}`;
  console.log(logMessage, data || '');
}

debug("Extension background script loaded");

// Track active redirects to prevent duplicates
// Map<tabId, { url: string, cancel: boolean }> — stores the decision so webRequest can enforce it
const activeRedirects = new Map();

// Synchronous cache of extension settings to avoid async gaps in blocking listeners.
// Updated on startup, on storage changes, and after each async read.
let cachedDomainsList = [];
let cachedOpenMode = "edgeOnly";
let cachedAskConfirmation = false;
let cacheInitialized = false;

// Marker used in URL hash to bypass the redirect check (prevents infinite redirect loops)
const BYPASS_HASH = "edgeredirect_bypass";

// Load settings into the synchronous cache
async function refreshCache() {
  try {
    const result = await browser.storage.sync.get(["domainsList", "askForConfirmation", "openMode"]);
    cachedDomainsList = result.domainsList || [];
    cachedAskConfirmation = result.askForConfirmation !== false;
    cachedOpenMode = result.openMode || "edgeOnly";
    cacheInitialized = true;
    debug("Cache refreshed", { domains: cachedDomainsList.length, mode: cachedOpenMode, confirm: cachedAskConfirmation });
  } catch (e) {
    debug("Failed to refresh cache, using defaults", e);
    cacheInitialized = true;
  }
}

// Synchronously check if a URL matches the cached domain list
function isMatchingDomainSync(url) {
  try {
    const hostname = new URL(url).hostname;
    const cleanHostname = hostname.replace(/^www\./, '');
    return cachedDomainsList.some(domain => {
      const cleanDomain = domain.replace(/^www\./, '');
      return cleanHostname === cleanDomain || cleanHostname.endsWith('.' + cleanDomain);
    });
  } catch (e) {
    return false;
  }
}

// Helper: open a URL in Edge using an off-screen popup window.
// Using windows.create({type:"popup"}) instead of tabs.create() prevents the
// double-trigger issue where tabs.create with a protocol URL opens both an
// empty tab and the desired page in Edge.
async function openInEdge(url) {
  try {
    const edgeUrl = "microsoft-edge:" + url;
    const popup = await browser.windows.create({
      url: edgeUrl,
      type: "popup",
      width: 1,
      height: 1,
      left: -9999,
      top: -9999
    });
    setTimeout(async () => {
      try {
        await browser.windows.remove(popup.id);
        debug("Removed transient popup window", popup.id);
      } catch (e) {
        debug("Failed to remove transient popup window", e);
      }
    }, 500);
    debug("Launched Edge via transient popup window", { edgeUrl, windowId: popup.id });
  } catch (error) {
    debug("Error opening in Edge", error);
  }
}

// Shared function to handle redirection logic.
// Returns { cancel: boolean } — the webRequest listener uses this to block or allow the request.
async function handlePotentialRedirect(url, tabId, requestType = 'navigation') {
  // Bypass: if the URL contains the special bypass hash, skip all redirect logic.
  if (url.includes(BYPASS_HASH)) {
    debug("Bypass hash detected, allowing navigation");
    activeRedirects.delete(tabId);
    return { cancel: false };
  }

  // If we already have a decision for this exact URL+tab, return it.
  if (activeRedirects.has(tabId)) {
    const prev = activeRedirects.get(tabId);
    if (prev.url === url) {
      debug(`Reusing prior decision for tab ${tabId}`, prev);
      return prev;
    }
    // Different URL on same tab — stale entry, remove it.
    debug(`URL changed for tab ${tabId}: ${prev.url} → ${url}, clearing stale entry`);
    activeRedirects.delete(tabId);
  }

  // ---- Synchronous pre-check using cached domains ----
  // This runs before any async work so that the blocking webRequest listener
  // gets the correct tentative decision immediately.
  const matchesSync = isMatchingDomainSync(url);
  const tentativeCancel = matchesSync && cachedOpenMode === "edgeOnly";
  
  if (matchesSync) {
    activeRedirects.set(tabId, { url: url, cancel: tentativeCancel });
    debug(`Sync pre-check: matches domain, tentative cancel=${tentativeCancel} for tab ${tabId}`);
  } else {
    // Not a matching domain — allow the navigation.
    // Don't set a tentative entry; webRequest will see no entry and allow.
    debug(`Sync pre-check: domain not in cache, allowing navigation for tab ${tabId}`);
    // Don't return yet — we still need to do the async check for latest settings
  }

  // ---- Async check with latest settings from storage ----
  try {
    const result = await browser.storage.sync.get(["domainsList", "askForConfirmation", "openMode"]);
    debug("Retrieved storage values", result);
    
    // Update cache with latest values
    const domainsList = result.domainsList || [];
    const askForConfirmation = result.askForConfirmation !== false;
    const openMode = result.openMode || "edgeOnly";
    cachedDomainsList = domainsList;
    cachedAskConfirmation = askForConfirmation;
    cachedOpenMode = openMode;

    // Re-check domain match with latest settings
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname;
    const cleanHostname = hostname.replace(/^www\./, '');

    const shouldRedirect = domainsList.some(domain => {
      const cleanDomain = domain.replace(/^www\./, '');
      return cleanHostname === cleanDomain || cleanHostname.endsWith('.' + cleanDomain);
    });

    debug(`Async check: shouldRedirect=${shouldRedirect}, matchesSync=${matchesSync}`);

    if (shouldRedirect) {
      const shouldCancel = openMode === "edgeOnly";
      activeRedirects.set(tabId, { url: url, cancel: shouldCancel });
      debug(`Final decision for tab ${tabId}: cancel=${shouldCancel}`);

      if (askForConfirmation) {
        debug("Navigating to confirmation page");
        const confirmUrl = browser.runtime.getURL("confirm.html") + 
                         "?url=" + encodeURIComponent(url) +
                         "&openMode=" + encodeURIComponent(openMode);
        await browser.tabs.update(tabId, { url: confirmUrl });
      } else {
        debug("Opening directly in Edge");
        await openInEdge(url);
      }

      return { cancel: shouldCancel };
    }
    
    // Domain doesn't match in the latest settings either.
    // If sync check matched but async doesn't (settings changed mid-request),
    // we need to undo the tentative cancel.
    if (matchesSync) {
      debug(`Settings changed: domain removed. Undoing tentative cancel for tab ${tabId}`);
      activeRedirects.set(tabId, { url: url, cancel: false });
      // Re-navigate in case webRequest already cancelled based on tentative entry
      const bypassUrl = url + (url.includes('#') ? '&' + BYPASS_HASH : '#' + BYPASS_HASH);
      setTimeout(() => {
        browser.tabs.update(tabId, { url: bypassUrl }).catch(e => {
          debug("Error re-navigating after undo", e);
        });
      }, 100);
      return { cancel: false };
    }
    
    // Not a match in either check — allow
    return { cancel: false };
  } catch (error) {
    debug("Error in handlePotentialRedirect", error);
    // On error, clear tentative entry and allow
    if (activeRedirects.has(tabId)) {
      activeRedirects.set(tabId, { url: url, cancel: false });
    }
    return { cancel: false };
  }
}

// Web Navigation Listener — detects navigation to matching domains
// and either shows confirmation or launches Edge directly.
browser.webNavigation.onBeforeNavigate.addListener(async (details) => {
  debug("webNavigation.onBeforeNavigate event", details);
  await handlePotentialRedirect(details.url, details.tabId, 'navigation');
}, {
  url: [{ schemes: ["http", "https"] }]
});

// Web Request Listener — enforces the cancel/allow decision by
// producing a blocking response. It checks for decisions made by
// the navigation listener or handles the redirect itself.
browser.webRequest.onBeforeRequest.addListener(async (details) => {
  debug("webRequest.onBeforeRequest event", details);
  
  if (details.type !== "main_frame") {
    return { cancel: false };
  }

  // Check if a decision has already been made for this tab+URL
  if (activeRedirects.has(details.tabId)) {
    const decision = activeRedirects.get(details.tabId);
    if (decision.url === details.url) {
      debug(`Enforcing decision for tab ${details.tabId}`, decision);
      return decision;
    }
    // URL mismatch — the tab navigated to a different URL.
    debug(`URL mismatch: stored=${decision.url}, current=${details.url}`);
  }

  // No prior exact decision. Use synchronous cache to make an immediate call.
  // This handles the race where webRequest fires before the navigation
  // listener has finished its async storage read.
  if (!cacheInitialized) {
    debug("Cache not initialized, allowing by default");
    return { cancel: false };
  }

  // Check bypass hash first
  if (details.url.includes(BYPASS_HASH)) {
    return { cancel: false };
  }

  const matchesSync = isMatchingDomainSync(details.url);
  if (matchesSync && cachedOpenMode === "edgeOnly") {
    // Set tentative entry so the navigation listener reuses it
    activeRedirects.set(details.tabId, { url: details.url, cancel: true });
    debug(`Sync check in webRequest: matching domain, edgeOnly, cancelling tab ${details.tabId}`);
    return { cancel: true };
  }

  // Either not a matching domain, or openMode is "both"
  debug(`Sync check in webRequest: allowing for tab ${details.tabId}`);
  return { cancel: false };
}, {
  urls: ["<all_urls>"],
  types: ["main_frame"]
}, ["blocking"]);

// Clean up tracking data when tabs are closed
browser.tabs.onRemoved.addListener((tabId) => {
  if (activeRedirects.has(tabId)) {
    activeRedirects.delete(tabId);
    debug(`Tab ${tabId} closed - removed from active redirects`);
  }
});

// Extension lifecycle events
browser.runtime.onInstalled.addListener(async (details) => {
  debug("Extension installed/updated", details);
  await refreshCache();
});

// Keep cache in sync with storage
browser.storage.onChanged.addListener((changes, area) => {
  debug("Storage changed", { area, changes });
  if (changes.domainsList) {
    cachedDomainsList = changes.domainsList.newValue || [];
  }
  if (changes.openMode) {
    cachedOpenMode = changes.openMode.newValue || "edgeOnly";
  }
  if (changes.askForConfirmation) {
    cachedAskConfirmation = changes.askForConfirmation.newValue !== false;
  }
});

// Message handler — receives commands from confirm.js
browser.runtime.onMessage.addListener(async (message, sender) => {
  if (message.action === "openInEdge") {
    debug("Message: openInEdge", { url: message.url });
    await openInEdge(message.url);
    
    if (message.closeTab && sender.tab && sender.tab.id) {
      // Small delay ensures the protocol handler fires before the tab closes
      setTimeout(async () => {
        try {
          await browser.tabs.remove(sender.tab.id);
          debug("Closed confirm tab", { tabId: sender.tab.id });
        } catch (e) {
          debug("Failed to close confirm tab", e);
        }
      }, 300);
    }
  }
});

// Initialize cache on startup
refreshCache();