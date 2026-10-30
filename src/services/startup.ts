import { invoke, isTauri } from "@tauri-apps/api/core";

declare global {
  interface Window {
    __MARKNEXT_STARTUP__?: { start(): void; fail(): void; finish(): void };
  }
}

export async function prepareStartup(): Promise<number | null> {
  return isTauri() ? invoke<number>("startup_generation") : null;
}

export async function revealStartup(generation: number | null, failed = false): Promise<void> {
  // Hidden WebViews may suspend rAF. Flush layout without waiting for a frame
  // that cannot occur until the native window has been shown.
  document.documentElement.getBoundingClientRect();
  if (generation !== null) await invoke("startup_ready", {
    generation, dark: document.documentElement.dataset.theme === "dark",
    failed,
  });
}

export function finishStartup(): void {
  window.__MARKNEXT_STARTUP__?.finish();
  // Even a failed early script request must not leave its overlay over a
  // successfully mounted application.
  document.getElementById("startup")?.remove();
}

export function failStartup(): void {
  if (window.__MARKNEXT_STARTUP__) { window.__MARKNEXT_STARTUP__.fail(); return; }
  const surface = document.getElementById("startup");
  surface?.setAttribute("role", "alert");
  const message = document.getElementById("startup-message");
  if (message) message.textContent = /^zh\b/i.test(navigator.language) ? "启动失败，请重新加载。" : "Startup failed. Please reload.";
  const retry = document.getElementById("startup-retry") as HTMLButtonElement | null;
  if (retry) { retry.hidden = false; retry.onclick = () => location.reload(); }
}
