import { readonly, ref } from "vue";
import { i18n, t } from "../i18n";
import { cloneBindings, validateBindings, type ShortcutBindings } from "../config/shortcuts";
import { loadPreferences, SETTINGS_STORAGE_KEY, validatePreferences, type Preferences } from "../config/preferences";

export function usePreferences() {
  let raw: string | null = null;
  try { raw = localStorage.getItem(SETTINGS_STORAGE_KEY); }
  catch { /* Restricted storage: defaults remain usable. */ }
  const preferences = ref(loadPreferences(raw, i18n.locale.value));

  function save(preferencesDraft: Preferences, bindings: ShortcutBindings): string | null {
    const invalid = validatePreferences(preferencesDraft);
    if (invalid) return t(invalid);
    const conflict = validateBindings(bindings);
    if (conflict) return conflict;
    const next = { ...preferencesDraft, editorFont: preferencesDraft.editorFont.trim(), codeFont: preferencesDraft.codeFont.trim() };
    try {
      // One atomic storage write for all categories; a failure changes neither
      // live preferences nor shortcuts and leaves the dialog available to retry.
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, preferences: next, bindings: cloneBindings(bindings) }));
    }
    catch { return t("settings.storageError"); }
    preferences.value = next;
    i18n.setLocale(next.language);
    return null;
  }
  return { preferences: readonly(preferences), save };
}
