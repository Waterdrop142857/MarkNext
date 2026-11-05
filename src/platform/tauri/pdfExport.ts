import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { PdfPayload } from "../../export/pdfOptions";

export async function exportPdf(payload: PdfPayload): Promise<boolean> {
  const filename = payload.title.replace(/\.(?:md|markdown|txt)$/i, "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "document";
  const path = await save({ defaultPath: `${filename}.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (!path) return false;
  await invoke<void>("export_pdf", { payload, path: /\.pdf$/i.test(path) ? path : `${path}.pdf` });
  return true;
}
