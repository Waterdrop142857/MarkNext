import { afterEach, describe, expect, it, vi } from "vitest";
import { computed } from "vue";
import { createI18n, detectLocale, i18n, initializeI18n, LANGUAGE_STORAGE_KEY, messages, saveLocale, type MessageKey } from "..";
import { appMenus } from "../../config/menus";
import { cloneBindings, defaultShortcutBindings, shortcutCommands, validateBindings } from "../../config/shortcuts";

afterEach(() => { localStorage.removeItem(LANGUAGE_STORAGE_KEY); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("application i18n", () => {
  it.each([
    [["zh-CN"], "zh-CN"], [["zh-TW"], "zh-CN"], [["ZH-hk"], "zh-CN"],
    [["en-GB"], "en"], [["fr-FR", "zh"], "zh-CN"], [["en-US", "zh-CN"], "en"],
    [["fr-FR"], "en"], [[], "en"], [["english", "zhang"], "en"],
  ] as const)("detects the first supported system language from %j", (languages, expected) => {
    expect(detectLocale(languages)).toBe(expected);
  });

  it("has identical nonempty keys and parameter names in both catalogs", () => {
    expect(Object.keys(messages["zh-CN"]).sort()).toEqual(Object.keys(messages.en).sort());
    for (const key of Object.keys(messages.en) as MessageKey[]) {
      const parameters = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
      expect(messages.en[key].trim()).not.toBe(""); expect(messages["zh-CN"][key].trim()).not.toBe("");
      expect(parameters(messages["zh-CN"][key])).toEqual(parameters(messages.en[key]));
    }
    for (const menu of appMenus) {
      expect(messages.en[menu.label]).toBeTruthy();
      for (const item of menu.items) expect(messages.en[item.label]).toBeTruthy();
    }
    for (const command of shortcutCommands) {
      expect(messages.en[command.label]).toBeTruthy(); expect(messages.en[command.group]).toBeTruthy();
    }
  });

  it("updates computed translations and interpolates user values once, as literal text", () => {
    const translator = createI18n("en");
    const value = computed(() => translator.t("status.editing", { path: "$& {path} <img>.md" }));
    expect(value.value).toBe("Editing: $& {path} <img>.md");
    translator.setLocale("zh-CN"); expect(value.value).toBe("正在编辑：$& {path} <img>.md");
    expect(translator.t("error.details", { action: "X", details: 42 })).toBe("X：42");
  });

  it("prefers a saved choice to the system and updates HTML lang synchronously", () => {
    vi.stubGlobal("navigator", { languages: ["zh-CN"], language: "zh-CN" });
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "en"); initializeI18n();
    expect(i18n.locale.value).toBe("en"); expect(document.documentElement.lang).toBe("en");
    expect(saveLocale("zh-CN")).toBeNull(); expect(document.documentElement.lang).toBe("zh-CN");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("zh-CN");
    initializeI18n(); expect(i18n.locale.value).toBe("zh-CN");
  });

  it("rejects invalid saved values and survives missing storage on startup", () => {
    vi.stubGlobal("navigator", { languages: ["zh-HK"] });
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "__proto__"); initializeI18n(); expect(i18n.locale.value).toBe("zh-CN");
    vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("unavailable"); });
    expect(() => initializeI18n()).not.toThrow(); expect(i18n.locale.value).toBe("zh-CN");
  });

  it("applies the language and reports a translated persistence failure", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(saveLocale("en")).toContain("Could not save the language preference"); expect(i18n.locale.value).toBe("en");
    expect(saveLocale("zh-CN")).toContain("无法保存语言设置"); expect(i18n.locale.value).toBe("zh-CN");
  });

  it("localizes shortcut conflicts without changing command IDs or bindings", () => {
    const value = cloneBindings(defaultShortcutBindings(false)); value.open = ["Ctrl+N"];
    const snapshot = JSON.stringify(value);
    i18n.setLocale("en"); expect(validateBindings(value)).toContain("New File");
    i18n.setLocale("zh-CN"); expect(validateBindings(value)).toContain("新建文件");
    expect(JSON.stringify(value)).toBe(snapshot);
  });
});
