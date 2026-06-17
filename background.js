// Debugging function with timestamp
function debug(message, data = null) {
  const timestamp = new Date().toISOString();
  const logMessage = `[Edge Redirector ${timestamp}] ${message}`;
  console.log(logMessage, data || '');
}

debug("Extension background script loaded");

// Track active redirects to prevent duplicates
// Map<tabId, { cancel: boolean }> — stores the decision so webRequest can enforce it
const activeRedirects = new Map();

// Helper: open a URL in Edge via a temporary background tab (avoids blank tab)
async function openInEdge(url) {
  try {
    const edgeUrl = "microsoft-edge:" + url;
    // Create a non-active tab to trigger the Edge protocol handler
    const edgeTab = await browser.tabs.create({ url: edgeUrl, active: false });
    // Remove the transient tab after a brief delay to let the protocol handler fire
    setTimeout(async () => {
      try {
        await browser.tabs.remove(edgeTab.id);
      } catch (e) {
        debug("Failed to remove edge transient tab", e);
      }
    }, 500);
    debug("Launched Edge via transient tab", { edgeUrl, tabId: edgeTab.id });
  } catch (error) {
    debug("Error opening in Edge", error);
  }
}

// Shared function to handle redirection logic
// Returns { cancel: boolean } — caller passes this on to the browser API
async function handlePotentialRedirect(url, tabId, requestType = 'navigation') {
  // If already tracked, return the previously made decision
  if (activeRedirects.has(tabId)) {
    const prev = activeRedirects.get(tabId);
    debug(`Reusing prior decision for tab ${tabId}`, prev);
    return prev;
  }

  try {
    // Tentative — will be updated to true below if we decide to cancel
    activeRedirects.set(tabId, { cancel: false });
    debug(`Handling ${requestType} request for tab ${tabId}`, { url });

    const result = await browser.storage.sync.get(["domainsList", "askForConfirmation", "openMode"]);
    debug("Retrieved storage values", result);
    
    const domainsList = result.domainsList || [];
    const askForConfirmation = result.askForConfirmation !== false;
    const openMode = result.openMode || "edgeOnly";
    
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname;
    
    debug("Checking URL against domains list", {
      hostname: hostname,
      domainsList: domainsList
    });

    // Check if current domain matches any in the list or is a subdomain
    const shouldRedirect = domainsList.some(domain => {
      const cleanDomain = domain.replace(/^www\./, '');
      const cleanHostname = hostname.replace(/^www\./, '');
      
      if (cleanHostname === cleanDomain) {
        debug(`Exact match found: ${cleanHostname} === ${cleanDomain}`);
        return true;
      }
      
      if (cleanHostname.endsWith('.' + cleanDomain)) {
        debug(`Subdomain match found: ${cleanHostname} ends with .${cleanDomain}`);
        return true;
      }
      
      return false;
    });

    debug(`Should redirect: ${shouldRedirect}`);

    if (shouldRedirect) {
      if (askForConfirmation) {
        debug("Preparing confirmation page");
        const confirmUrl = browser.runtime.getURL("confirm.html") + 
                         "?url=" + encodeURIComponent(url) +
                         "&openMode=" + encodeURIComponent(openMode);
        await browser.tabs.update(tabId, { url: confirmUrl });
      } else {
        debug("Redirecting to Edge (openMode: " + openMode + ")");
        await openInEdge(url);
      }

      // Cancel Firefox navigation only when openMode is "edgeOnly"
      const decision = { cancel: openMode === "edgeOnly" };
      activeRedirects.set(tabId, decision); // persist for webRequest
      return decision;
    }
  } catch (error) {
    debug("Error in handlePotentialRedirect", error);
  } finally {
    // Clean up after a short delay to catch any follow-up requests
    setTimeout(() => {
      activeRedirects.delete(tabId);
      debug(`Cleared tab ${tabId} from active redirects`);
    }, 1000);
  }
  return { cancel: false };
}

// Web Navigation Listener
browser.webNavigation.onBeforeNavigate.addListener(async (details) => {
  debug("webNavigation.onBeforeNavigate event", details);
  
  await handlePotentialRedirect(details.url, details.tabId, 'navigation');
}, {
  url: [{ schemes: ["http", "https"] }]
});

// Web Request Listener
browser.webRequest.onBeforeRequest.addListener(async (details) => {
  debug("webRequest.onBeforeRequest event", details);
  
  if (details.type !== "main_frame") {
    debug("Skipping - not a main frame request");
    return { cancel: false };
  }

  // Reuse the navigation listener's decision if already tracked
  if (activeRedirects.has(details.tabId)) {
    const decision = activeRedirects.get(details.tabId);
    debug(`Reusing navigation decision for tab ${details.tabId}`, decision);
    return decision;
  }

  return await handlePotentialRedirect(details.url, details.tabId, 'request');
}, {
  urls: ["<all_urls>"],
  types: ["main_frame"]
}, ["blocking"]);

// Clean up when tabs are closed
browser.tabs.onRemoved.addListener((tabId) => {
  if (activeRedirects.has(tabId)) {
    activeRedirects.delete(tabId);
    debug(`Tab ${tabId} closed - removed from active redirects`);
  }
});

// Extension lifecycle events
browser.runtime.onInstalled.addListener((details) => {
  debug("Extension installed/updated", details);
});

browser.storage.onChanged.addListener((changes, area) => {
  debug("Storage changed", { area, changes });
});

// Message handler for confirm.js to launch Edge and close/navigate tabs
browser.runtime.onMessage.addListener(async (message, sender) => {
  if (message.action === "openInEdge") {
    await openInEdge(message.url);
    // Close the confirm tab that sent this message (if edgeOnly mode)
    if (message.closeTab && sender.tab && sender.tab.id) {
      try {
        await browser.tabs.remove(sender.tab.id);
        debug("Closed confirm tab", { tabId: sender.tab.id });
      } catch (e) {
        debug("Failed to close confirm tab", e);
      }
    }
  }
});
