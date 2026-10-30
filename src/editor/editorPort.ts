import type { RecoveryView } from "../document/types";
import type { OutlineHeading } from "../services/documentAnalysis";
import type { EditorSessionCheckpoint } from "./sessionTypes";

/** Identifies the renderer generation that originated an event. */
export interface EditorEvent<T> {
  readonly documentId: string;
  readonly generation: number;
  readonly value: T;
}

/** Presentation options shared with the application, independent of Muya. */
export interface EditorAppearance {
  fontSize: number;
  editorFontFamily: string;
  codeFontFamily: string;
}

/** Short-lived renderer interface. Checkpoints never retain this object. */
export interface EditorLifecyclePort {
  flush(): void;
  capture(): Promise<EditorSessionCheckpoint | null>;
  suspend(): Promise<EditorSessionCheckpoint | null>;
  resume(): Promise<boolean>;
}
export interface EditorInteractionPort {
  focus(): void;
  captureView(): RecoveryView;
  applyView(view: RecoveryView | null | undefined, sourceMode: boolean): void;
  navigateHeading(target: OutlineHeading): boolean;
  selectAll(): void;
  clearUndoably(): void;
  paste(): Promise<void>;
  search(query: string): void;
  closeSearch(): void;
  find(query: string, forward: boolean): void;
  replace(query: string, replacement: string, all: boolean): void;
  undo(): boolean;
  redo(): boolean;
  toggleMode(): Promise<boolean>;
}
export type EditorPort = EditorLifecyclePort & EditorInteractionPort;
