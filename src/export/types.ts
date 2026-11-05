import type { PdfOptions } from "./pdfOptions";

/** A captured document, independent of the active editor and its history. */
export interface ExportSnapshot {
  readonly markdown: string;
  readonly title: string;
  readonly sourcePath: string | null;
  readonly fontFamily: string;
  readonly codeFontFamily: string;
  readonly fontSize: number;
}

export type RenderRequest =
  | { format: "pdf"; snapshot: ExportSnapshot; options: PdfOptions }
  | { format: "html"; snapshot: ExportSnapshot };
