import type SourceEditor from "../components/SourceEditor.vue";
import type { RecoveryView } from "../document/types";
import type { OutlineHeading } from "../services/documentAnalysis";

type SourceView = InstanceType<typeof SourceEditor>;
export function createSourceCommands(current: () => SourceView | null) {
  function captureView(): RecoveryView {
    const editor = current();
    return { scrollTop: editor?.getScrollTop() ?? 0, sourceCursor: editor?.getCursorOffset() ?? undefined };
  }
  function applyView(view: RecoveryView | null | undefined) {
    const editor = current();
    editor?.setCursorOffset(view?.sourceCursor ?? null);
    editor?.setScrollTop(view?.scrollTop ?? 0);
  }
  return {
    focus: () => current()?.focus(), captureView, applyView,
    navigateHeading: (target: OutlineHeading) => {
      const editor = current(); if (!editor) return false;
      editor.goToLine(target.line); return true;
    },
    selectAll: () => current()?.selectAll(), clear: () => current()?.clearUndoably(),
    paste: (data: DataTransfer) => current()?.pasteText(data.getData("text/plain")),
    search: (query: string) => current()?.search(query),
    closeSearch: () => current()?.search(""),
    find: (query: string, forward: boolean) => { if (forward) current()?.findNext(query); else current()?.findPrev(query); },
    replace: (query: string, replacement: string, all: boolean) => {
      if (all) current()?.replaceAll(query, replacement); else current()?.replaceCurrent(query, replacement);
    },
  };
}
