import * as json1 from "ot-json1";
import type { ISerializedHistory } from "../muya/history";
import type { TState } from "../muya/state/types";
import { asDoc, asState } from "../muya/state";
import type {
  DeepReadonly, DocumentRevision, EditorSessionCheckpoint, EngineCheckpoint, MuyaCheckpoint,
  SourceCheckpoint, SourceHistorySnapshot, SourcePosition,
} from "./sessionTypes";

export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function integer(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function requireValue(condition: unknown): asserts condition {
  if (!condition) throw new Error("Invalid editor checkpoint");
}

/** Detached data only. Reject cycles, live instances, callbacks and NaN. */
export function cloneData<T>(value: DeepReadonly<T> | T): T {
  const seen = new Set<object>();
  function copy(input: unknown): unknown {
    if (input === null || typeof input === "string" || typeof input === "boolean") return input;
    if (typeof input === "number" && Number.isFinite(input)) return input;
    requireValue(typeof input === "object" && input !== null && !seen.has(input));
    const prototype = Object.getPrototypeOf(input);
    requireValue(Array.isArray(input) || prototype === Object.prototype || prototype === null);
    seen.add(input);
    let result: unknown;
    if (Array.isArray(input)) result = input.map(copy);
    else {
      const object: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(input)) {
        requireValue(key !== "__proto__" && key !== "constructor" && key !== "prototype");
        object[key] = copy(item);
      }
      result = object;
    }
    seen.delete(input);
    return result;
  }
  return copy(value) as T;
}

export function freezeData<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeData);
    Object.freeze(value);
  }
  return value;
}

export function matchesRevision(checkpoint: DocumentRevision, expected: DocumentRevision) {
  return checkpoint.documentId === expected.documentId && checkpoint.revision === expected.revision;
}

function base(value: unknown, engine: EngineCheckpoint["engine"]): asserts value is Record<string, unknown> {
  requireValue(record(value) && value.version === 1 && value.engine === engine
    && typeof value.documentId === "string" && integer(value.revision)
    && typeof value.markdown === "string" && record(value.scroll)
    && typeof value.scroll.top === "number" && value.scroll.top >= 0
    && typeof value.scroll.left === "number" && value.scroll.left >= 0);
}

const leafNames = new Set(["paragraph", "atx-heading", "setext-heading", "thematic-break", "code-block",
  "html-block", "link-reference-definition", "math-block", "frontmatter", "diagram", "table.cell"]);
const containerNames = new Set(["block-quote", "list-item", "order-list", "bullet-list", "task-list",
  "task-list-item", "table", "table.row", "footnote"]);

function validateState(value: unknown): asserts value is TState[] {
  requireValue(Array.isArray(value));
  for (const node of value) {
    requireValue(record(node) && typeof node.name === "string");
    if (leafNames.has(node.name)) requireValue(typeof node.text === "string");
    else { requireValue(containerNames.has(node.name)); validateState(node.children); }
    const meta = node.meta;
    switch (node.name) {
      case "atx-heading": case "setext-heading":
        requireValue(record(meta) && integer(meta.level) && meta.level >= 1 && meta.level <= 6);
        if (node.name === "setext-heading") requireValue(typeof meta.underline === "string");
        break;
      case "code-block": requireValue(record(meta) && typeof meta.type === "string" && typeof meta.lang === "string"); break;
      case "math-block": requireValue(record(meta) && typeof meta.mathStyle === "string"); break;
      case "frontmatter": requireValue(record(meta) && typeof meta.style === "string" && typeof meta.lang === "string"); break;
      case "diagram": requireValue(record(meta) && typeof meta.lang === "string"
        && ["mermaid", "plantuml", "vega-lite", "flowchart", "sequence"].includes(String(meta.type))); break;
      case "table.cell": requireValue(record(meta) && typeof meta.align === "string"); break;
      case "task-list-item": requireValue(record(meta) && typeof meta.checked === "boolean"); break;
      case "footnote": requireValue(record(meta) && typeof meta.identifier === "string"); break;
      case "order-list": case "bullet-list": case "task-list":
        requireValue(record(meta) && typeof meta.loose === "boolean");
        if (node.name === "order-list") requireValue(integer(meta.start) && [".", ")"].includes(String(meta.delimiter)));
        else requireValue(typeof meta.marker === "string");
        break;
    }
    if (node.name === "table") requireValue((node.children as TState[]).every(child => child.name === "table.row"));
    if (node.name === "table.row") requireValue((node.children as TState[]).every(child => child.name === "table.cell"));
    if (node.name === "order-list" || node.name === "bullet-list") requireValue((node.children as TState[]).every(child => child.name === "list-item"));
    if (node.name === "task-list") requireValue((node.children as TState[]).every(child => child.name === "task-list-item"));
  }
}

function historySelection(value: unknown): boolean {
  return value === null || (record(value)
    && [value.anchor, value.focus].every(point => record(point) && integer(point.offset)
      && Array.isArray(point.path) && point.path.every(part => typeof part === "string" || integer(part)))
    && typeof value.isCollapsed === "boolean" && typeof value.isSelectionInSameBlock === "boolean"
    && ["none", "forward", "backward"].includes(String(value.direction))
    && ["None", "Caret", "Range"].includes(String(value.type)));
}

