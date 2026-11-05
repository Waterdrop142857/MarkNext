import DOMPurify from "dompurify";
import { sanitizePreviewStyle } from "../muya/utils/sanitizeHtmlPreview";

/** Keep KaTeX's inline geometry while containing user HTML presentation. */
export function prepareExportHtml(html: string): HTMLTemplateElement {
  const template = document.createElement("template");
  template.innerHTML = DOMPurify.sanitize(html, {
    FORBID_TAGS: ["style", "link", "base", "meta", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["srcset", "autofocus", "contenteditable"],
  });
  for (const node of template.content.querySelectorAll<HTMLElement>("[style]")) {
    const source = document.createElement("span").style;
    source.cssText = node.getAttribute("style") ?? "";
    const safe = document.createElement("span").style;
    safe.cssText = sanitizePreviewStyle(source.cssText);
    if (node.closest(".katex")) {
      if (source.position === "relative") safe.position = "relative";
      for (const property of ["top", "right", "bottom", "left", "border-bottom-width", "border-right-width"] as const) {
        const value = source.getPropertyValue(property);
        if (/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:em|ex|px|pt|%)$/.test(value)) safe.setProperty(property, value);
      }
    }
    if (safe.cssText) node.setAttribute("style", safe.cssText);
    else node.removeAttribute("style");
  }
  return template;
}
