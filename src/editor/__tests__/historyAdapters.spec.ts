import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CodeMirror from "codemirror";
import { Muya } from "../../muya/muya";
import { createMuyaHistoryAdapter } from "../muyaHistoryAdapter";
import { createSourceHistoryAdapter } from "../sourceHistoryAdapter";
import { cloneData } from "../checkpointCodec";
import type { AdapterContext } from "../adapterLifecycle";
import type { MuyaCheckpoint, SourceCheckpoint } from "../sessionTypes";

const cleanup: (() => void)[] = [];
beforeEach(() => {
  vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 10, 18));
  vi.spyOn(Range.prototype, "getClientRects").mockReturnValue([] as unknown as DOMRectList);
});
afterEach(() => { cleanup.splice(0).reverse().forEach(stop => stop()); document.body.replaceChildren(); vi.restoreAllMocks(); });

function context() {
  let revision = 0, alive = true, silent = false, updates = 0;
  const api = {
    context: {
      lease: { documentId: "doc-a", activation: 1 },
      identity: () => ({ documentId: "doc-a", revision }),
      isCurrent: () => alive,
      silently(action) { silent = true; try { action(); } finally { silent = false; } },
      cleanup() { alive = false; },
    } satisfies AdapterContext,
    change() { if (!silent && alive) { revision++; updates++; } },
    updates: () => updates,
  };
  return api;
}
function bootMuya(markdown: string) {
  const host = document.createElement("div"); document.body.appendChild(host);
  const muya = new Muya(host, { markdown }); muya.init();
  const info = context(); muya.on("json-change", () => info.change());
  const adapter = createMuyaHistoryAdapter(muya, { ...info.context, cleanup() { info.context.cleanup(); muya.destroy(); } });
  cleanup.push(() => adapter.destroy());
  return { muya, adapter, info };
}
function bootSource(markdown: string, lineSeparator?: string) {
  const host = document.createElement("div"); document.body.appendChild(host);
  const cm = CodeMirror(host, { value: markdown, lineSeparator });
  const info = context(); cm.on("changes", () => info.change());
  const adapter = createSourceHistoryAdapter(cm, { ...info.context, cleanup() { info.context.cleanup(); cm.getInputField().blur(); cm.setOption("readOnly", "nocursor"); host.remove(); } });
  cleanup.push(() => adapter.destroy());
  return { cm, adapter, info };
}

describe("Muya detached history", () => {
  it("flushes a same-frame edit, detects a changed revision and freezes a detached checkpoint", () => {
    const { muya, adapter, info } = bootMuya("hello");
    const identity = info.context.identity();
    const leaf = muya.editor.scrollPage!.firstContentInDescendant()!;
    leaf.setCursor(0, 0, true); leaf.text = "hello pending";
    expect(adapter.capture(identity)).toEqual({ ok: false, reason: "mismatch" });
    const result = adapter.capture(info.context.identity()); expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("capture failed");
    expect(result.checkpoint.markdown.trim()).toBe("hello pending");
    expect(Object.isFrozen(result.checkpoint.history.stack.undo)).toBe(true);
    expect(JSON.parse(JSON.stringify(result.checkpoint))).toEqual(result.checkpoint);
    adapter.destroy(); adapter.destroy();
    expect(muya.eventCenter.events).toHaveLength(0);
    expect(muya.eventCenter.listeners).toEqual({});
    expect(adapter.undo()).toBe(false);
    expect(adapter.capture(info.context.identity())).toEqual({ ok: false, reason: "disposed" });
  });

  it.each([
    "# Heading\n\nparagraph",
    "- first\n  - nested\n\n- second",
    "| A | B |\n|---|---|\n| C | D |",
    "---\ntitle: demo\n---\n\n$$\nx^2\n$$",
    "```ts\nconst a = 1\n```\n\n> quote",
  ])("restores both stacks on a new renderer for %s", markdown => {
    const original = bootMuya("start");
    original.muya.replaceContent(markdown); original.muya.flush();
    const expected = original.muya.getState();
    original.muya.replaceContent("final"); original.muya.flush();
    original.adapter.undo();
    const result = original.adapter.capture(original.info.context.identity());
    if (!result.ok) throw new Error("capture failed");
    const checkpoint = JSON.parse(JSON.stringify(result.checkpoint)) as MuyaCheckpoint;
    expect(checkpoint.history.stack.undo).toHaveLength(1);
    expect(checkpoint.history.stack.redo).toHaveLength(1);
    original.adapter.destroy();
    const restored = bootMuya("unrelated");
    expect(restored.adapter.restore(checkpoint, checkpoint).ok).toBe(true);
    expect(restored.info.updates()).toBe(0);
    expect(restored.muya.getState()).toEqual(expected);
    expect(restored.adapter.redo()).toBe(true); expect(restored.muya.getMarkdown().trim()).toBe("final");
    expect(restored.adapter.undo()).toBe(true); expect(restored.muya.getState()).toEqual(expected);
    expect(restored.adapter.undo()).toBe(true); expect(restored.muya.getMarkdown().trim()).toBe("start");
    expect(restored.adapter.redo()).toBe(true); expect(restored.muya.getState()).toEqual(expected);
  });

  it("rejects identity, format, structure, history and parsing mismatches before mutation", () => {
    const { adapter, muya, info } = bootMuya("start");
    muya.replaceContent("edited"); muya.flush();
    const result = adapter.capture(info.context.identity()); if (!result.ok) throw new Error("capture failed");
    const before = muya.getState(), history = muya.getHistory();
    expect(adapter.restore(result.checkpoint, { documentId: "other", revision: result.checkpoint.revision })).toEqual({ ok: false, reason: "mismatch" });
    for (const mutate of [
      (cp: MuyaCheckpoint) => { Object.assign(cp, { version: 99 }); },
      (cp: MuyaCheckpoint) => { Object.assign(cp.state[0], { name: "invalid" }); },
      (cp: MuyaCheckpoint) => { Object.assign(cp, { markdown: "does not belong to state" }); },
      (cp: MuyaCheckpoint) => { cp.history.stack.undo[0].operation = ["invalid"] as never; },
      (cp: MuyaCheckpoint) => { Object.assign(cp.history.stack.undo[0], { selection: { anchor: null } }); },
      (cp: MuyaCheckpoint) => { Object.assign(cp.parseProfile, { math: !cp.parseProfile.math }); },
    ]) {
      const cp = cloneData(result.checkpoint); mutate(cp);
      expect(adapter.restore(cp, result.checkpoint).ok).toBe(false);
      expect(muya.getState()).toEqual(before); expect(muya.getHistory()).toEqual(history);
    }
  });

  it("falls back only for invalid view metadata and preserves restored input boundaries", () => {
    const first = bootMuya("abc"); first.muya.replaceContent("edited"); first.muya.flush();
    const result = first.adapter.capture(first.info.context.identity()); if (!result.ok) throw new Error("capture failed");
    const cp = cloneData(result.checkpoint); Object.assign(cp, { selection: { anchor: null } });
    const second = bootMuya("other");
    expect(second.adapter.restore(cp, cp)).toEqual({ ok: true, view: "fallback" });
    const leaf = second.muya.editor.scrollPage!.firstContentInDescendant()!;
    leaf.setCursor(0, 0, true); leaf.text += " next"; second.muya.flush();
    expect(second.adapter.status().undo).toBe(2);
    second.adapter.undo(); expect(second.muya.getMarkdown().trim()).toBe("edited");
  });
});

