// Debugging function with timestamp
function debug(message, data = null) {
  const timestamp = new Date().toISOString();
  const logMessage = `[Edge Redirector ${timestamp}] ${message}`;
  console.log(logMessage, data || '');
}

debug("Extension background script loaded");

// Track active redirects to prevent duplicates
const activeRedirects = new Set();

// Shared function to handle redirection logic
async function handlePotentialRedirect(url, tabId, requestType = 'navigation') {
  // Skip if we're already processing this tab
  if (activeRedirects.has(tabId)) {
    debug(`Skipping duplicate for tab ${tabId}`);
    return { cancel: false };
  }

  try {
    activeRedirects.add(tabId);
    debug(`Handling ${requestType} request for tab ${tabId}`, { url });

    const result = await browser.storage.sync.get(["domainsList", "askForConfirmation"]);
    debug("Retrieved storage values", result);
    
    const domainsList = result.domainsList || [];
    const askForConfirmation = result.askForConfirmation !== false;
    
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
                         "?url=" + encodeURIComponent(url);
        await browser.tabs.update(tabId, { url: confirmUrl });
      } else {
        debug("Redirecting directly to Edge");
        const edgeUrl = "microsoft-edge:" + url;
        await browser.tabs.update(tabId, { url: edgeUrl });
      }
      return { cancel: true };
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

  // Skip if this is a navigation we're already handling
  if (activeRedirects.has(details.tabId)) {
    debug(`Skipping webRequest - tab ${details.tabId} already being processed`);
    return { cancel: false };
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