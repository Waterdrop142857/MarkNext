<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { t, useI18n } from "../i18n";
import CodeMirror from "codemirror";
import "codemirror/lib/codemirror.css";
import "codemirror/mode/markdown/markdown.js";
import "codemirror/addon/search/searchcursor";
import { createSourceHistoryAdapter } from "../editor/sourceHistoryAdapter";
import type { DocumentRevision, RendererLease, SourceCheckpoint, SourceHistoryAdapter } from "../editor/sessionTypes";

const props = withDefaults(defineProps<{ modelValue?: string; active?: boolean; identity?: DocumentRevision; lease?: RendererLease; checkpoint?: SourceCheckpoint | null }>(), {
  modelValue: "",
  active: true,
});

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "ready"): void;
  (e: "restore-error", error: unknown): void;
}>();

const containerRef = ref<HTMLElement | null>(null);
let cm: CodeMirror.Editor | null = null;
let suppressModelEmission = false;
const { locale } = useI18n();
let searchValue = "";
let searchMarks: CodeMirror.TextMarker[] = [];
let history: SourceHistoryAdapter | null = null;
let disposed = false;
let pendingScroll = props.checkpoint?.scroll ?? null;
const standalone = { documentId: "standalone", revision: 0 };

function refreshLayout() { cm?.refresh(); }

onMounted(() => {
  window.addEventListener("resize", refreshLayout);
  if (!containerRef.value) return;

  cm = CodeMirror(containerRef.value, {
    value: props.modelValue,
    mode: {
      name: "markdown",
      taskLists: true,
    },
    lineNumbers: true,
    lineWrapping: true,
    theme: "default",
    viewportMargin: 10,
    readOnly: !props.active,
    screenReaderLabel: t("command.toggleMode"),
  });

  // One model/highlight update per CodeMirror operation (including replace-all).
  cm.on("changes", () => {
    if (!cm || suppressModelEmission) return;
    emit("update:modelValue", cm.getValue());
    updateSearchMarks();
  });
  cm.clearHistory();
  const lease = props.lease ?? { documentId: (props.identity ?? standalone).documentId, activation: 0 };
  history = createSourceHistoryAdapter(cm, {
    lease,
    identity: () => props.identity ?? standalone,
    isCurrent: () => !disposed && (props.identity ?? standalone).documentId === lease.documentId
      && (!props.lease || props.lease.activation === lease.activation),
    silently(action) { suppressModelEmission = true; try { action(); } finally { suppressModelEmission = false; } },
    cleanup,
  });
  if (props.checkpoint) {
    try {
      const result = history.restore(props.checkpoint, props.identity ?? standalone);
      if (!result.ok) throw new Error(`Cannot restore source history: ${result.reason}`);
    }
    catch (error) { history.destroy(); emit("restore-error", error); return; }
  }
  emit("ready");
  void nextTick(() => { if (props.active && !disposed) restoreScroll(); });
});

watch(
  () => props.modelValue,
  (value) => {
    if (!cm) return;
    if (value !== cm.getValue()) {
      suppressModelEmission = true;
      try {
        cm.setValue(value ?? "");
        // WYSIWYG changes invalidate offsets from the previous source session.
        cm.clearHistory();
        updateSearchMarks();
      }
      finally {
        suppressModelEmission = false;
      }
    }
  },
);

watch(locale, () => cm?.setOption("screenReaderLabel", t("command.toggleMode")));

watch(() => props.active, async (active) => {
  cm?.setOption("readOnly", !active);
  if (active) { await nextTick(); cm?.refresh(); restoreScroll(); }
});

function restoreScroll() {
  if (!cm || !pendingScroll || disposed) return;
  cm.scrollTo(pendingScroll.left, pendingScroll.top);
  pendingScroll = null;
}

function cleanup() {
  disposed = true;
  window.removeEventListener("resize", refreshLayout);
  searchMarks.forEach(mark => mark.clear());
  searchMarks = [];
  cm?.getInputField().blur();
  cm?.setOption("readOnly", "nocursor");
  cm?.getWrapperElement().remove();
  cm = null;
}

onBeforeUnmount(() => {
  if (history) history.destroy(); else cleanup();
  history = null;
});

function updateSearchMarks(query = searchValue) {
  searchValue = query;
  searchMarks.forEach(mark => mark.clear());
  searchMarks = [];
  if (!cm || !query) return;
  const cursor = cm.getSearchCursor(query, CodeMirror.Pos(0, 0), true);
  while (cursor.findNext()) searchMarks.push(cm.markText(cursor.from(), cursor.to(), { className: "cm-search-match" }));
}

function search(query: string) {
  updateSearchMarks(query);
  if (!cm || !query) return false;
  const cursor = cm.getSearchCursor(query, CodeMirror.Pos(0, 0), true);
  if (!cursor.findNext()) return false;
  cm.setSelection(cursor.from(), cursor.to());
  cm.scrollIntoView(cursor.from());
  return true;
}

