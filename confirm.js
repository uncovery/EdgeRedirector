document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const url = params.get("url");
  const openMode = params.get("openMode") || "edgeOnly";

  document.getElementById("url").textContent = url;

  // Show contextual message based on open mode
  const msgEl = document.getElementById("message");
  const cancelBtn = document.getElementById("cancel");
  if (openMode === "both") {
    msgEl.textContent = "Open this link in both Firefox and Edge?";
    cancelBtn.textContent = "Open in Firefox only";
  } else {
    msgEl.textContent = "Open this link in Microsoft Edge?";
    cancelBtn.textContent = "Stay in Firefox";
  }

  // Helper: navigate to the original URL without triggering another redirect
  function navigateToOriginal() {
    // Append bypass hash to prevent the background script from re-intercepting
    const bypassHash = "#edgeredirect_bypass";
    let navUrl = url;
    try {
      const parsed = new URL(url);
      if (!parsed.hash || !parsed.hash.includes("edgeredirect_bypass")) {
        parsed.hash = (parsed.hash ? parsed.hash + bypassHash : bypassHash);
        navUrl = parsed.toString();
      }
    } catch (e) {
      // If URL parsing fails, just append the bypass hash
      navUrl = url + bypassHash;
    }
    window.location.href = navUrl;
  }

  document.getElementById("confirm").addEventListener("click", () => {
    browser.runtime.sendMessage({
      action: "openInEdge",
      url: url,
      closeTab: openMode === "edgeOnly"
    }).catch((e) => {
      // Fallback: if background is unavailable, navigate directly
      window.location.href = "microsoft-edge:" + url;
    });

    if (openMode === "both") {
      // Navigate the confirm tab to the original URL in Firefox
      navigateToOriginal();
    }
    // For edgeOnly, the background script closes this tab
  });

  document.getElementById("cancel").addEventListener("click", () => {
    navigateToOriginal();
  });
});