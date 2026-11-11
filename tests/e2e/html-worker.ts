import { mockIPC } from "@tauri-apps/api/mocks";
import { defaultPdfOptions } from "../../src/export/pdfOptions";
import type { RenderRequest } from "../../src/export/types";

declare global { interface Window { htmlWorker: { result: string; error: string; paths: string[]; ready: boolean } } }
window.htmlWorker = { result: "", error: "", paths: [], ready: false };
let request: RenderRequest = {
  format: "html",
  snapshot: {
    markdown: '# Portable 中文\n\n$x^2$\n\n```typescript\nconst answer: number = 42;\n```\n\n```mermaid\ngraph LR\nStart --> End\n```\n\n![image](%E5%9B%BE%E7%89%87%20%23%20%25.svg)\n\n<p onclick="alert(1)">Safe</p><script>alert(1)</script>',
    title: "Portable 中文.md", sourcePath: "/docs/test.md", fontFamily: "sans-serif", codeFontFamily: "monospace", fontSize: 18,
  },
};
if (location.search.includes("pdf")) {
  request = { format: "pdf", options: { ...defaultPdfOptions, avoidPageBreaks: location.search.includes("avoid-breaks") }, snapshot: {
    ...request.snapshot,
    markdown: request.snapshot.markdown + "\n\n## Long content\n\nLONG_START\n" + Array.from({ length: 100 }, (_, index) => `Long content line ${index} stays complete.`).join("\n") + "\nLONG_END",
  } };
}
mockIPC((command, args) => {
  if (command === "export_payload") return request;
  if (command === "allow_image_file") { window.htmlWorker.paths.push(String(args && typeof args === "object" && "path" in args ? args.path : "")); return; }
  if (command === "export_ready") {
    window.htmlWorker.ready = true;
    if (args && typeof args === "object") {
      if ("content" in args && typeof args.content === "string") window.htmlWorker.result = args.content;
      if ("error" in args && typeof args.error === "string") window.htmlWorker.error = args.error;
    }
    return;
  }
  throw new Error(`Unexpected worker command: ${command}`);
});
const internals: { convertFileSrc: (path: string) => string } = Reflect.get(window, "__TAURI_INTERNALS__");
internals.convertFileSrc = () => location.search.includes("bad-image") ? "/tests/e2e/html-worker.html" : "/tests/e2e/fixtures/pixel.svg";
void import("../../src/export/exportPage");
