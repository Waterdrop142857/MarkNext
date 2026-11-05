import { invoke } from "@tauri-apps/api/core";
import type { RenderRequest } from "./types";
import { deadline, renderExport } from "./renderDocument";

async function render() {
  const request = await invoke<RenderRequest>("export_payload");
  const output = await renderExport(request);
  let content: string | null = null;
  if (request.format === "html") {
    // Serialize the generated document, never the worker shell or its scripts.
    const policy = output.createElement("meta");
    policy.httpEquiv = "Content-Security-Policy";
    policy.content = "default-src 'none'; img-src data: http: https:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'";
    output.head.prepend(policy);
    content = `<!DOCTYPE html>\n${output.documentElement.outerHTML}`;
  }
  await invoke("export_ready", { error: null, content });
}
void deadline(render(), 90000, "Document rendering timed out").catch(async error => {
  try { await invoke("export_ready", { error: String(error), content: null }); }
  catch (cause) { console.error("Document export failed", cause); }
});
