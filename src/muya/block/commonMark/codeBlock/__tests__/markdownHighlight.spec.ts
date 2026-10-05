// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Muya } from "../../../../muya";
import CodeBlockContent from "../../../content/codeBlockContent";
import prism, { loadLanguage, transformAliasToOrigin } from "../../../../utils/prism";
import { getHighlightHtml } from "../../../../utils/marked/getHighlightHtml";

const editors: Muya[] = [];
let previousVersion: string | undefined;

beforeEach(() => {
  previousVersion = window.MUYA_VERSION;
  window.MUYA_VERSION = "test";
});

afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy());
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
  if (previousVersion === undefined) delete (window as Partial<Window>).MUYA_VERSION;
  else window.MUYA_VERSION = previousVersion;
});

function boot(info: string, text: string) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  // Four backticks allow Markdown examples containing nested three-backtick
  // fences to stay literal code instead of closing the surrounding block.
  const editor = new Muya(host, { markdown: `\`\`\`\`${info}\n${text}\n\`\`\`\`` });
  editor.init();
  editors.push(editor);
  return editor;
}

describe("Markdown fenced-code highlighting", () => {
  it.each(["Markdown", "markdown", "md", "MARKDOWN", "MD", 'Markdown title="example"'])
    ("highlights %s code without interpreting it as rendered Markdown", async info => {
      const text = "# Heading\n\n**bold** *italic* ~~deleted~~ `inline code`\n\n"
        + "[link](https://example.test)\n![image](image.png)\n\n> quote\n\n- item\n1. numbered\n\n"
        + "| Header | Other |\n| --- | --- |\n| a | b |\n\n```js\nconst value = 1;\n```";
      const editor = boot(info, text);
      await vi.waitFor(() => {
        const code = editor.domNode.querySelector(".mu-codeblock-content")!;
        for (const token of ["title", "bold", "italic", "strike", "code-snippet", "url", "blockquote", "list", "table", "code"]) {
          expect(code.querySelector(`.token.${token}`), token).not.toBeNull();
        }
        expect(code.textContent).toBe(text);
        // Source examples remain text; highlighting must not create links,
        // images or editor headings inside the code block.
        expect(code.querySelector("h1, a, img, table")).toBeNull();
      });
      expect(editor.getMarkdown()).toContain(`\`\`\`\`${info}\n${text}`);
      const exported = document.createElement("div");
      exported.innerHTML = getHighlightHtml(editor.getMarkdown());
      expect(exported.querySelector("code .token.title")).not.toBeNull();
      expect(exported.querySelector("code .token.bold")).not.toBeNull();
    });

  it("re-highlights content edits without replacing the editor instance", async () => {
    const editor = boot("Markdown", "# Old heading");
    const root = editor.domNode;
    await vi.waitFor(() => expect(root.querySelector(".token.title")).not.toBeNull());
    const block = editor.editor.scrollPage!.queryBlock([0, "text"]);
    if (!(block instanceof CodeBlockContent)) throw new Error("Expected editable code content");
    block.text = "## New heading\n\n**New bold**";
    editor.flush();
    await vi.waitFor(() => expect(root.querySelector(".token.bold")?.textContent).toBe("**New bold**"));
    expect(editor.domNode).toBe(root);
    expect(editor.getMarkdown()).toContain("**New bold**");
  });

  it("loads canonical grammars for mixed-case language IDs and aliases", async () => {
    expect(transformAliasToOrigin(["Markdown", "MD", "JavaScript", "JS", "C++"]))
      .toEqual(["markdown", "markdown", "javascript", "javascript", "cpp"]);
    await loadLanguage("Markdown");
    expect(prism.languages.markdown).toBeDefined();
    expect(prism.highlight("# Heading", prism.languages.markdown, "markdown"))
      .toContain('class="token title important"');
  });
});
