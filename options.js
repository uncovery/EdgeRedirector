document.addEventListener("DOMContentLoaded", () => {
  browser.storage.sync.get(["domainsList", "askForConfirmation", "openMode"], (result) => {
    document.getElementById("domainsList").value = 
      (result.domainsList || []).join("\n");
    document.getElementById("askForConfirmation").checked = 
      result.askForConfirmation !== false;

    const openMode = result.openMode || "edgeOnly";
    if (openMode === "both") {
      document.getElementById("openModeBoth").checked = true;
    } else {
      document.getElementById("openModeEdgeOnly").checked = true;
    }
  });
  
  document.getElementById("save").addEventListener("click", () => {
    const domainsText = document.getElementById("domainsList").value;
    const domainsList = domainsText.split("\n")
      .map(domain => domain.trim())
      .filter(domain => domain.length > 0);
    
    const askForConfirmation = document.getElementById("askForConfirmation").checked;
    const openMode = document.getElementById("openModeEdgeOnly").checked ? "edgeOnly" : "both";
    
    browser.storage.sync.set({
      domainsList,
      askForConfirmation,
      openMode
    }, () => {
      document.getElementById("status").textContent = "Settings saved!";
      setTimeout(() => {
        document.getElementById("status").textContent = "";
      }, 2000);
    });
  });
});
