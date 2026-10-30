// Parser-blocking and independent of Vue/editor modules, in both dev and builds.
// Keep theme defaults consistent with useTheme; startup tests exercise both.
(function () {
  var mode = "light", language = navigator.language || "en";
  try {
    var stored = localStorage.getItem("marknext-theme-mode");
    if (stored === "light" || stored === "dark" || stored === "system") mode = stored;
    var settings = JSON.parse(localStorage.getItem("marknext-settings-v1") || "null");
    language = settings && settings.preferences && settings.preferences.language || localStorage.getItem("marknext-language-v1") || language;
  } catch (_) { /* Storage is optional at startup. */ }
  var dark = mode === "dark" || mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches;
  var root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.style.setProperty("--startup-bg", dark ? "#1e1e1e" : "#f5f5f5");
  root.style.setProperty("--startup-fg", dark ? "#d4d4d4" : "#1f1f1f");
  root.style.colorScheme = dark ? "dark" : "light";
  var chinese = /^zh\b/i.test(language), phase = "loading";
  root.lang = chinese ? "zh-CN" : "en";
  function render() {
    var message = document.getElementById("startup-message");
    var retry = document.getElementById("startup-retry");
    if (message) message.textContent = phase === "error"
      ? (chinese ? "启动失败，请重新加载。" : "Startup failed. Please reload.")
      : (chinese ? "正在启动…" : "Starting…");
    if (retry) {
      retry.hidden = phase !== "error";
      retry.textContent = chinese ? "重新加载" : "Reload";
      retry.onclick = function () { location.reload(); };
    }
    var surface = document.getElementById("startup");
    if (surface) surface.setAttribute("role", phase === "error" ? "alert" : "status");
    root.dataset.startup = phase;
  }
  function failed() {
    if (phase === "ready") return;
    phase = "error";
    render();
  }
  function onError(event) {
    if (event instanceof ErrorEvent || event.target && event.target.id === "application-entry") failed();
  }
  window.addEventListener("error", onError, true);
  window.__MARKNEXT_STARTUP__ = {
    start: render,
    fail: failed,
    finish: function () {
      phase = "ready";
      root.dataset.startup = phase;
      var surface = document.getElementById("startup");
      if (surface) surface.remove();
      root.style.removeProperty("color-scheme");
      window.removeEventListener("error", onError, true);
    }
  };
})();
