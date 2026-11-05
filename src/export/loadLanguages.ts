import { Marked } from "marked";
import { loadLanguage } from "../muya/utils/prism";
import { firstWordOfInfo } from "../muya/utils";

const diagrams = new Set(["mermaid", "plantuml", "vega-lite", "flowchart", "sequence"]);

/** A new export WebView has its own Prism registry; it cannot reuse grammars
 * previously loaded by the editor in the main window. */
export async function loadPdfLanguages(markdown: string): Promise<void> {
  const parser = new Marked();
  const languages = new Set<string>();
  parser.walkTokens(parser.lexer(markdown), token => {
    if (token.type !== "code" || !token.lang) return;
    const language = firstWordOfInfo(token.lang).toLowerCase();
    if (language && !diagrams.has(language)) languages.add(language);
  });
  if (languages.size) await loadLanguage([...languages]);
}
