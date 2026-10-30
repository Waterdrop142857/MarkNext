import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const tauri = resolve(process.cwd(), "src-tauri");
const configuration = JSON.parse(readFileSync(resolve(tauri, "tauri.conf.json"), "utf8"));
const bundle = configuration.bundle;
const plist = new DOMParser().parseFromString(readFileSync(resolve(tauri, bundle.macOS.infoPlist), "utf8"), "application/xml");
function value(dict: Element, key: string): Element {
  const result = Array.from(dict.children).find(child => child.tagName === "key" && child.textContent === key)?.nextElementSibling;
  if (!result) throw new Error(`Missing plist key: ${key}`);
  return result;
}
function strings(array: Element): string[] { return Array.from(array.children).map(child => child.textContent ?? ""); }
const root = plist.querySelector("plist > dict")!;

describe("native document icon contracts", () => {
  it("keeps every configured file association when overriding macOS document types", () => {
    const types = Array.from(value(root, "CFBundleDocumentTypes").children);
    expect(types).toHaveLength(bundle.fileAssociations.length);
    for (const association of bundle.fileAssociations) {
      const type = types.find(type => value(type, "CFBundleTypeName").textContent === association.name)!;
      expect(type).toBeDefined();
      expect(strings(value(type, "CFBundleTypeExtensions"))).toEqual(association.ext);
      expect(value(type, "CFBundleTypeRole").textContent).toBe("Editor");
      expect(value(type, "LSHandlerRank").textContent).toBe("Alternate");
      const icon = value(type, "CFBundleTypeIconFile").textContent!;
      const source = bundle.macOS.files[`Resources/${icon}`];
      expect(source).toBeDefined();
      const contents = readFileSync(resolve(tauri, source));
      expect(contents.subarray(0, 4).toString()).toBe("icns");
      expect(contents.readUInt32BE(4)).toBe(contents.length);
      expect(contents.equals(readFileSync(resolve(tauri, "icons/icon.icns")))).toBe(false);
    }
    expect(Array.from(root.children).some(child => child.textContent === "CFBundleIconFile")).toBe(false);
  });

  it("imports the standard Markdown UTI with filename tags and a matching icon", () => {
    const imported = Array.from(value(root, "UTImportedTypeDeclarations").children);
    const markdown = imported.find(type => value(type, "UTTypeIdentifier").textContent === "net.daringfireball.markdown")!;
    expect(markdown).toBeDefined();
    const tags = value(markdown, "UTTypeTagSpecification");
    expect(strings(value(tags, "public.filename-extension"))).toEqual(["md", "markdown"]);
    expect(value(tags, "public.mime-type").textContent).toBe("text/markdown");
    expect(value(markdown, "UTTypeIconFile").textContent).toBe("markdown.icns");
    expect(strings(value(markdown, "UTTypeConformsTo"))).toContain("public.plain-text");
    const markdownType = Array.from(value(root, "CFBundleDocumentTypes").children)[0]!;
    expect(strings(value(markdownType, "LSItemContentTypes"))).toContain("net.daringfireball.markdown");
  });

  for (const format of ["deb", "rpm", "appimage"]) {
    it(`ships Markdown icons in ${format}'s theme fallback without replacing text/plain or app icons`, () => {
      const files = bundle.linux[format].files as Record<string, string>;
      expect(Object.keys(files)).toHaveLength(4);
      for (const name of ["text-markdown", "text-x-markdown"]) {
        const svg = files[`/usr/share/icons/hicolor/scalable/mimetypes/${name}.svg`]!;
        expect(readFileSync(resolve(tauri, svg))).toEqual(readFileSync(resolve(tauri, "../public/icons/markdown.svg")));
        const png = readFileSync(resolve(tauri, files[`/usr/share/icons/hicolor/512x512/mimetypes/${name}.png`]!));
        expect(png.readUInt32BE(16)).toBe(512);
        expect(png.readUInt32BE(20)).toBe(512);
      }
      expect(Object.keys(files).every(path => path.includes("/hicolor/") && path.includes("/mimetypes/"))).toBe(true);
      const desktop = readFileSync(resolve(tauri, "templates/marknext.desktop"), "utf8");
      expect(desktop).toContain("Icon={{icon}}");
      expect(desktop).toContain("Exec={{exec}} %U");
      expect(desktop).toContain("MimeType=text/markdown;text/plain;");
    });
  }
});
