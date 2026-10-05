import type { Locale, MessageKey } from "../i18n";

export const SETTINGS_STORAGE_KEY = "marknext-settings-v1";
export const fileEncodings = ["utf-8", "utf-8-bom", "utf-16le", "utf-16be"] as const;
export type FileEncoding = typeof fileEncodings[number];
export interface FileFormat { encoding: FileEncoding; bom: boolean }
export type SettingsCategory = "appearance" | "editor" | "files" | "shortcuts";
export interface Preferences {
  language: Locale;
  editorFont: string;
  editorFontSize: number;
  codeFont: string;
  defaultEncoding: FileEncoding;
  zoom: number;
}
export const defaultPreferences: Preferences = {
  language: "en", editorFont: "system", editorFontSize: 16,
  codeFont: "monospace", defaultEncoding: "utf-8", zoom: 100,
};
export const editorFonts = ["system", "Open Sans", "Segoe UI", "Arial", "Noto Sans CJK SC", "Microsoft YaHei", "SimSun"];
export const codeFonts = ["monospace", "JetBrains Mono", "Fira Code", "DejaVu Sans Mono", "Consolas", "Courier New"];

export function validatePreferences(value: Preferences): MessageKey | null {
  const validFont = (font: unknown) => typeof font === "string" && !!font.trim() && font.length <= 100 && !/[\x00-\x1f\x7f{};]/.test(font);
  if (!value || !["en", "zh-CN"].includes(value.language) || !validFont(value.editorFont) || !validFont(value.codeFont)) return "settings.invalidFont";
  if (!Number.isInteger(value.editorFontSize) || value.editorFontSize < 12 || value.editorFontSize > 40) return "settings.invalidSize";
  if (!Number.isInteger(value.zoom) || value.zoom < 75 || value.zoom > 200) return "settings.invalidZoom";
  if (!fileEncodings.includes(value.defaultEncoding)) return "settings.invalidEncoding";
  return null;
}

export function loadPreferences(raw: string | null, language: Locale): Preferences {
  try {
    const data = JSON.parse(raw ?? "null");
    if (data?.version === 1 && data.preferences && !validatePreferences(data.preferences)) return { ...data.preferences };
  }
  catch { /* Invalid/old storage must not prevent startup. */ }
  return { ...defaultPreferences, language };
}

export function fontStack(font: string, code = false): string {
  if (font === "system") return "'Open Sans', 'Segoe UI', 'Noto Sans CJK SC', Arial, sans-serif";
  if (font === "monospace") return "'DejaVu Sans Mono', 'JetBrains Mono', Consolas, monospace";
  const quoted = `"${font.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return `${quoted}, ${code ? "monospace" : "sans-serif"}`;
}

export function defaultFileFormat(encoding: FileEncoding): FileFormat {
  return { encoding, bom: encoding !== "utf-8" };
}
