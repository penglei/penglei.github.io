(() => {
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("pre").forEach((pre) => {
      const btn = document.createElement("button");
      btn.className = "copy-btn";
      btn.setAttribute("aria-label", "Copy code");
      btn.addEventListener("click", () => {
        const text = pre.textContent.replace(/\n$/, "");
        navigator.clipboard.writeText(text).then(() => {
          btn.classList.add("copied");
          setTimeout(() => btn.classList.remove("copied"), 1500);
        });
      });
      pre.appendChild(btn);
    });
  });
})();
