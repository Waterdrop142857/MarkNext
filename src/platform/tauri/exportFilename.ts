export function exportFilename(title: string, extension: "pdf" | "html"): string {
  const name = title.replace(/\.(?:md|markdown|txt)$/i, "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "document";
  return `${name}.${extension}`;
}
