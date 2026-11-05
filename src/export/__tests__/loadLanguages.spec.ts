// @vitest-environment jsdom
import { expect, it } from "vitest";
import { loadPdfLanguages } from "../loadLanguages";
import { getHighlightHtml } from "../../muya/utils/marked";

it("loads code grammars in an independent export context, including nested fences and aliases", async () => {
  const markdown = '```typescript\nconst answer: number = 42;\n```\n\n> ```c++\n> int value = 1;\n> ```';
  await loadPdfLanguages(markdown);
  const html = getHighlightHtml(markdown);
  expect(html).toContain('class="token keyword"');
  expect(html).toContain('class="token number"');
  expect(html).toContain('language-typescript');
  expect(html).toContain('language-c++');
});

it("accepts documents without code grammars and leaves diagram rendering to its own pipeline", async () => {
  await expect(loadPdfLanguages("# Plain document")).resolves.toBeUndefined();
  await expect(loadPdfLanguages("```mermaid\ngraph LR; A-->B\n```")).resolves.toBeUndefined();
});
