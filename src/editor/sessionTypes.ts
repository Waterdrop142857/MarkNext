/**
 * Session/history contracts used by EditorSession and both engine adapters.
 * See docs/editor-session-history.md for ownership and lifecycle invariants.
 * This module must stay type-only: importing a session must not load an editor.
 */
import type { FileFormat } from "../document/types";
import type { ISerializedHistory } from "../muya/history";
import type { IHistorySelection } from "../muya/selection/types";
import type { TState } from "../muya/state/types";
import type { IMuyaOptions } from "../muya/types";
import type { ExternalChange } from "../document/types";

export type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

export interface DocumentRevision {
  readonly documentId: string;
  /** Monotonic content revision; undo also creates a new revision. */
  readonly revision: number;
}

export interface ScrollSnapshot {
  readonly top: number;
  readonly left: number;
}

export type MuyaSelectionSnapshot = DeepReadonly<
  Omit<IHistorySelection, "anchor" | "focus"> & {
    anchor: Pick<IHistorySelection["anchor"], "offset" | "path">;
    focus: Pick<IHistorySelection["focus"], "offset" | "path">;
  }
>;

/** These options affect the state/history interpretation, unlike UI fonts. */
export type MuyaParseProfile = Readonly<Pick<IMuyaOptions,
  "isGitlabCompatibilityEnabled" | "math" | "footnote" | "frontMatter"
  | "trimUnnecessaryCodeBlockEmptyLines"
>>;

interface CheckpointBase extends DocumentRevision {
  readonly version: 1;
  /** Exact editor text at capture; no trimming or newline normalization. */
  readonly markdown: string;
  readonly scroll: ScrollSnapshot;
}

export interface MuyaCheckpoint extends CheckpointBase {
  readonly engine: "muya";
  // Recursive engine structures are detached and frozen by the codec. Keep
  // their native types here to avoid infinitely expanding JSON operation types.
  readonly state: readonly TState[];
  readonly history: ISerializedHistory;
  readonly selection: MuyaSelectionSnapshot | null;
  readonly parseProfile: MuyaParseProfile;
}

export interface SourcePosition {
  readonly line: number;
  readonly ch: number;
}

export interface SourceRange {
  readonly anchor: SourcePosition;
  readonly head: SourcePosition;
}

export interface SourceSelectionSnapshot {
  readonly ranges: readonly SourceRange[];
  readonly primary: number;
}

/** Pure-data subset of the installed CodeMirror 5 getHistory() format. */
export type SourceHistoryEvent = {
  readonly changes: readonly {
    readonly from: SourcePosition;
    readonly to: SourcePosition;
    readonly text: readonly string[];
  }[];
} | {
  readonly ranges: readonly SourceRange[];
  readonly primIndex: number;
};

export interface SourceHistorySnapshot {
  readonly done: readonly SourceHistoryEvent[];
  readonly undone: readonly SourceHistoryEvent[];
}

export interface SourceCheckpoint extends CheckpointBase {
  readonly engine: "codemirror5";
  readonly lineSeparator: "\n" | "\r\n" | "\r" | null;
  readonly history: SourceHistorySnapshot;
  readonly selection: SourceSelectionSnapshot;
}

export type EngineCheckpoint = MuyaCheckpoint | SourceCheckpoint;

export type EditorSessionCheckpoint = {
  readonly version: 1;
  readonly mode: "wysiwyg";
  readonly active: MuyaCheckpoint;
  /** Reusable only if its exact text still matches the next source entry. */
  readonly cachedSource: SourceCheckpoint | null;
} | {
  readonly version: 1;
  readonly mode: "source";
  readonly active: SourceCheckpoint;
  readonly bridge: {
    /** Earlier Muya revision, needed to undo the eventual source-mode commit. */
    readonly muyaAtEntry: MuyaCheckpoint;
    readonly sourceTextAtEntry: string;
  };
};

/** Data owned by a document, independent of any mounted editor instance. */
export interface DocumentSession {
  readonly version: 1;
  readonly identity: DocumentRevision;
  readonly path: string | null;
  readonly markdown: string;
  readonly savedMarkdown: string;
  readonly fileFormat: Readonly<FileFormat>;
  readonly diskVersion: string;
  readonly externalChange: Readonly<ExternalChange> | null;
  readonly recoveredCopy: boolean;
  readonly recoveryNeedsSave: boolean;
  /** Null only before first activation. A suspended edited session needs one. */
  readonly editor: EditorSessionCheckpoint | null;
}

/** Distinguishes render activations even when document/revision are unchanged. */
export interface RendererLease {
  readonly documentId: string;
  readonly activation: number;
}

export interface HistoryStatus {
  readonly undo: number;
  readonly redo: number;
  readonly composing: boolean;
}

export type CaptureResult<C extends EngineCheckpoint> = {
  readonly ok: true;
  readonly checkpoint: C;
} | {
  readonly ok: false;
  readonly reason: "composing" | "busy" | "mismatch" | "disposed";
};

export type RestoreResult = {
  readonly ok: true;
  readonly view: "restored" | "fallback";
} | {
  readonly ok: false;
  readonly reason: "mismatch" | "unsupported" | "invalid" | "disposed";
};

/**
 * Live, short-lived adapter. Never store this object in DocumentSession.
 * capture() flushes and splits the input group before taking a detached copy.
 * If flushing changes the expected revision, return mismatch for a fresh retry.
 * restore() is silent and must validate before mutating its target renderer.
 * destroy() is idempotent and invalidates every callback belonging to its lease.
 */
export interface EditorHistoryAdapter<C extends EngineCheckpoint> {
  readonly engine: C["engine"];
  readonly lease: RendererLease;
  status(): HistoryStatus;
  flush(): void;
  breakHistoryGroup(): void;
  undo(): boolean;
  redo(): boolean;
  capture(identity: DocumentRevision): CaptureResult<C>;
  restore(checkpoint: C, expected: DocumentRevision): RestoreResult;
  destroy(): void;
}

export type MuyaHistoryAdapter = EditorHistoryAdapter<MuyaCheckpoint>;
export type SourceHistoryAdapter = EditorHistoryAdapter<SourceCheckpoint>;
