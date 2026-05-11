(() => {
  /*
   * Theme switching for Pico v2.
   *
   * Pico v2 convention:
   *   - <html data-theme="light">  : force light
   *   - <html data-theme="dark">   : force dark
   *   - <html> with no data-theme  : follow `prefers-color-scheme`
   *
   * We layer three user-visible states on top:
   *   light (manual) -> dark (manual) -> system -> light ...
   *
   * Stored as:
   *   localStorage["site-theme"]          : "light" | "dark"
   *   localStorage["site-prefers-system"] : "true"  | "false"
   *
   * We also set a `data-theme-mode` attribute on <body> so the header toggle
   * can show the correct icon (light / dark / system).
   */
  const LIGHT = "light";
  const DARK = "dark";
  const STORAGE_THEME = "site-theme";
  const STORAGE_SYSTEM = "site-prefers-system";

  function preferSupported() {
    return window.matchMedia("(prefers-color-scheme)").media !== "not all";
  }

  function systemTheme() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? DARK
      : LIGHT;
  }

  function applyManual(theme) {
    document.documentElement.setAttribute("data-theme", theme);
  }

  function applySystem() {
    document.documentElement.removeAttribute("data-theme");
  }

  function setMode(body, usesSystem) {
    body.setAttribute("data-theme-mode", usesSystem ? "system" : "manual");
  }

  function resolveInitial() {
    const usesSystem = localStorage.getItem(STORAGE_SYSTEM) === "true";
    if (usesSystem && preferSupported()) {
      return { theme: systemTheme(), usesSystem: true };
    }
    const stored = localStorage.getItem(STORAGE_THEME);
    if (stored === LIGHT || stored === DARK) {
      return { theme: stored, usesSystem: false };
    }
    return { theme: DARK, usesSystem: false };
  }

  function applyState(theme, usesSystem) {
    if (usesSystem) {
      applySystem();
    } else {
      applyManual(theme);
    }
    if (document.body) {
      setMode(document.body, usesSystem);
    }
    notifyThemeChange();
  }

  function notifyThemeChange() {
    document.dispatchEvent(
      new CustomEvent("site:theme", { detail: { theme: currentResolvedTheme() } })
    );
  }

  function systemChangeHandler() {
    if (localStorage.getItem(STORAGE_SYSTEM) === "true") {
      // Pico v2 already reacts to prefers-color-scheme automatically, so we
      // only need to keep `data-theme` absent (which it already is).
      applySystem();
      notifyThemeChange();
    }
  }

  function setup() {
    const { theme, usesSystem } = resolveInitial();
    applyState(theme, usesSystem);

    if (preferSupported()) {
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .addEventListener("change", systemChangeHandler);
    }
  }

  function currentResolvedTheme() {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === LIGHT || attr === DARK) return attr;
    return systemTheme();
  }

  function toggle(e) {
    e.stopPropagation();
    e.preventDefault();

    const body = document.body;
    const mode = body.getAttribute("data-theme-mode");
    const current = currentResolvedTheme();

    let nextMode, nextTheme;
    if (mode !== "system" && current === LIGHT) {
      nextMode = "manual";
      nextTheme = DARK;
    } else if (mode !== "system" && current === DARK && preferSupported()) {
      nextMode = "system";
      nextTheme = systemTheme();
    } else {
      nextMode = "manual";
      nextTheme = LIGHT;
    }

    const usesSystem = nextMode === "system";
    localStorage.setItem(STORAGE_SYSTEM, String(usesSystem));
    localStorage.setItem(STORAGE_THEME, nextTheme);
    applyState(nextTheme, usesSystem);
  }

  // Apply theme as soon as <body> is available (avoid FOUC of icon state).
  const htmlObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.tagName === "BODY") {
          setup();
          htmlObserver.disconnect();
          return;
        }
      }
    }
  });
  if (document.body) {
    setup();
  } else {
    // Apply the html[data-theme] attribute immediately to avoid color FOUC,
    // then defer the body-mode attribute until <body> exists.
    const { theme, usesSystem } = resolveInitial();
    if (usesSystem) {
      applySystem();
    } else {
      applyManual(theme);
    }
    htmlObserver.observe(document.documentElement, { childList: true });
  }

  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("toggle-theme");
    if (btn) btn.addEventListener("click", toggle);
  });

  // Read-only handle for other scripts (e.g. comments) that need the
  // current resolved theme without re-implementing the resolution.
  window.siteTheme = { current: currentResolvedTheme };
})();
