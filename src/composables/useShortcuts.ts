import { t } from "../i18n";
import { SETTINGS_STORAGE_KEY } from "../config/preferences";
import { ref } from "vue";
import { cloneBindings, defaultShortcutBindings, loadBindings, shortcutLabel, validateBindings } from "../config/shortcuts";
import type { ShortcutBindings, ShortcutCommand } from "../config/shortcuts";

const STORAGE_KEY = "marknext-shortcuts-v1";

export function useShortcuts() {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const defaults = defaultShortcutBindings(mac);
  let stored: string | null = null;
  try { stored = localStorage.getItem(STORAGE_KEY); }
  catch { /* Storage may be unavailable in a browser preview. */ }
  try {
    const settings = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "null");
    if (settings?.version === 1 && settings.bindings) stored = JSON.stringify({ version: 1, bindings: settings.bindings });
  }
  catch { /* Keep legacy shortcut preferences. */ }
  const bindings = ref(loadBindings(stored, defaults));

  function label(command: string): string {
    return bindings.value[command as ShortcutCommand]?.map(shortcutLabel).join(" / ") ?? "";
  }

  function saveBindings(value: ShortcutBindings): string | null {
    const error = validateBindings(value);
    if (error) return error;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, bindings: value }));
    }
    catch {
      return t("shortcut.storage");
    }
    bindings.value = cloneBindings(value);
    return null;
  }

  return { bindings, defaults, label, saveBindings };
}
