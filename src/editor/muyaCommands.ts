import type { Muya } from "../muya";
import type { IHistorySelection } from "../muya/selection/types";
import type { RecoveryView } from "../document/types";
import type { OutlineHeading } from "../services/documentAnalysis";

/** Engine-specific interactions remain behind the session's lifetime guard. */
export function createMuyaCommands(current: () => Muya | null) {
  function selection(): IHistorySelection | null {
    const value = current()?.getSelection();
    if (!value?.anchor || !value.focus) return null;
    return {
      anchor: { offset: value.anchor.offset, path: [...value.anchor.path] },
      focus: { offset: value.focus.offset, path: [...value.focus.path] },
      isCollapsed: value.isCollapsed, isSelectionInSameBlock: value.isSelectionInSameBlock,
      direction: value.direction, type: value.type,
    };
  }
  function captureView(): RecoveryView {
    return { scrollTop: current()?.domNode.parentElement?.scrollTop ?? 0, muyaSelection: selection() ?? undefined };
  }
  function applyView(view: RecoveryView | null | undefined) {
    const editor = current();
    if (!editor) return;
    const value = view?.muyaSelection;
    if (value) editor.setCursor({ anchor: value.anchor, anchorPath: value.anchor.path, focus: value.focus, focusPath: value.focus.path });
    const scrollHost = editor.domNode.parentElement;
    if (scrollHost) scrollHost.scrollTop = view?.scrollTop ?? 0;
  }
  function navigateHeading(target: OutlineHeading): boolean {
    const editor = current();
    if (!editor?.editor.scrollPage) return false;
    let index = 0;
    for (const block of editor.editor.scrollPage.children.iterator()) {
      if (block.blockName !== "atx-heading" && block.blockName !== "setext-heading") continue;
      if (index++ !== target.index || !block.isParent()) continue;
      const content = block.firstContentInDescendant();
      if (!content) return false;
      editor.focus();
      const offset = block.blockName === "atx-heading" ? Math.min(target.level + 1, content.text.length) : 0;
      content.setCursor(offset, offset, true);
      block.domNode?.scrollIntoView({ block: "center", inline: "nearest" });
      return true;
    }
    return false;
  }
  function search(query: string) {
    const editor = current();
    if (editor) { editor.flush(); editor.search(query); }
  }
  function find(query: string, forward: boolean) {
    const editor = current();
    if (!editor) return;
    editor.flush();
    if (editor.editor.searchModule.value !== query) {
      editor.search(query);
      if (!forward) editor.find("previous");
    } else editor.find(forward ? "next" : "previous");
  }
  function replace(query: string, replacement: string, all: boolean) {
    const editor = current();
    if (!editor) return;
    editor.flush();
    if (editor.editor.searchModule.value !== query) editor.search(query);
    editor.replace(replacement, { isSingle: !all, isRegexp: false });
  }
  return {
    focus: () => current()?.focus(), captureView, applyView, navigateHeading,
    selectAll: () => current()?.selectAllDocument(),
    clear: (markdown: string) => { const editor = current(); if (editor && markdown) editor.replaceContent("", selection() ?? undefined); },
    paste: async (data: DataTransfer) => { await current()?.editor.clipboard.pasteHandler(new ClipboardEvent("paste", { clipboardData: data })); },
    search, find, replace,
    closeSearch: () => current()?.search("", { selectHighlight: true }),
  };
}
