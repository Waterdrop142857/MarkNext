import { readonly, ref, watch } from "vue";
import { en, type MessageKey } from "./en";
import { loadPreferences, SETTINGS_STORAGE_KEY } from "../config/preferences";
import { zhCN } from "./zh-CN";

export type Locale = "zh-CN" | "en";
export type MessageParams = Record<string, string | number>;
export type { MessageKey } from "./en";
export const LANGUAGE_STORAGE_KEY = "marknext-language-v1";
export const messages = { en, "zh-CN": zhCN };
export const supportedLanguages = [
  { id: "zh-CN", label: "简体中文" },
  { id: "en", label: "English" },
] as const;

export function detectLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    if (/^zh(?:-|$)/i.test(language)) return "zh-CN";
    if (/^en(?:-|$)/i.test(language)) return "en";
  }
  return "en";
}

export function createI18n(initial: Locale = "en") {
  const locale = ref<Locale>(initial);
  function t(key: MessageKey, params: MessageParams = {}): string {
    const template = messages[locale.value][key] ?? en[key];
    // One pass: user values containing braces or replacement syntax stay literal.
    return template.replace(/\{(\w+)\}/g, (token, name: string) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : token,
    );
  }
  function setLocale(value: Locale) {
    if (value === "en" || value === "zh-CN") locale.value = value;
  }
  return { locale: readonly(locale), t, setLocale };
}

export const i18n = createI18n();
export const t = i18n.t;
export function useI18n() { return i18n; }

// Called once before mounting. Services share the same reactive locale as Vue.
export function initializeI18n(): void {
  let stored: string | null = null;
  try { stored = localStorage.getItem(LANGUAGE_STORAGE_KEY); }
  catch { /* A restricted preview may not expose storage. */ }
  const system = typeof navigator === "undefined" ? []
    : navigator.languages?.length ? navigator.languages : [navigator.language];
  let settings: string | null = null;
  try { settings = localStorage.getItem(SETTINGS_STORAGE_KEY); }
  catch { /* Fall back to the legacy language preference. */ }
  const language = stored === "en" || stored === "zh-CN" ? stored : detectLocale(system);
  i18n.setLocale(loadPreferences(settings, language).language);
  document.documentElement.lang = i18n.locale.value;
}

watch(i18n.locale, value => {
  if (typeof document !== "undefined") document.documentElement.lang = value;
}, { flush: "sync" });

export function saveLocale(locale: Locale): string | null {
  i18n.setLocale(locale);
  try { localStorage.setItem(LANGUAGE_STORAGE_KEY, locale); }
  catch { return t("language.storage"); }
  return null;
}
