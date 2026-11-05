import type { ExportSnapshot } from "./types";

export const paperSizes = {
  a4: [210, 297], a5: [148, 210], b5: [176, 250], letter: [215.9, 279.4],
} as const;
export type PaperSize = keyof typeof paperSizes | "custom";
export interface PdfOptions {
  paper: PaperSize;
  width: number;
  height: number;
  orientation: "portrait" | "landscape";
  margins: { top: number; right: number; bottom: number; left: number };
}
export interface PdfPayload extends ExportSnapshot { readonly options: PdfOptions }
export const defaultPdfOptions: Readonly<PdfOptions> = {
  paper: "a4", width: 210, height: 297, orientation: "portrait",
  margins: { top: 20, right: 20, bottom: 20, left: 20 },
};
export function pageDimensions(options: PdfOptions): readonly [number, number] {
  const [width, height] = options.paper === "custom" ? [options.width, options.height] : paperSizes[options.paper];
  return options.orientation === "landscape" ? [height, width] : [width, height];
}
export function validPdfOptions(options: PdfOptions): boolean {
  if (!(options.paper === "custom" || Object.prototype.hasOwnProperty.call(paperSizes, options.paper))
    || !["portrait", "landscape"].includes(options.orientation)) return false;
  const dimensions = pageDimensions(options);
  const margins = Object.values(options.margins);
  return dimensions.every(value => Number.isFinite(value) && value >= 50 && value <= 2000)
    && margins.length === 4 && margins.every(value => Number.isFinite(value) && value >= 0)
    && dimensions[0] - options.margins.left - options.margins.right >= 20
    && dimensions[1] - options.margins.top - options.margins.bottom >= 20;
}
