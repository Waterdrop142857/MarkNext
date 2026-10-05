import { afterEach, describe, expect, it, vi } from "vitest";
import { cloneBindings, defaultShortcutBindings, loadBindings, normalizeShortcut, resolveShortcut, shortcutFromEvent, shortcutLabel, validateBindings } from "../../config/shortcuts";
import { createShortcutHandler } from "../../services/shortcutHandler";
import { useShortcuts } from "../useShortcuts";
import { readClipboardData } from "../../services/clipboard";

function keyboard(key: string, extra: Partial<KeyboardEvent> = {}, context: "editor" | "input" | "chrome" = "editor") {
  return {
    key, code: key.length === 1 && /[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : key,
    ctrlKey: true, metaKey: false, altKey: false, shiftKey: false,
    isComposing: false, keyCode: 0, repeat: false, defaultPrevented: false,
    getModifierState: () => false,
    target: { closest: (selector: string) => selector === ".editor-area" ? (context === "editor" ? {} : null) : (context === "input" ? {} : null) },
    preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(), ...extra,
  } as unknown as KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn>; stopImmediatePropagation: ReturnType<typeof vi.fn> };
}

afterEach(() => vi.unstubAllGlobals());

describe("shortcut configuration", () => {
  it("defines common file shortcuts and distinct platform defaults", () => {
    const windows = defaultShortcutBindings(false);
    const mac = defaultShortcutBindings(true);
    expect(windows.new).toEqual(["Ctrl+N"]);
    expect(windows.saveAs).toEqual(["Ctrl+Shift+S"]);
    expect(windows.redo).toEqual(["Ctrl+Y", "Ctrl+Shift+Z"]);
    expect(mac.new).toEqual(["Meta+N"]);
    expect(mac.redo).toEqual(["Meta+Shift+Z"]);
    expect(shortcutLabel(mac.new[0]!)).toBe("Cmd+N");
    expect(validateBindings(windows)).toBeNull();
    expect(validateBindings(mac)).toBeNull();
  });

  it.each([
    ["shift+control+s", "Ctrl+Shift+S"], ["cmd+n", "Meta+N"],
    ["F12", "F12"], ["Alt+Enter", "Alt+Enter"], ["Ctrl+,", "Ctrl+,"],
    ["N", null], ["Shift+N", null], ["Ctrl+Ctrl+N", null], ["Ctrl+Escape", null],
  ])("normalizes %s", (value, expected) => expect(normalizeShortcut(value)).toBe(expected));

  it("matches shifted punctuation by its base key", () => {
    expect(shortcutFromEvent(keyboard("<", { code: "Comma", shiftKey: true }))).toBe("Ctrl+Shift+,");
    expect(shortcutFromEvent(keyboard("№", { code: "Digit3" }))).toBe("Ctrl+3");
  });

  it("rejects conflicting bindings", () => {
    const value = defaultShortcutBindings(false);
    value.new = ["Ctrl+S"];
    expect(validateBindings(value)).toContain("Ctrl+S");
  });

  it("round-trips multiple custom bindings and disabled commands", () => {
    const defaults = defaultShortcutBindings(false);
    const value = cloneBindings(defaults);
    value.new = ["Ctrl+Alt+N", "F2"];
    value.close = [];
    const loaded = loadBindings(JSON.stringify({ version: 1, bindings: value }), defaults);
    expect(loaded).toEqual(value);
    expect(resolveShortcut(keyboard("N", { altKey: true }), loaded)).toBe("new");
    expect(resolveShortcut(keyboard("N"), loaded)).toBeNull();
    expect(defaults.new).toEqual(["Ctrl+N"]);
  });

  it.each(["bad json", '{"version":2}', '{"version":1,"bindings":{"new":["Ctrl+S"]}}', '{"version":1,"bindings":{"new":[42]}}'])
    ("safely falls back for invalid stored settings: %s", raw => {
      const defaults = defaultShortcutBindings(false);
      expect(loadBindings(raw, defaults)).toEqual(defaults);
    });

  it("persists settings and loads them on the next startup", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("navigator", { platform: "Linux" });
    vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
    const shortcuts = useShortcuts();
    const value = cloneBindings(shortcuts.bindings.value);
    value.new = ["Ctrl+Alt+N"];
    expect(shortcuts.saveBindings(value)).toBeNull();
    expect(shortcuts.label("new")).toBe("Ctrl+Alt+N");
    expect(useShortcuts().bindings.value.new).toEqual(value.new);
    expect(shortcuts.saveBindings(cloneBindings(shortcuts.defaults))).toBeNull();
    expect(useShortcuts().bindings.value.new).toEqual(["Ctrl+N"]);
  });

  it("reports storage errors without silently applying unsaved settings", () => {
    vi.stubGlobal("localStorage", { getItem() { throw new Error("unavailable"); }, setItem() { throw new Error("full"); } });
    const shortcuts = useShortcuts();
    const value = cloneBindings(shortcuts.bindings.value);
    value.new = ["F2"];
    expect(shortcuts.saveBindings(value)).toContain("无法保存");
    expect(shortcuts.bindings.value.new).toEqual(shortcuts.defaults.new);
  });
});

