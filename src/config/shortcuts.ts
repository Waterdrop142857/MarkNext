import { t, type MessageKey } from "../i18n";

export const shortcutCommands = [
  { id: "settings", label: "settings.title", group: "group.settings" },
  { id: "new", label: "shortcut.command.new", group: "menu.file" },
  { id: "open", label: "shortcut.command.open", group: "menu.file" },
  { id: "save", label: "command.save", group: "menu.file" },
  { id: "saveAs", label: "shortcut.command.saveAs", group: "menu.file" },
  { id: "saveAll", label: "command.saveAll", group: "menu.file" },
  { id: "close", label: "shortcut.command.close", group: "menu.file" },
  { id: "closeAll", label: "command.closeAll", group: "menu.file" },
  { id: "nextTab", label: "command.nextTab", group: "group.view" },
  { id: "previousTab", label: "command.previousTab", group: "group.view" },
  { id: "exit", label: "shortcut.command.exit", group: "menu.file" },
  { id: "undo", label: "command.undo", group: "menu.edit" },
  { id: "redo", label: "command.redo", group: "menu.edit" },
  { id: "cut", label: "command.cut", group: "menu.edit" },
  { id: "copy", label: "command.copy", group: "menu.edit" },
  { id: "paste", label: "command.paste", group: "menu.edit" },
  { id: "selectAll", label: "command.selectAll", group: "menu.edit" },
  { id: "find", label: "command.find", group: "menu.edit" },
  { id: "replace", label: "command.replace", group: "menu.edit" },
  { id: "findNext", label: "command.findNext", group: "menu.edit" },
  { id: "findPrevious", label: "command.findPrevious", group: "menu.edit" },
  { id: "clear", label: "shortcut.command.clear", group: "menu.edit" },
  { id: "toggleMode", label: "shortcut.command.toggleMode", group: "group.view" },
  { id: "shortcuts", label: "shortcut.command.shortcuts", group: "group.settings" },
  { id: "theme-system", label: "shortcut.command.theme-system", group: "group.settings" },
  { id: "theme-light", label: "shortcut.command.theme-light", group: "group.settings" },
  { id: "theme-dark", label: "shortcut.command.theme-dark", group: "group.settings" },
  { id: "devtools", label: "shortcut.command.devtools", group: "menu.help" },
  { id: "about", label: "command.about", group: "menu.help" },
] as const satisfies readonly { id: string; label: MessageKey; group: MessageKey }[];

export type ShortcutCommand = typeof shortcutCommands[number]["id"];
export type ShortcutBindings = Record<ShortcutCommand, string[]>;

export function defaultShortcutBindings(mac: boolean): ShortcutBindings {
  const mod = mac ? "Meta" : "Ctrl";
  const bindings = Object.fromEntries(shortcutCommands.map(({ id }) => [id, [] as string[]])) as ShortcutBindings;
  Object.assign(bindings, {
    new: [`${mod}+N`], open: [`${mod}+O`], save: [`${mod}+S`],
    saveAs: [`${mod}+Shift+S`], close: [`${mod}+W`], exit: [`${mod}+Q`],
    saveAll: [`${mod}+Alt+S`], nextTab: ["Ctrl+Tab"], previousTab: ["Ctrl+Shift+Tab"],
    undo: [`${mod}+Z`], redo: mac ? ["Meta+Shift+Z"] : ["Ctrl+Y", "Ctrl+Shift+Z"],
    cut: [`${mod}+X`], copy: [`${mod}+C`], paste: [`${mod}+V`],
    selectAll: [`${mod}+A`], find: [`${mod}+F`], replace: [`${mod}+H`],
    findNext: ["F3"], findPrevious: ["Shift+F3"],
    toggleMode: [`${mod}+Shift+M`], shortcuts: [`${mod}+,`],
    devtools: import.meta.env.DEV ? ["F12"] : [],
  });
  return bindings;
}

