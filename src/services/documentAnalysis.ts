import { lexBlock } from "../muya/utils/marked/lexBlock";
import type { TLexedToken } from "../muya/utils/marked/types";
import { tokenizer, tokensToPlainText } from "../muya/inlineRenderer/lexer";
import type { Labels } from "../muya/inlineRenderer/types";

export interface DocumentStatistics { words: number; characters: number }
export interface OutlineHeading { id: string; level: number; text: string; line: number; index: number }
export interface DocumentAnalysis { statistics: DocumentStatistics; headings: OutlineHeading[] }

export function countText(text: string): DocumentStatistics {
  let chinese = 0;
  const other = text.replace(/\p{Script=Han}/gu, () => { chinese++; return " "; });
  return {
    words: chinese + (other.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0),
    characters: Array.from(text.replace(/\s/gu, "")).length,
  };
}

export function analyzeDocument(markdown: string): DocumentAnalysis {
  const tokens = lexBlock(markdown.replace(/\r\n?/g, "\n"));
  const labels: Labels = new Map();
  function children(token: TLexedToken): TLexedToken[] {
    if (token.type === "list") return token.items.flatMap(item => item.tokens as TLexedToken[]);
    if (token.type === "blockquote" || token.type === "footnote") return token.tokens as TLexedToken[];
    return [];
  }
  function collectReferences(tokens: TLexedToken[]) {
    for (const token of tokens) {
      if (token.type === "def") labels.set(token.tag.toLowerCase(), { href: token.href, title: token.title ?? "" });
      collectReferences(children(token));
    }
  }
  collectReferences(tokens);
  function plain(text: string): string {
    // Ordinary long paragraphs need no second inline-tokenization pass.
    if (!/[*_`[\]<>!~\\&$^]/.test(text)) return text;
    return tokensToPlainText(tokenizer(text, { hasBeginRules: false, labels }));
  }
  function blockText(tokens: TLexedToken[]): string {
    return tokens.map(token => {
      switch (token.type) {
        case "space": case "hr": case "def": case "frontmatter": return "";
        case "list": case "blockquote": case "footnote": return blockText(children(token));
        case "table": return [token.header, ...token.rows].map(row => row.map(cell => plain(cell.text)).join(" ")).join("\n");
        case "code": case "multiplemath": return token.text;
        default: return "text" in token && typeof token.text === "string" ? plain(token.text) : "";
      }
    }).join("\n");
  }
  const headings: OutlineHeading[] = [];
  let line = 0;
  // Match Muya's document-level TOC: quoted/list headings belong to their
  // container, while code, math, HTML and frontmatter cannot create entries.
  for (const token of tokens) {
    if (token.type === "heading") {
      headings.push({ id: `heading-${line}`, level: token.depth, text: plain(token.text).trim(), line, index: headings.length });
    }
    line += (token.raw.match(/\n/g) ?? []).length;
  }
  return { statistics: countText(blockText(tokens)), headings };
}
