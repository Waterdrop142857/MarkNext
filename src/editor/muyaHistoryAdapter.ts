import type { Muya } from "../muya";
import type { IMuyaOptions } from "../muya/types";
import type { TState } from "../muya/state/types";
import type { MuyaCheckpoint, MuyaHistoryAdapter, MuyaParseProfile, MuyaSelectionSnapshot, RestoreResult } from "./sessionTypes";
import { SelectionCaretType } from "../muya/selection/types";
import { adapterLifecycle, type AdapterContext } from "./adapterLifecycle";
import { cloneData, decodeMuyaCheckpoint, freezeData, matchesRevision, mutableHistory } from "./checkpointCodec";

export function parseProfile(options: IMuyaOptions): MuyaParseProfile {
  return {
    isGitlabCompatibilityEnabled: options.isGitlabCompatibilityEnabled,
    math: options.math, footnote: options.footnote, frontMatter: options.frontMatter,
    trimUnnecessaryCodeBlockEmptyLines: options.trimUnnecessaryCodeBlockEmptyLines,
  };
}

export function captureMuyaSelection(muya: Muya): MuyaSelectionSnapshot | null {
  const selection = muya.getSelection();
  if (!selection?.anchor || !selection.focus) return null;
  return {
    anchor: { offset: selection.anchor.offset, path: [...selection.anchor.path] },
    focus: { offset: selection.focus.offset, path: [...selection.focus.path] },
    direction: selection.direction, type: selection.type,
    isCollapsed: selection.isCollapsed, isSelectionInSameBlock: selection.isSelectionInSameBlock,
  };
}

function applySelection(muya: Muya, selection: MuyaSelectionSnapshot | null): RestoreResult["ok"] {
  try {
    if (selection && (selection.type === SelectionCaretType.CARET || selection.type === SelectionCaretType.RANGE)) {
      const { anchor, focus } = selection;
      for (const endpoint of [anchor, focus]) {
        const block = muya.editor.scrollPage!.queryBlock([...endpoint.path]);
        if (!block || !block.isContent() || !Number.isSafeInteger(endpoint.offset)
          || endpoint.offset < 0 || endpoint.offset > block.text.length) throw new Error("Stale selection");
      }
      muya.setCursor({ anchor, anchorPath: [...anchor.path], focus, focusPath: [...focus.path] });
      return true;
    }
  }
  catch { /* Only view metadata is allowed to fall back. */ }
  muya.editor.scrollPage?.firstContentInDescendant()?.setCursor(0, 0, true);
  return false;
}

export function createMuyaHistoryAdapter(initial: Muya, context: AdapterContext, prepared?: MuyaCheckpoint | null): MuyaHistoryAdapter {
  let muya: Muya | null = initial;
  let scrollHost: HTMLElement | null = context.scrollHost ?? initial.domNode;
  // A wrapper can initialize directly from a validated checkpoint's JSON.
  // Consume this hint once to avoid building that same block tree twice.
  let preloaded = prepared;
  const lifecycle = adapterLifecycle(initial.domNode, context);
  return {
    engine: "muya", lease: lifecycle.lease,
    status: () => ({ ...(muya?.editor.history.size() ?? { undo: 0, redo: 0 }), composing: lifecycle.blocked() }),
    flush: () => { if (lifecycle.live()) muya?.flush(); },
    breakHistoryGroup: () => muya?.editor.history.breakGroup(),
    undo() {
      if (!muya || muya.busy || !lifecycle.live() || lifecycle.blocked()) return false;
      muya.flush();
      if (!muya.editor.history.canUndo()) return false;
      muya.undo(); return true;
    },
    redo() {
      if (!muya || muya.busy || !lifecycle.live() || lifecycle.blocked()) return false;
      muya.flush();
      if (!muya.editor.history.canRedo()) return false;
      muya.redo(); return true;
    },
    capture(identity) {
      if (!muya || !lifecycle.live()) return { ok: false, reason: "disposed" };
      if (lifecycle.blocked()) return { ok: false, reason: "composing" };
      if (muya.busy) return { ok: false, reason: "busy" };
      muya.flush();
      const current = lifecycle.identity();
      if (!current || !matchesRevision(identity, current)) return { ok: false, reason: "mismatch" };
      muya.editor.history.breakGroup();
      return { ok: true, checkpoint: freezeData<MuyaCheckpoint>({
        version: 1, engine: "muya", ...identity,
        markdown: muya.getMarkdown(), state: muya.getState(), history: muya.getHistory(),
        selection: captureMuyaSelection(muya), parseProfile: parseProfile(muya.options),
        scroll: { top: scrollHost?.scrollTop ?? 0, left: scrollHost?.scrollLeft ?? 0 },
      }) };
    },
    restore(input, expected) {
      if (!muya || !lifecycle.live()) return { ok: false, reason: "disposed" };
      if (lifecycle.blocked()) return { ok: false, reason: "invalid" };
      if (input.version !== 1 || input.engine !== "muya") return { ok: false, reason: "unsupported" };
      if (expected.documentId !== lifecycle.lease.documentId || !matchesRevision(input, expected)) return { ok: false, reason: "mismatch" };
      let checkpoint: MuyaCheckpoint;
      try {
        checkpoint = decodeMuyaCheckpoint(input);
        const profile = parseProfile(muya.options);
        if ((Object.keys(profile) as (keyof MuyaParseProfile)[]).some(key => checkpoint.parseProfile[key] !== profile[key])) return { ok: false, reason: "unsupported" };
        // Check that the cached text belongs to this structure, using the same
        // serializer without mutating the live document or its undo stack.
        if (muya.editor.jsonState.getMarkdownFromState(cloneData<TState[]>(checkpoint.state)) !== checkpoint.markdown) return { ok: false, reason: "invalid" };
      }
      catch { return { ok: false, reason: "invalid" }; }
      let view = false;
      const editor = muya;
      lifecycle.silently(() => {
        if (preloaded !== input) editor.setContent(cloneData<TState[]>(checkpoint.state));
        preloaded = null;
        editor.setHistory(mutableHistory(checkpoint.history));
        editor.editor.history.breakGroup();
        view = applySelection(editor, checkpoint.selection);
        if (scrollHost) {
          scrollHost.scrollTop = checkpoint.scroll.top;
          scrollHost.scrollLeft = checkpoint.scroll.left;
        }
      });
      return { ok: true, view: view ? "restored" : "fallback" };
    },
    destroy() {
      if (!muya) return;
      muya = null;
      scrollHost = null;
      preloaded = null;
      lifecycle.dispose();
    },
  };
}
