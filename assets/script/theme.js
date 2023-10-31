(() => {
  const darkScheme = "dracula";

  function preferDarkChange(e) {
    if (localStorage.getItem("data-md-prefers-color-scheme") === "true") {
      document.querySelector("body").setAttribute( "data-md-color-scheme", e.matches ? darkScheme : "default");
    }
  }

  function setupTheme(body) {
    const preferSupported =
      window.matchMedia("(prefers-color-scheme)").media !== "not all";
    let scheme = localStorage.getItem("data-md-color-scheme");
    let prefer = localStorage.getItem("data-md-prefers-color-scheme");

    if (!scheme) {
      scheme = darkScheme;
    }
    if (!prefer) {
      prefer = "false";
    }

    if (prefer === "true" && preferSupported) {
      scheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? darkScheme : "default";
    } else {
      prefer = "false";
    }

    body.setAttribute("data-md-prefers-color-scheme", prefer);
    body.setAttribute("data-md-color-scheme", scheme);

    if (preferSupported) {
      //must listen on concrete scheme, i.e. (..: dark) or (..: light)
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .addEventListener("change", preferDarkChange);
    }
  }

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "childList") {
        if (mutation.addedNodes.length) {
          for (let i = 0; i < mutation.addedNodes.length; i++) {
            const el = mutation.addedNodes[i];

            if (el.nodeType === 1 && el.tagName.toLowerCase() === "body") {
              setupTheme(el);
              break;
            }
          }
        }
      }
    });
  });

  observer.observe(document.querySelector("html"), { childList: true });

  function toggleScheme() {
    const body = document.querySelector("body");
    const preferSupported =
      window.matchMedia("(prefers-color-scheme)").media !== "not all";
    let scheme = body.getAttribute("data-md-color-scheme");
    let prefer = body.getAttribute("data-md-prefers-color-scheme");

    if (preferSupported && scheme === "default" && prefer !== "true") {
      prefer = "true";
      scheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? darkScheme : "default";
    } else if (preferSupported && prefer === "true") {
      prefer = "false";
      scheme = darkScheme;
    } else if (scheme === darkScheme) {
      prefer = "false";
      scheme = "default";
    } else {
      prefer = "false";
      scheme = darkScheme;
    }
    localStorage.setItem("data-md-prefers-color-scheme", prefer);
    localStorage.setItem("data-md-color-scheme", scheme);
    body.setAttribute("data-md-prefers-color-scheme", prefer);
    body.setAttribute("data-md-color-scheme", scheme);
  }

  document.addEventListener("DOMContentLoaded", () => {
    document
      .getElementById("toggle-theme")
      .addEventListener("click", toggleScheme);
  });
})();