function findNext(query: string): boolean {
  if (!cm || !query) return false;
  updateSearchMarks(query);
  const cursor = cm.getSearchCursor(query, cm.getCursor("to"), true);
  if (cursor.findNext()) {
    cm.setSelection(cursor.from(), cursor.to());
    cm.scrollIntoView(cursor.from());
    return true;
  }

  // Wrap to the top.
  const wrapped = cm.getSearchCursor(query, CodeMirror.Pos(0, 0), true);
  if (wrapped.findNext()) {
    cm.setSelection(wrapped.from(), wrapped.to());
    cm.scrollIntoView(wrapped.from());
    return true;
  }

  return false;
}

function findPrev(query: string): boolean {
  if (!cm || !query) return false;
  updateSearchMarks(query);
  const cursor = cm.getSearchCursor(query, cm.getCursor("from"), true);
  if (cursor.findPrevious()) {
    cm.setSelection(cursor.from(), cursor.to());
    cm.scrollIntoView(cursor.from());
    return true;
  }

  // Wrap to the bottom.
  const lastLine = cm.lastLine();
  const lastLineLength = cm.getLine(lastLine).length;
  const wrapped = cm.getSearchCursor(query, CodeMirror.Pos(lastLine, lastLineLength), true);
  if (wrapped.findPrevious()) {
    cm.setSelection(wrapped.from(), wrapped.to());
    cm.scrollIntoView(wrapped.from());
    return true;
  }

  return false;
}

function replaceCurrent(query: string, replacement: string): boolean {
  if (!cm || !query || cm.listSelections().length !== 1) return false;
  const cursor = cm.getSearchCursor(query, cm.getCursor("from"), true);
  if (!cursor.findNext()) return false;
  const from = cm.getCursor("from"), to = cm.getCursor("to");
  if (CodeMirror.cmpPos(cursor.from(), from) !== 0 || CodeMirror.cmpPos(cursor.to(), to) !== 0) return false;
  cm.replaceSelection(replacement, "end", "+replace");
  findNext(query);
  return true;
}

function replaceAll(query: string, replacement: string) {
  const editor = cm;
  if (!editor || !query) return;
  editor.operation(() => {
    const cursor = editor.getSearchCursor(query, CodeMirror.Pos(0, 0), true);
    while (cursor.findNext()) {
      cursor.replace(replacement);
    }
  });
}

function getCursorOffset(): { anchor: { line: number; ch: number }; focus: { line: number; ch: number } } | null {
  if (!cm) return null;
  const head = cm.getCursor("head");
  const anchor = cm.getCursor("anchor");
  return {
    anchor: { line: anchor.line, ch: anchor.ch },
    focus: { line: head.line, ch: head.ch },
  };
}

function setCursorOffset(cursor: { anchor: { line: number; ch: number }; focus: { line: number; ch: number } } | null) {
  if (!cm || !cursor?.anchor || !cursor?.focus) return;
  cm.setSelection(
    { line: cursor.anchor.line, ch: cursor.anchor.ch },
    { line: cursor.focus.line, ch: cursor.focus.ch },
    { scroll: true },
  );
}

function clearUndoably() {
  if (!cm || !cm.getValue()) return;
  const lastLine = cm.lastLine();
  const lastLineLength = cm.getLine(lastLine).length;
  cm.replaceRange("", CodeMirror.Pos(0, 0), CodeMirror.Pos(lastLine, lastLineLength), "+input");
}

defineExpose({
  getValue: () => cm?.getValue() ?? "",
  setValue: (value: string) => {
    cm?.setValue(value);
    emit("update:modelValue", value);
  },
  focus: () => cm?.focus(),
  selectAll: () => {
    if (!cm) return;
    const last = cm.lastLine();
    cm.setSelection(CodeMirror.Pos(cm.firstLine(), 0), CodeMirror.Pos(last, cm.getLine(last).length));
  },
  undo: () => history?.undo(),
  redo: () => history?.redo(),
  getHistoryAdapter: () => history,
  pasteText: (text: string) => cm?.replaceSelection(text, "end", "+input"),
  search,
  findNext,
  findPrev,
  replaceCurrent,
  replaceAll,
  getCursorOffset,
  setCursorOffset,
  getScrollTop: () => cm?.getScrollInfo().top ?? 0,
  setScrollTop: (top: number) => cm?.scrollTo(null, top),
  goToLine: (line: number) => {
    if (!cm) return;
    const position = CodeMirror.Pos(Math.max(0, Math.min(line, cm.lastLine())), 0);
    cm.setCursor(position);
    cm.scrollIntoView(position, 64);
    cm.focus();
  },
  clearUndoably,
});
</script>

<template>
  <div ref="containerRef" class="source-editor" />
</template>

<style>
/* Keep the former style submodule available to Vite HMR clients. The editor's
   actual styles live in styles/source-editor.css. */
</style>
