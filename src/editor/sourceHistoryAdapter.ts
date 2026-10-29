import CodeMirror from "codemirror";
import type { SourceCheckpoint, SourceHistoryAdapter } from "./sessionTypes";
import { adapterLifecycle, type AdapterContext } from "./adapterLifecycle";
import { cloneData, decodeSourceCheckpoint, encodeSourceHistory, freezeData, integer, matchesRevision, record, sourcePosition } from "./checkpointCodec";

export function createSourceHistoryAdapter(initial: CodeMirror.Editor, context: AdapterContext): SourceHistoryAdapter {
  let cm: CodeMirror.Editor | null = initial;
  const lifecycle = adapterLifecycle(initial.getWrapperElement(), context);
  function breakGroup() { cm?.getDoc().changeGeneration(true); }
  return {
    engine: "codemirror5", lease: lifecycle.lease,
    status: () => ({ ...(cm?.historySize() ?? { undo: 0, redo: 0 }), composing: lifecycle.blocked() }),
    flush() { /* CodeMirror operations synchronously commit changes. */ },
    breakHistoryGroup: breakGroup,
    undo() {
      if (!cm || !lifecycle.live() || lifecycle.blocked() || !cm.historySize().undo) return false;
      cm.undo(); return true;
    },
    redo() {
      if (!cm || !lifecycle.live() || lifecycle.blocked() || !cm.historySize().redo) return false;
      cm.redo(); return true;
    },
    capture(identity) {
      if (!cm || !lifecycle.live()) return { ok: false, reason: "disposed" };
      if (lifecycle.blocked()) return { ok: false, reason: "composing" };
      const current = lifecycle.identity();
      if (!current || !matchesRevision(identity, current)) return { ok: false, reason: "mismatch" };
      breakGroup();
      const selections = cm.listSelections();
      const head = cm.getCursor("head"), anchor = cm.getCursor("anchor");
      const primary = selections.findIndex(range => CodeMirror.cmpPos(range.head, head) === 0 && CodeMirror.cmpPos(range.anchor, anchor) === 0);
      const scroll = cm.getScrollInfo();
      return { ok: true, checkpoint: freezeData<SourceCheckpoint>({
        version: 1, engine: "codemirror5", ...identity, markdown: cm.getValue(),
        lineSeparator: (cm.getOption("lineSeparator") ?? null) as SourceCheckpoint["lineSeparator"],
        history: encodeSourceHistory(cm.getHistory()),
        selection: { ranges: selections.map(range => ({ anchor: { ...range.anchor }, head: { ...range.head } })), primary: Math.max(primary, 0) },
        scroll: { top: scroll.top, left: scroll.left },
      }) };
    },
    restore(input, expected) {
      if (!cm || !lifecycle.live()) return { ok: false, reason: "disposed" };
      if (lifecycle.blocked()) return { ok: false, reason: "invalid" };
      if (input.version !== 1 || input.engine !== "codemirror5") return { ok: false, reason: "unsupported" };
      if (expected.documentId !== lifecycle.lease.documentId || !matchesRevision(input, expected)) return { ok: false, reason: "mismatch" };
      let checkpoint: SourceCheckpoint;
      try { checkpoint = decodeSourceCheckpoint(input); }
      catch { return { ok: false, reason: "invalid" }; }
      const editor = cm;
      let validView = false;
      lifecycle.silently(() => {
        editor.operation(() => {
          editor.setOption("lineSeparator", checkpoint.lineSeparator);
          editor.setValue(checkpoint.markdown);
          const selection = checkpoint.selection;
          if (record(selection) && Array.isArray(selection.ranges) && selection.ranges.length
            && integer(selection.primary) && selection.primary < selection.ranges.length
            && selection.ranges.every(range => record(range) && [range.anchor, range.head].every(point =>
              sourcePosition(point) && point.line <= editor.lastLine() && point.ch <= editor.getLine(point.line).length))) {
            editor.setSelections(cloneData(selection.ranges), selection.primary, { scroll: false });
            validView = true;
          }
          else editor.setCursor(0, 0);
        });
        // setValue/setSelections record native history. Import LAST, after
        // selection restoration, so neither action contaminates undo/redo.
        editor.setHistory(cloneData(checkpoint.history));
        breakGroup();
        editor.scrollTo(checkpoint.scroll.left, checkpoint.scroll.top);
      });
      return { ok: true, view: validView ? "restored" : "fallback" };
    },
    destroy() {
      if (!cm) return;
      cm = null;
      lifecycle.dispose();
    },
  };
}