describe("CodeMirror detached history", () => {
  it("restores text, both stacks, all selections and primary range without recording restoration", () => {
    const first = bootSource("a  b\r\nsecond", "\r\n");
    first.cm.replaceRange("1", { line: 0, ch: 0 }); first.adapter.breakHistoryGroup();
    first.cm.replaceRange("2", { line: 1, ch: 0 }); first.adapter.undo();
    first.cm.setSelections([{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 2 } }, { anchor: { line: 1, ch: 1 }, head: { line: 1, ch: 3 } }], 1);
    const result = first.adapter.capture(first.info.context.identity()); if (!result.ok) throw new Error("capture failed");
    const cp = JSON.parse(JSON.stringify(result.checkpoint)) as SourceCheckpoint;
    const sizes = first.cm.historySize(); first.adapter.destroy();
    const second = bootSource("unrelated");
    expect(second.adapter.restore(cp, cp)).toEqual({ ok: true, view: "restored" });
    expect(second.info.updates()).toBe(0); expect(second.cm.historySize()).toEqual(sizes);
    expect(second.cm.getValue()).toBe(cp.markdown); expect(second.cm.listSelections()).toEqual(cp.selection.ranges);
    expect(second.cm.getCursor("head")).toEqual(cp.selection.ranges[1].head);
    expect(second.adapter.redo()).toBe(true); expect(second.cm.getValue()).toContain("2second");
    second.adapter.undo(); second.adapter.undo(); expect(second.cm.getValue()).toBe("a  b\r\nsecond");
    second.adapter.redo(); expect(second.cm.getValue()).toBe(cp.markdown);
  });

  it("blocks capture and undo during composition, rejects malformed data and releases resources", async () => {
    const { cm, adapter, info } = bootSource("start");
    cm.replaceRange("edit", { line: 0, ch: 0 });
    cm.getWrapperElement().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    expect(adapter.undo()).toBe(false);
    expect(adapter.capture(info.context.identity())).toEqual({ ok: false, reason: "composing" });
    cm.getWrapperElement().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })); await Promise.resolve();
    const result = adapter.capture(info.context.identity()); if (!result.ok) throw new Error("capture failed");
    const bad = cloneData(result.checkpoint); Object.assign(bad, { history: { done: [{ changes: [{ from: -1 }] }], undone: [] } });
    expect(adapter.restore(bad, bad)).toEqual({ ok: false, reason: "invalid" });
    expect(cm.getValue()).toBe("editstart");
    const view = cloneData(result.checkpoint); Object.assign(view, { selection: { primary: 88, ranges: [] } });
    expect(adapter.restore(view, view)).toEqual({ ok: true, view: "fallback" });
    adapter.destroy(); adapter.destroy(); expect(adapter.undo()).toBe(false);
  });
});
