import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { PdfPayload } from "../../export/pdfOptions";
import { exportFilename } from "./exportFilename";

export async function exportPdf(payload: PdfPayload): Promise<boolean> {
  const path = await save({ defaultPath: exportFilename(payload.title, "pdf"), filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (!path) return false;
  await invoke<void>("export_pdf", { payload, path: /\.pdf$/i.test(path) ? path : `${path}.pdf` });
  return true;
}
