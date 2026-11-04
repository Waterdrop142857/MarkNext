import type CodeMirror from "codemirror";
import { headingLevels, isHeadingCommand, type ParagraphCommand } from "./paragraphCommands";
import { lexBlock } from "../muya/utils/marked/lexBlock";

/** One menu action is one undo group, independent of adjacent typing. */
export function formatSource(editor: CodeMirror.Editor, command: ParagraphCommand): void {
  if (editor.getOption("readOnly") || editor.listSelections().length !== 1) return;
  editor.getDoc().changeGeneration(true);
  editor.operation(() => {
    const from = editor.getCursor("from"), to = editor.getCursor("to");
    if (isHeadingCommand(command)) {
      formatHeading(editor, from, to, headingLevels[command]);
    } else if (command === "insertTable") {
      const line = to.line > from.line && to.ch === 0 ? to.line - 1 : to.line;
      const at = { line, ch: editor.getLine(line).length };
      const prefix = at.ch ? "\n\n" : "";
      const table = "|   |   |   |\n| --- | --- | --- |\n|   |   |   |\n|   |   |   |";
      const offset = editor.indexFromPos(at) + prefix.length + 2;
      editor.replaceRange(prefix + table + "\n\n", at, at, "+paragraph");
      editor.setCursor(editor.posFromIndex(offset));
    } else {
      const start = editor.indexFromPos(from);
      const selected = editor.getRange(from, to);
      if (command === "insertLink" || command === "insertImage") {
        if (from.line !== to.line) return;
        const prefix = command === "insertImage" ? "![" : "[";
        // Preserve existing escapes, and keep a trailing backslash from
        // escaping the closing bracket supplied by this command.
        const label = selected.replace(/\\.|\\$|[\[\]]/g, value => value.length === 1 ? `\\${value}` : value);
        const text = prefix + label + "]()";
        editor.replaceRange(text, from, to, "+paragraph");
        editor.setCursor(editor.posFromIndex(start + text.length - 1));
      } else {
        // Each leaf gets its own markers: emphasis cannot span blank paragraphs.
        const last = to.line > from.line && to.ch === 0 ? to.line - 1 : to.line;
        let top: CodeMirror.Position | undefined, bottom: CodeMirror.Position | undefined;
        for (let line = last; line >= from.line; line--) {
          const text = editor.getLine(line);
          const heading = text.match(/^ {0,3}#{1,6}[ \t]+/)?.[0].length ?? 0;
          const lo = Math.max(line === from.line ? from.ch : 0, heading);
          const hi = line === to.line ? to.ch : text.length;
          if (hi < lo || (last > from.line && !text.slice(lo, hi).trim())) continue;
          const range = formatInline(editor, command, { line, ch: lo }, { line, ch: hi });
          // A cross-line selection includes intermediate closing/opening
          // markers, so keep both boundary markers selected as well.
          bottom ??= last > from.line ? { line, ch: hi + editor.getLine(line).length - text.length } : range.to;
          top = last > from.line ? { line, ch: Math.min(lo, range.from.ch) } : range.from;
        }
        if (top && bottom) editor.setSelection(top, bottom);
      }
    }
  });
  editor.getDoc().changeGeneration(true);
  editor.focus();
}

function formatHeading(editor: CodeMirror.Editor, from: CodeMirror.Position, to: CodeMirror.Position, level: number) {
  let first = from.line;
  let last = to.line > from.line && to.ch === 0 ? to.line - 1 : to.line;
  const setext = new Map<number, number>();
  let line = 0;
  // Parse blocks so thematic breaks, code, HTML and frontmatter delimiters
  // cannot be mistaken for a Setext heading's underline.
  for (const token of lexBlock(editor.getValue())) {
    if (token.type === "heading" && token.headingStyle === "setext") {
      const underline = line + token.raw.trimEnd().split("\n").length - 1;
      if (line <= last && underline >= first) {
        setext.set(line, underline);
        first = Math.min(first, line);
        last = Math.max(last, underline);
      }
    }
    line += (token.raw.match(/\n/g) ?? []).length;
  }
  const prefix = level ? `${"#".repeat(level)} ` : "";
  const next: string[] = [];
  for (line = first; line <= last; line++) {
    const underline = setext.get(line);
    if (underline !== undefined) {
      const text = editor.getRange({ line, ch: 0 }, { line: underline - 1, ch: editor.getLine(underline - 1).length });
      if (level) next.push(prefix + text.split("\n").map(part => part.trim()).join(" "));
      else next.push(...text.split("\n"));
      line = underline;
    } else {
      next.push(prefix + editor.getLine(line).replace(/^ {0,3}#{1,6}(?:[ \t]+|$)/, ""));
    }
  }
  editor.replaceRange(next.join("\n"), { line: first, ch: 0 }, { line: last, ch: editor.getLine(last).length }, "+paragraph");
  editor.setSelection({ line: first, ch: prefix.length }, { line: first + next.length - 1, ch: next[next.length - 1].length });
}

type InlineCommand = "bold" | "italic" | "strikethrough";
function formatInline(editor: CodeMirror.Editor, command: InlineCommand, from: CodeMirror.Position, to: CodeMirror.Position) {
  let start = from.ch, end = to.ch;
  const value = editor.getLine(from.line), selected = value.slice(start, end);
  const position = (ch: number) => ({ line: from.line, ch });
  const markers = { bold: "**", italic: "*", strikethrough: "~~" } as const;
  const marker = markers[command];
  const n = marker.length;
  // Keep whitespace outside emphasis so the result is valid Markdown.
  if (selected.trim()) {
    start += selected.length - selected.trimStart().length;
    end -= selected.length - selected.trimEnd().length;
  }
  const text = value.slice(start, end);
  const hasItalic = (left: string, right: string) => (left.match(/\*+$/)?.[0].length ?? 0) % 2 === 1
    && (right.match(/^\*+/)?.[0].length ?? 0) % 2 === 1;
  const wrapped = text.length >= n * 2 && text.startsWith(marker) && text.endsWith(marker)
    && (command !== "italic" || hasItalic(text.match(/^\*+/)?.[0] ?? "", text.match(/\*+$/)?.[0] ?? ""));
  const surrounded = start >= n && value.slice(start - n, start) === marker && value.slice(end, end + n) === marker
    && (command !== "italic" || hasItalic(value.slice(0, start), value.slice(end)));
  if (wrapped) {
    editor.replaceRange(text.slice(n, -n), position(start), position(end), "+paragraph");
    return { from: position(start), to: position(end - n * 2) };
  } else if (surrounded) {
    editor.replaceRange(text, position(start - n), position(end + n), "+paragraph");
    return { from: position(start - n), to: position(end - n) };
  } else {
    editor.replaceRange(marker + text + marker, position(start), position(end), "+paragraph");
    return { from: position(start + n), to: position(end + n) };
  }
}
