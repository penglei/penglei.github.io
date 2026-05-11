(() => {
  /*
   * Bridges the site's light/dark choice into the giscus comments iframe.
   * giscus boots with `data-theme="preferred_color_scheme"`, which only
   * tracks the OS preference; the bridge overrides that with the user's
   * actual site-level choice (which may disagree with the OS) and keeps
   * the iframe in sync when the user toggles the theme.
   *
   * Idempotent on pages without comments: bails out if no `.post-comments`
   * section exists, so it is safe to load globally from head.html.
   */
  if (!document.querySelector(".post-comments")) return;

  // The iframe loads lazily and only navigates to giscus.app some time
  // after `<iframe>` insertion. Calling `postMessage(msg, "https://giscus.app")`
  // before that navigation completes triggers the browser warning
  //   "target origin … does not match the recipient window's origin".
  // We treat the first inbound message from giscus as the readiness
  // signal and refuse to push before then.
  let ready = false;

  function frame() {
    return document.querySelector("iframe.giscus-frame");
  }

  function pushTheme() {
    if (!ready) return;
    const f = frame();
    if (!f || !f.contentWindow) return;
    const theme =
      (window.siteTheme && window.siteTheme.current()) || "light";
    f.contentWindow.postMessage(
      { giscus: { setConfig: { theme } } },
      "https://giscus.app"
    );
  }

  // The iframe loads lazily; giscus posts a message once it is ready.
  // Treat that as the readiness cue and do an initial sync.
  window.addEventListener("message", (event) => {
    if (event.origin !== "https://giscus.app") return;
    if (event.data && event.data.giscus) {
      ready = true;
      pushTheme();
    }
  });

  // theme.js dispatches this whenever the resolved theme changes
  // (manual toggle or OS-level change while in system mode). May fire
  // before the iframe is ready; pushTheme handles that gracefully.
  document.addEventListener("site:theme", pushTheme);
})();
