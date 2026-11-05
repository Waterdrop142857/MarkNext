import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { ExportSnapshot } from "../../export/types";
import { exportFilename } from "./exportFilename";

export async function exportHtml(payload: ExportSnapshot): Promise<boolean> {
  const path = await save({ defaultPath: exportFilename(payload.title, "html"), filters: [{ name: "HTML", extensions: ["html", "htm"] }] });
  if (!path) return false;
  await invoke<void>("export_html", { payload, path: /\.html?$/i.test(path) ? path : `${path}.html` });
  return true;
}
