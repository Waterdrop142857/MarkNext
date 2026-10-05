import { nextTick, ref, watch, type Ref } from "vue";

export interface CursorPosition {
  line: number;
  ch: number;
}

export interface CursorSnapshot {
  anchor: CursorPosition | null;
  focus: CursorPosition | null;
}

export interface MuyaCursorSnapshot {
  anchor: { offset: number; path: number[] };
  focus: { offset: number; path: number[] };
}

export type HistoryCursor = CursorSnapshot | MuyaCursorSnapshot | null;

export interface HistoryEntry {
  markdown: string;
  cursor: HistoryCursor;
}

export interface HistoryCursorBridge {
  getCursor?: () => HistoryCursor;
  getFallbackCursor?: () => HistoryCursor;
  setCursor?: (cursor: HistoryCursor) => void;
}

const COALESCE_MS = 350;
const MAX_STACK = 100;

export function useHistory(
  markdown: Ref<string>,
  bridge: HistoryCursorBridge = {},
) {
  const undoStack = ref<HistoryEntry[]>([]);
  const redoStack = ref<HistoryEntry[]>([]);
  const isApplyingHistory = ref(false);
  const pendingCursor = ref<HistoryCursor>(null);
  let lastChangeAt = 0;

  watch(markdown, (value, oldValue) => {
    if (isApplyingHistory.value || value === oldValue) return;

    redoStack.value = [];
    const now = Date.now();

    // Coalesce continuous input: keep the earliest snapshot of the current
    // input group and ignore intermediate states.
    if (lastChangeAt !== 0 && now - lastChangeAt < COALESCE_MS && undoStack.value.length > 0) {
      pendingCursor.value = null;
      lastChangeAt = now;
      return;
    }

    undoStack.value.push({
      markdown: oldValue,
      cursor: pendingCursor.value ?? bridge.getFallbackCursor?.() ?? null,
    });
    pendingCursor.value = null;
    if (undoStack.value.length > MAX_STACK) {
      undoStack.value.shift();
    }
    lastChangeAt = now;
  });

  function captureCursor(cursor: HistoryCursor) {
    pendingCursor.value = cursor;
  }

  function apply(value: string, cursor: HistoryCursor) {
    isApplyingHistory.value = true;
    markdown.value = value;
    void nextTick(() => {
      isApplyingHistory.value = false;
      bridge.setCursor?.(cursor);
    });
  }

  function canUndo() {
    return undoStack.value.length > 0;
  }

  function canRedo() {
    return redoStack.value.length > 0;
  }

  function undo(): boolean {
    if (!canUndo()) return false;
    const entry = undoStack.value.pop()!;
    redoStack.value.push({
      markdown: markdown.value,
      cursor: bridge.getCursor?.() ?? null,
    });
    lastChangeAt = 0;
    pendingCursor.value = null;
    apply(entry.markdown, entry.cursor);
    return true;
  }

  function redo(): boolean {
    if (!canRedo()) return false;
    const entry = redoStack.value.pop()!;
    undoStack.value.push({
      markdown: markdown.value,
      cursor: bridge.getCursor?.() ?? null,
    });
    lastChangeAt = 0;
    pendingCursor.value = null;
    apply(entry.markdown, entry.cursor);
    return true;
  }

  function clear() {
    undoStack.value = [];
    redoStack.value = [];
    pendingCursor.value = null;
    lastChangeAt = 0;
  }

  return { undo, redo, canUndo, canRedo, clear, captureCursor, undoStack, redoStack };
}