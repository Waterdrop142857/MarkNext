import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultFileFormat, defaultPreferences, fontStack, loadPreferences, SETTINGS_STORAGE_KEY, validatePreferences } from "../../config/preferences";
import { cloneBindings, defaultShortcutBindings } from "../../config/shortcuts";
import { i18n, initializeI18n, LANGUAGE_STORAGE_KEY } from "../../i18n";
import { usePreferences } from "../usePreferences";
import { useShortcuts } from "../useShortcuts";

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
    clear: () => stored.clear(),
  });
  i18n.setLocale("en");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("settings persistence", () => {
  it("migrates the old language and shortcut choices without changing command IDs", () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "zh-CN");
    const bindings = defaultShortcutBindings(false); bindings.new = ["Ctrl+Alt+N"];
    localStorage.setItem("marknext-shortcuts-v1", JSON.stringify({ version: 1, bindings }));
    initializeI18n();
    const settings = usePreferences();
    expect(settings.preferences.value.language).toBe("zh-CN");
    expect(useShortcuts().bindings.value.new).toEqual(["Ctrl+Alt+N"]);
    expect(settings.save({ ...settings.preferences.value, language: "en", editorFont: "  Arial  ", zoom: 125 }, bindings)).toBeNull();
    initializeI18n();
    expect(i18n.locale.value).toBe("en");
    expect(usePreferences().preferences.value).toMatchObject({ language: "en", editorFont: "Arial", zoom: 125 });
    expect(useShortcuts().bindings.value.new).toEqual(["Ctrl+Alt+N"]);
  });

  it("persists all categories in one write and does not retain mutable drafts", () => {
    const settings = usePreferences(); const bindings = defaultShortcutBindings(false);
    const draft = { ...defaultPreferences, defaultEncoding: "utf-16be" as const, codeFont: "Consolas", editorFontSize: 20 };
    const store = vi.spyOn(localStorage, "setItem");
    expect(settings.save(draft, bindings)).toBeNull();
    expect(store).toHaveBeenCalledTimes(1);
    draft.editorFontSize = 30; bindings.new = [];
    expect(settings.preferences.value.editorFontSize).toBe(20);
    const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!);
    expect(saved.preferences.defaultEncoding).toBe("utf-16be"); expect(saved.bindings.new).toEqual(["Ctrl+N"]);
  });

  it("retains live preferences, language and stored bindings on storage failure", () => {
    const settings = usePreferences(); const bindings = defaultShortcutBindings(false);
    settings.save(defaultPreferences, bindings);
    const original = localStorage.getItem(SETTINGS_STORAGE_KEY);
    const storageFailure = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("quota"); });
    const edited = cloneBindings(bindings); edited.new = ["Ctrl+Alt+N"];
    expect(settings.save({ ...defaultPreferences, language: "zh-CN", zoom: 150 }, edited)).toBeTruthy();
    expect(settings.preferences.value).toEqual(defaultPreferences); expect(i18n.locale.value).toBe("en");
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBe(original);
    expect(useShortcuts().bindings.value.new).toEqual(["Ctrl+N"]);
    storageFailure.mockRestore();
  });

  it("rejects shortcut conflicts before applying any preferences", () => {
    const settings = usePreferences(); const bindings = defaultShortcutBindings(false); bindings.open = ["Ctrl+N"];
    expect(settings.save({ ...defaultPreferences, language: "zh-CN" }, bindings)).toContain("New File");
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull(); expect(i18n.locale.value).toBe("en");
  });

  it.each([
    { editorFont: "" }, { codeFont: "Arial; color: red" }, { editorFontSize: 0 },
    { editorFontSize: 16.5 }, { zoom: 201 }, { zoom: Number.NaN }, { defaultEncoding: "imaginary" },
  ])("rejects invalid values %j", invalid => {
    expect(validatePreferences({ ...defaultPreferences, ...invalid } as typeof defaultPreferences)).toBeTruthy();
    expect(loadPreferences(JSON.stringify({ version: 1, preferences: { ...defaultPreferences, ...invalid } }), "zh-CN")).toEqual({ ...defaultPreferences, language: "zh-CN" });
  });

  it("survives malformed and inaccessible storage", () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, "broken");
    expect(usePreferences().preferences.value).toEqual(defaultPreferences);
    const storageFailure = vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("restricted"); });
    expect(usePreferences().preferences.value).toEqual(defaultPreferences);
    storageFailure.mockRestore();
  });

  it("quotes custom font names and chooses explicit BOM defaults", () => {
    expect(fontStack('Custom "Font"')).toBe('"Custom \\"Font\\"", sans-serif');
    expect(fontStack("Consolas", true)).toBe('"Consolas", monospace');
    expect(defaultFileFormat("utf-8")).toEqual({ encoding: "utf-8", bom: false });
    expect(defaultFileFormat("utf-16le")).toEqual({ encoding: "utf-16le", bom: true });
  });
});
