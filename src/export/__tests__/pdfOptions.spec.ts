import { describe, expect, it } from "vitest";
import { defaultPdfOptions, pageDimensions, validPdfOptions, type PdfOptions } from "../pdfOptions";

function options(): PdfOptions { return { ...defaultPdfOptions, margins: { ...defaultPdfOptions.margins } }; }
describe("PDF page geometry", () => {
  it("uses ISO paper dimensions and changes the printable area with orientation", () => {
    const page = options();
    expect(pageDimensions(page)).toEqual([210, 297]);
    page.paper = "b5";
    page.orientation = "landscape";
    expect(pageDimensions(page)).toEqual([250, 176]);
    page.margins.top = 160;
    expect(validPdfOptions(page)).toBe(false);
    page.orientation = "portrait";
    expect(validPdfOptions(page)).toBe(true);
  });
  it("rejects invalid dimensions and margins instead of silently changing user settings", () => {
    for (const bad of [-1, NaN, Infinity]) {
      const page = options();
      page.margins.left = bad;
      expect(validPdfOptions(page)).toBe(false);
    }
    const page = options();
    page.paper = "custom";
    page.width = 30;
    expect(validPdfOptions(page)).toBe(false);
    page.width = 120;
    page.height = 150;
    expect(pageDimensions(page)).toEqual([120, 150]);
    expect(validPdfOptions(page)).toBe(true);
  });
});
