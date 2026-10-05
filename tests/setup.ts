import { beforeEach } from "vitest";
import { i18n } from "../src/i18n";
beforeEach(() => i18n.setLocale("zh-CN"));

// KaTeX reads document.compatMode during module evaluation. Supply the same
// standards-mode document used by the production index.html in both DOM engines.
if (!document.doctype) {
  document.insertBefore(document.implementation.createDocumentType("html", "", ""), document.documentElement);
}
