document.addEventListener("DOMContentLoaded", () => {
  browser.storage.sync.get(["domainsList", "askForConfirmation"], (result) => {
    document.getElementById("domainsList").value = 
      (result.domainsList || []).join("\n");
    document.getElementById("askForConfirmation").checked = 
      result.askForConfirmation !== false;
  });
  
  document.getElementById("save").addEventListener("click", () => {
    const domainsText = document.getElementById("domainsList").value;
    const domainsList = domainsText.split("\n")
      .map(domain => domain.trim())
      .filter(domain => domain.length > 0);
    
    const askForConfirmation = document.getElementById("askForConfirmation").checked;
    
    browser.storage.sync.set({
      domainsList,
      askForConfirmation
    }, () => {
      document.getElementById("status").textContent = "Settings saved!";
      setTimeout(() => {
        document.getElementById("status").textContent = "";
      }, 2000);
    });
  });
});