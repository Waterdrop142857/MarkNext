import { convertFileSrc, invoke } from "@tauri-apps/api/core";

const IMAGE_EXTENSION = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i;
const ABSOLUTE = /^(?:\/|\\\\|[a-z]:[\\/])/i;

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const root = normalized.match(/^\/\/[^/]+\/[^/]+/)?.[0] ?? normalized.match(/^[a-z]:/i)?.[0] ?? "";
  const parts: string[] = [];
  for (const part of normalized.slice(root.length).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `${root || ""}/${parts.join("/")}`;
}

/** undefined means a remote source; null means no valid local resource context. */
export function resolveLocalImagePath(source: string, documentPath: string | null): string | null | undefined {
  if (/^(?:https?:|data:|blob:)/i.test(source)) return undefined;
  let path = source;
  try {
    if (/^file:\/\//i.test(path)) {
      const url = new URL(path);
      path = url.hostname && url.hostname !== "localhost" ? `//${url.hostname}${url.pathname}` : url.pathname;
      path = path.replace(/^\/([a-z]:\/)/i, "$1");
    }
    else if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return null;
    path = decodeURIComponent(path);
  }
  catch { return null; }
  if (!IMAGE_EXTENSION.test(path)) return null;
  if (ABSOLUTE.test(path)) return normalizePath(path);
  if (!documentPath) return null;
  const document = documentPath.replace(/\\/g, "/");
  const separator = document.lastIndexOf("/");
  if (separator < 0 || !ABSOLUTE.test(document)) return null;
  return normalizePath(`${document.slice(0, separator + 1)}${path}`);
}

export function createDocumentImageResolver(documentPath: () => string | null) {
  const paths = new Map<string, string>();
  const preparations = new Map<string, Promise<void>>();
  return {
    resolve(source: string): string | undefined {
      const path = resolveLocalImagePath(source, documentPath());
      if (path === undefined) return undefined;
      if (!path) return "";
      try {
        const url = convertFileSrc(path);
        paths.set(url, path);
        return url;
      }
      catch { return ""; }
    },
    prepare(url: string): Promise<void> {
      const path = paths.get(url);
      if (!path) return Promise.resolve();
      const existing = preparations.get(path);
      if (existing) return existing;
      const pending = invoke<void>("allow_image_file", { path }).catch(error => {
        preparations.delete(path);
        throw error;
      });
      preparations.set(path, pending);
      return pending;
    },
    reset() { paths.clear(); preparations.clear(); },
  };
}