const aliases: Record<string, string> = {
  ctrl: "Ctrl", control: "Ctrl", alt: "Alt", option: "Alt",
  shift: "Shift", meta: "Meta", cmd: "Meta", command: "Meta",
};
const specialKeys = ["Enter", "Tab", "Space", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

export function normalizeShortcut(value: string): string | null {
  const parts = value.split("+").map(part => part.trim());
  const rawKey = parts.pop();
  if (!rawKey) return null;
  const modifiers = new Set<string>();
  for (const part of parts) {
    const modifier = aliases[part.toLowerCase()];
    if (!modifier || modifiers.has(modifier)) return null;
    modifiers.add(modifier);
  }
  const key = specialKeys.find(name => name.toLowerCase() === rawKey.toLowerCase()) ?? rawKey.toUpperCase();
  const printableKeys = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789,./;[]'=\\-`";
  if (!(key.length === 1 && printableKeys.includes(key)) && !/^F([1-9]|1\d|2[0-4])$/.test(key) && !specialKeys.includes(key)) return null;
  if (!["Ctrl", "Meta", "Alt"].some(mod => modifiers.has(mod)) && !/^F\d+$/.test(key)) return null;
  return [...["Ctrl", "Meta", "Alt", "Shift"].filter(mod => modifiers.has(mod)), key].join("+");
}

export function shortcutFromEvent(event: KeyboardEvent): string | null {
  if (event.isComposing || event.keyCode === 229 || event.getModifierState?.("AltGraph")) return null;
  // Use the base key so Shift+punctuation and different keyboard layouts stay stable.
  const punctuation: Record<string, string> = {
    Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'",
    BracketLeft: "[", BracketRight: "]", Equal: "=", Minus: "-", Backslash: "\\", Backquote: "`", Space: "Space",
  };
  const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3)
    : /^Digit\d$/.test(event.code) ? event.code.slice(5)
      : punctuation[event.code] ?? event.key;
  return normalizeShortcut([
    ...(event.ctrlKey ? ["Ctrl"] : []), ...(event.metaKey ? ["Meta"] : []),
    ...(event.altKey ? ["Alt"] : []), ...(event.shiftKey ? ["Shift"] : []), key,
  ].join("+"));
}

export function shortcutLabel(shortcut: string): string {
  return shortcut.replace("Meta", "Cmd").replace("ArrowUp", "↑").replace("ArrowDown", "↓")
    .replace("ArrowLeft", "←").replace("ArrowRight", "→");
}

export function cloneBindings(bindings: ShortcutBindings): ShortcutBindings {
  return Object.fromEntries(shortcutCommands.map(({ id }) => [id, [...bindings[id]]])) as ShortcutBindings;
}

export function validateBindings(bindings: ShortcutBindings): string | null {
  const used = new Map<string, MessageKey>();
  for (const command of shortcutCommands) {
    for (const chord of bindings[command.id]) {
      if (normalizeShortcut(chord) !== chord) return t("shortcut.invalid", { chord });
      const previous = used.get(chord);
      if (previous) return t("shortcut.conflict", { chord: shortcutLabel(chord), command: t(previous) });
      used.set(chord, command.label);
    }
  }
  return null;
}

export function loadBindings(raw: string | null, defaults: ShortcutBindings): ShortcutBindings {
  try {
    const data = JSON.parse(raw ?? "null");
    if (data?.version !== 1 || !data.bindings || typeof data.bindings !== "object") return cloneBindings(defaults);
    const bindings = cloneBindings(defaults);
    for (const { id } of shortcutCommands) {
      const value: unknown = data.bindings[id];
      if (value === undefined) continue;
      if (!Array.isArray(value) || value.some(chord => typeof chord !== "string" || !normalizeShortcut(chord))) return cloneBindings(defaults);
      bindings[id] = value.map(chord => normalizeShortcut(chord) as string);
    }
    return validateBindings(bindings) ? cloneBindings(defaults) : bindings;
  }
  catch {
    return cloneBindings(defaults);
  }
}

export const textEditingCommands = new Set<string>(["undo", "redo", "cut", "copy", "paste", "selectAll", "clear"]);

export function resolveShortcut(event: KeyboardEvent, bindings: ShortcutBindings): ShortcutCommand | null {
  const chord = shortcutFromEvent(event);
  if (!chord) return null;
  return shortcutCommands.find(({ id }) => bindings[id].includes(chord))?.id ?? null;
}

export function isNativeClipboardShortcut(command: ShortcutCommand, event: KeyboardEvent): boolean {
  const letter = { cut: "X", copy: "C", paste: "V" }[command as "cut" | "copy" | "paste"];
  const chord = shortcutFromEvent(event);
  return !!letter && (chord === `Ctrl+${letter}` || chord === `Meta+${letter}`);
}
