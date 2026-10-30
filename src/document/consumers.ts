import type { Ref } from "vue";
import type { ExternalChange, FileFormat, RecoverySnapshot } from "./types";

type Readable<T> = Readonly<Ref<T>>;
type ReplacementGuard = () => Promise<boolean>;

/** Only the document operations required by the confirmation coordinator. */
export interface DocumentActionsSource {
  readonly dirty: Readable<boolean>;
  readonly documentGeneration: Readable<number>;
  readonly markdown: Readable<string>;
  readonly externalChange: Readable<ExternalChange | null>;
  saveFile(): Promise<boolean>;
  saveFileAs(): Promise<boolean>;
  overwriteFile(version: string): Promise<boolean>;
  openFile(beforeReplace?: ReplacementGuard, flushEditor?: () => void): Promise<boolean>;
  reloadFile(beforeReplace: ReplacementGuard, flushEditor: () => void): Promise<boolean>;
  restoreRecovery(record: RecoverySnapshot, beforeReplace: ReplacementGuard, flushEditor: () => void): Promise<boolean>;
  newFile(): void;
  closeFile(): void;
}

/** Snapshot fields consumed by the per-document recovery writer. */
export interface RecoverySource {
  readonly documentId: Readable<string>;
  readonly currentFilePath: Readable<string | null>;
  readonly markdown: Readable<string>;
  readonly savedMarkdown: Readable<string>;
  readonly dirty: Readable<boolean>;
  readonly fileFormat: Readable<FileFormat | null>;
  readonly diskVersion: Readable<string>;
  readonly isSourceMode: Readable<boolean>;
}
