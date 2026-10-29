import { describe, expect, it } from "vitest";
import { analyzeDocument, countText } from "../documentAnalysis";

describe("document statistics and outline", () => {
  it("counts Chinese characters, other words and Unicode characters without Markdown syntax or destinations", () => {
    const result = analyzeDocument("# **你好** [world](https://example.com/ignored)\n\n`code` 😀");
    expect(result.statistics).toEqual({ words: 4, characters: 14 });
    expect(result.headings.map(heading => heading.text)).toEqual(["你好 world"]);
    expect(countText("你好world𠀀 don't 123 😀")).toEqual({ words: 6, characters: 20 });
  });
  it("includes punctuation and spaces only in characters, counting Unicode code points", () => {
    expect(countText("你好， world! 😀")).toEqual({ words: 3, characters: 12 });
    expect(countText(" ！？\t\r\n")).toEqual({ words: 0, characters: 4 });
    expect(countText("𠀀😀")).toEqual({ words: 1, characters: 2 });
  });
  it("does not invent spaces for Markdown block, table or inline line breaks", () => {
    expect(analyzeDocument("hello\nworld").statistics).toEqual({ words: 2, characters: 10 });
    expect(analyzeDocument("**hello\nworld**").statistics).toEqual({ words: 2, characters: 10 });
    expect(analyzeDocument("# One\n\n---\n\nTwo").statistics).toEqual({ words: 2, characters: 6 });
  });
  it("collects all six heading levels and Setext headings with source line numbers", () => {
    const result = analyzeDocument("# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n\nSetext\n======\n");
    expect(result.headings.map(({ level, line }) => [level, line])).toEqual([[1, 0], [2, 2], [3, 4], [4, 6], [5, 8], [6, 10], [1, 12]]);
  });
  it("does not treat fenced code, indented code, formulas, frontmatter or HTML as document headings", () => {
    const result = analyzeDocument('---\ntitle: metadata\n---\n\n```md\n# Code\n```\n\n    # Indented\n\n$$\n# Formula\n$$\n\n<div>\n# HTML\n</div>\n\n## Real\n');
    expect(result.headings.map(({ text, line }) => [text, line])).toEqual([["Real", 18]]);
  });
  it("keeps repeated headings distinct and handles CRLF source positions", () => {
    const result = analyzeDocument("## Same\r\n\r\n## Same\r\n");
    expect(result.headings.map(heading => heading.line)).toEqual([0, 2]);
    expect(new Set(result.headings.map(heading => heading.id)).size).toBe(2);
    expect(result.headings.map(heading => heading.index)).toEqual([0, 1]);
  });
  it("counts readable list and table text while excluding reference definitions and metadata", () => {
    const result = analyzeDocument("---\ntitle: hidden\n---\n\n- [x] **hello**\n- [world][ref]\n\n| A | B |\n|---|---|\n| C | D |\n\n[ref]: https://example.com/ignored\n");
    expect(result.statistics).toEqual({ words: 6, characters: 14 });
    expect(result.headings).toEqual([]);
  });
  it("preserves empty heading entries and never renders HTML", () => {
    const result = analyzeDocument('#\n\n## <span>Title</span>\n');
    expect(result.headings.map(heading => heading.text)).toEqual(["", "Title"]);
  });
  it("matches Muya's document-level outline for headings inside containers", () => {
    expect(analyzeDocument("> # Quoted\n\n- ## Listed\n\n# Document\n").headings.map(heading => heading.text)).toEqual(["Document"]);
  });
  it("counts spaces in whitespace-only documents without counting line breaks", () => {
    expect(analyzeDocument(" \n\n")).toEqual({ statistics: { words: 0, characters: 1 }, headings: [] });
    expect(analyzeDocument("")).toEqual({ statistics: { words: 0, characters: 0 }, headings: [] });
  });
});
