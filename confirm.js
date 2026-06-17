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
      window.location.href = url;
    }
    // For edgeOnly, the background script closes this tab
  });

  document.getElementById("cancel").addEventListener("click", () => {
    window.location.href = url;
  });
});
