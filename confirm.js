document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const url = params.get("url");
  
  document.getElementById("url").textContent = url;
  
  document.getElementById("confirm").addEventListener("click", () => {
    const edgeUrl = "microsoft-edge:" + url;
    window.location.href = edgeUrl;
  });
  
  document.getElementById("cancel").addEventListener("click", () => {
    window.location.href = url;
  });
});