export function decodeMuyaCheckpoint(value: unknown): MuyaCheckpoint {
  const copy = cloneData(value);
  base(copy, "muya");
  validateState(copy.state);
  requireValue(record(copy.parseProfile) && ["isGitlabCompatibilityEnabled", "math", "footnote", "frontMatter", "trimUnnecessaryCodeBlockEmptyLines"]
    .every(key => typeof (copy.parseProfile as Record<string, unknown>)[key] === "boolean"));
  requireValue(record(copy.history) && record(copy.history.stack) && Array.isArray(copy.history.selectionStack)
    && typeof copy.history.lastRecorded === "number" && copy.history.selectionStack.every(historySelection));
  // Validate both operation paths against the exact captured structure without
  // touching any renderer. History entries apply from the end of each stack.
  for (const direction of ["undo", "redo"]) {
    const stack = copy.history.stack[direction];
    requireValue(Array.isArray(stack));
    let state = copy.state;
    for (const entry of [...stack].reverse()) {
      requireValue(record(entry) && Array.isArray(entry.operation)
        && historySelection(entry.selection)
        && (entry.rebuild === undefined || typeof entry.rebuild === "boolean"));
      json1.type.checkValidOp(entry.operation);
      state = asState(json1.type.apply(asDoc(state), entry.operation));
      validateState(state);
    }
  }
  return copy as unknown as MuyaCheckpoint;
}

export function sourcePosition(value: unknown): value is SourcePosition {
  return record(value) && integer(value.line) && integer(value.ch);
}

/** CodeMirror's native selection events have class prototypes; copy fields. */
export function encodeSourceHistory(value: unknown): SourceHistorySnapshot {
  requireValue(record(value));
  function events(input: unknown): SourceHistorySnapshot["done"] {
    requireValue(Array.isArray(input));
    return input.map(event => {
      requireValue(record(event));
      if (Array.isArray(event.ranges)) {
        requireValue(integer(event.primIndex) && event.primIndex < event.ranges.length);
        return { primIndex: event.primIndex, ranges: event.ranges.map(range => {
          requireValue(record(range) && sourcePosition(range.anchor) && sourcePosition(range.head));
          return { anchor: { line: range.anchor.line, ch: range.anchor.ch }, head: { line: range.head.line, ch: range.head.ch } };
        }) };
      }
      requireValue(Array.isArray(event.changes));
      return { changes: event.changes.map(change => {
        requireValue(record(change) && sourcePosition(change.from) && sourcePosition(change.to)
          && Array.isArray(change.text) && change.text.length > 0 && change.text.every(line => typeof line === "string"));
        return { from: { line: change.from.line, ch: change.from.ch }, to: { line: change.to.line, ch: change.to.ch }, text: [...change.text] as string[] };
      }) };
    });
  }
  return { done: events(value.done), undone: events(value.undone) };
}

export function decodeSourceCheckpoint(value: unknown): SourceCheckpoint {
  const copy = cloneData(value);
  base(copy, "codemirror5");
  requireValue(copy.lineSeparator === null || ["\n", "\r\n", "\r"].includes(String(copy.lineSeparator)));
  const history = encodeSourceHistory(copy.history);
  // Reject out-of-bounds or reversed changes instead of letting CodeMirror
  // silently clip corrupted offsets when the user later presses Undo.
  for (const stack of [history.done, history.undone]) {
    const lines = (copy.markdown as string).split(typeof copy.lineSeparator === "string" ? copy.lineSeparator : /\r\n?|\n/);
    for (const event of [...stack].reverse()) {
      if (!("changes" in event)) continue;
      for (const change of [...event.changes].reverse()) {
        const { from, to, text } = change;
        requireValue(from.line < lines.length && to.line < lines.length
          && from.ch <= lines[from.line].length && to.ch <= lines[to.line].length
          && (from.line < to.line || (from.line === to.line && from.ch <= to.ch)));
        const replacement = [...text];
        replacement[0] = lines[from.line].slice(0, from.ch) + replacement[0];
        replacement[replacement.length - 1] += lines[to.line].slice(to.ch);
        lines.splice(from.line, to.line - from.line + 1, ...replacement);
      }
    }
  }
  // Invalid view metadata falls back to a safe cursor; it cannot discard text.
  return copy as unknown as SourceCheckpoint;
}

export function mutableHistory(history: MuyaCheckpoint["history"]): ISerializedHistory {
  return cloneData<ISerializedHistory>(history);
}

export function decodeSessionCheckpoint(value: unknown): EditorSessionCheckpoint {
  const copy = cloneData(value);
  requireValue(record(copy) && copy.version === 1);
  if (copy.mode === "source") {
    const active = decodeSourceCheckpoint(copy.active);
    requireValue(record(copy.bridge) && typeof copy.bridge.sourceTextAtEntry === "string");
    const muyaAtEntry = decodeMuyaCheckpoint(copy.bridge.muyaAtEntry);
    requireValue(active.documentId === muyaAtEntry.documentId && muyaAtEntry.revision <= active.revision);
    return freezeData({ version: 1, mode: "source", active, bridge: { muyaAtEntry, sourceTextAtEntry: copy.bridge.sourceTextAtEntry } });
  }
  requireValue(copy.mode === "wysiwyg");
  const active = decodeMuyaCheckpoint(copy.active);
  const cachedSource = copy.cachedSource === null ? null : decodeSourceCheckpoint(copy.cachedSource);
  requireValue(!cachedSource || cachedSource.documentId === active.documentId);
  return freezeData({ version: 1, mode: "wysiwyg", active, cachedSource });
}