describe("shortcut dispatch", () => {
  function handler() {
    const defaults = defaultShortcutBindings(false);
    const bindings = cloneBindings(defaults);
    const execute = vi.fn();
    let blocked = false;
    const dispatch = createShortcutHandler({ bindings: () => bindings, defaults, blocked: () => blocked, execute });
    return { bindings, execute, dispatch, block: () => { blocked = true; } };
  }

  it("dispatches file commands and stops downstream native handlers", () => {
    const h = handler();
    const event = keyboard("N");
    h.dispatch(event);
    expect(h.execute).toHaveBeenCalledWith("new");
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it("uses custom bindings and suppresses removed defaults", () => {
    const h = handler();
    h.bindings.new = ["Ctrl+Alt+N"];
    const old = keyboard("N");
    h.dispatch(old);
    expect(h.execute).not.toHaveBeenCalled();
    expect(old.preventDefault).toHaveBeenCalledOnce();
    h.dispatch(keyboard("N", { altKey: true }));
    expect(h.execute).toHaveBeenCalledWith("new");
  });

  it("can reassign an old binding to a different command", () => {
    const h = handler();
    h.bindings.new = [];
    h.bindings.open = ["Ctrl+N"];
    h.dispatch(keyboard("N"));
    expect(h.execute).toHaveBeenCalledExactlyOnceWith("open");
  });

  it("keeps native editing shortcuts in search inputs", () => {
    const h = handler();
    const event = keyboard("Z", {}, "input");
    h.dispatch(event);
    expect(h.execute).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    h.dispatch(keyboard("S", {}, "input"));
    expect(h.execute).toHaveBeenCalledWith("save");
  });

  it("routes editor undo once and preserves native clipboard events", () => {
    const h = handler();
    h.dispatch(keyboard("Z"));
    expect(h.execute).toHaveBeenCalledExactlyOnceWith("undo");
    const copy = keyboard("C");
    h.dispatch(copy);
    expect(copy.preventDefault).not.toHaveBeenCalled();
    h.bindings.copy = ["Ctrl+Shift+C"];
    h.dispatch(keyboard("C", { shiftKey: true }));
    expect(h.execute).toHaveBeenLastCalledWith("copy");
  });

  it("blocks whole-window select-all but preserves input select-all", () => {
    const h = handler();
    const chrome = keyboard("A", {}, "chrome");
    h.dispatch(chrome);
    expect(chrome.preventDefault).toHaveBeenCalledOnce();
    expect(h.execute).not.toHaveBeenCalled();
    const input = keyboard("A", {}, "input");
    h.dispatch(input);
    expect(input.preventDefault).not.toHaveBeenCalled();
  });

  it("leaves Muya formatting shortcuts available when not assigned", () => {
    const h = handler();
    const event = keyboard("B");
    h.dispatch(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("ignores composition, AltGraph, key repeats and modal settings", () => {
    const h = handler();
    h.dispatch(keyboard("N", { isComposing: true }));
    h.dispatch(keyboard("N", { keyCode: 229 }));
    h.dispatch(keyboard("N", { getModifierState: name => name === "AltGraph" }));
    h.dispatch(keyboard("N", { repeat: true }));
    h.block();
    const modal = keyboard("N");
    h.dispatch(modal);
    expect(h.execute).not.toHaveBeenCalled();
    expect(modal.preventDefault).not.toHaveBeenCalled();
  });
});

describe("custom paste clipboard reader", () => {
  function mockDataTransfer() {
    vi.stubGlobal("DataTransfer", class {
      values = new Map<string, string>();
      files: File[] = [];
      items = { add: (file: File) => this.files.push(file) };
      setData(type: string, value: string) { this.values.set(type, value); }
      getData(type: string) { return this.values.get(type) ?? ""; }
    });
  }

  it("preserves rich text and image clipboard contents", async () => {
    mockDataTransfer();
    vi.stubGlobal("navigator", { clipboard: { read: async () => [{
      types: ["text/plain", "text/html", "image/png"],
      getType: async (type: string) => new Blob([type === "text/plain" ? "text" : type === "text/html" ? "<b>text</b>" : "image"], { type }),
    }] } });
    const data = await readClipboardData();
    expect(data.getData("text/plain")).toBe("text");
    expect(data.getData("text/html")).toBe("<b>text</b>");
    expect(data.files[0]?.type).toBe("image/png");
  });

  it("falls back to plain text when rich clipboard reading is unsupported", async () => {
    mockDataTransfer();
    vi.stubGlobal("navigator", { clipboard: { readText: async () => "fallback" } });
    expect((await readClipboardData()).getData("text/plain")).toBe("fallback");
  });

  it("retries a failed rich read with the plain-text API", async () => {
    mockDataTransfer();
    vi.stubGlobal("navigator", { clipboard: { read: async () => { throw new Error("unsupported"); }, readText: async () => "text" } });
    expect((await readClipboardData()).getData("text/plain")).toBe("text");
  });

  it("reports denied reads instead of silently losing the paste", async () => {
    mockDataTransfer();
    vi.stubGlobal("navigator", { clipboard: { readText: async () => { throw new Error("denied"); } } });
    await expect(readClipboardData()).rejects.toThrow("denied");
  });
});
