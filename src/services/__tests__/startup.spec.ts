import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent } from "vue";
import { useTheme } from "../../composables/useTheme";
import { failStartup, finishStartup, prepareStartup, revealStartup } from "../startup";

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);
const source = readFileSync(resolve("public/startup.js"), "utf8");
let unmount: (() => void) | undefined;
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-theme");
  document.body.innerHTML = '<div id="startup"><span id="startup-message"></span><button id="startup-retry" hidden></button></div><div id="app"></div>';
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  native.isTauri.mockReturnValue(false);
});
afterEach(() => { unmount?.(); unmount = undefined; window.__MARKNEXT_STARTUP__?.finish(); delete window.__MARKNEXT_STARTUP__; vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function bootstrap() { new Function(source)(); window.__MARKNEXT_STARTUP__!.start(); }

describe("parser-time startup appearance", () => {
  for (const [stored, systemDark, dark] of [[null, true, false], ["light", true, false], ["dark", false, true], ["system", true, true], ["system", false, false], ["invalid", true, false]] as const) {
    it(`matches Vue theme for ${stored}, system dark=${systemDark}`, () => {
      if (stored) localStorage.setItem("marknext-theme-mode", stored);
      vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: systemDark, addEventListener() {}, removeEventListener() {} })));
      bootstrap();
      expect(document.documentElement.dataset.theme).toBe(dark ? "dark" : "light");
      expect(document.documentElement.style.getPropertyValue("--startup-bg")).toBe(dark ? "#1e1e1e" : "#f5f5f5");
      const app = createApp(defineComponent({ setup() { useTheme(); return () => null; } }));
      app.mount("#app"); unmount = () => app.unmount();
      expect(document.documentElement.dataset.theme).toBe(dark ? "dark" : "light");
    });
  }
  it("survives unavailable storage and malformed settings", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("unavailable"); });
    expect(bootstrap).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("light");
    vi.restoreAllMocks(); localStorage.setItem("marknext-theme-mode", "dark");
    localStorage.setItem("marknext-settings-v1", "{");
    window.__MARKNEXT_STARTUP__?.finish();
    expect(bootstrap).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
  it("localizes the failure surface, exposes reload, and ignores later editor errors", () => {
    localStorage.setItem("marknext-language-v1", "zh-CN"); bootstrap();
    expect(document.documentElement.lang).toBe("zh-CN");
    window.__MARKNEXT_STARTUP__!.fail();
    expect(document.querySelector("#startup")?.getAttribute("role")).toBe("alert");
    expect(document.querySelector("#startup-message")?.textContent).toContain("启动失败");
    expect(document.querySelector<HTMLButtonElement>("#startup-retry")?.hidden).toBe(false);
    window.__MARKNEXT_STARTUP__!.finish();
    window.__MARKNEXT_STARTUP__!.fail();
    expect(document.querySelector("#startup")).toBeNull();
    expect(document.documentElement.dataset.startup).toBe("ready");
    expect(document.documentElement.style.colorScheme).toBe("");
  });
});

describe("native readiness handshake", () => {
  it("can finish or show an error even if the early script itself was unavailable", () => {
    delete window.__MARKNEXT_STARTUP__;
    failStartup();
    expect(document.querySelector("#startup")?.getAttribute("role")).toBe("alert");
    expect(document.querySelector<HTMLButtonElement>("#startup-retry")?.hidden).toBe(false);
    finishStartup();
    expect(document.querySelector("#startup")).toBeNull();
  });
  it("is a no-op in a plain browser", async () => {
    expect(await prepareStartup()).toBeNull(); await revealStartup(null);
    expect(native.invoke).not.toHaveBeenCalled();
  });
  it("passes the generation and effective theme without waiting for hidden-window rAF", async () => {
    native.isTauri.mockReturnValue(true); native.invoke.mockResolvedValueOnce(7);
    const frame = vi.spyOn(window, "requestAnimationFrame");
    const generation = await prepareStartup(); document.documentElement.dataset.theme = "dark";
    await revealStartup(generation);
    expect(native.invoke).toHaveBeenLastCalledWith("startup_ready", { generation: 7, dark: true, failed: false });
    expect(frame).not.toHaveBeenCalled();
    await revealStartup(generation, true);
    expect(native.invoke).toHaveBeenLastCalledWith("startup_ready", { generation: 7, dark: true, failed: true });
  });
});
