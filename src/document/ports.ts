import type { FileEncoding, FileFormat, ReadDocument, RecoveryListing, RecoverySnapshot } from "./types";

export interface DocumentFiles {
  canonicalPath(path: string): Promise<string>;
  read(path: string, defaultEncoding: FileEncoding): Promise<ReadDocument>;
  stamp(path: string): Promise<string>;
  version(path: string): Promise<string>;
  write(path: string, content: string, format: FileFormat, expectedVersion: string): Promise<string>;
}
export interface DocumentPicker {
  openOne(): Promise<string | null>;
  openMany(): Promise<readonly string[] | null>;
  saveAs(defaultPath: string): Promise<string | null>;
}
export type DocumentErrorContext = "open" | "save" | "saveAs" | "fileAction" | "closeWindow" | "restore";
export interface DocumentPrompts {
  unsaved(name?: string): Promise<"save" | "discard" | "cancel">;
  overwrite(): Promise<boolean>;
  externalChange(dirty: boolean): Promise<"reload" | "keep">;
  alreadyOpen(path: string): Promise<void>;
  error(context: DocumentErrorContext, error: unknown): Promise<void>;
}
export interface RecoveryStore {
  list(): Promise<RecoveryListing>;
  write(snapshot: RecoverySnapshot): Promise<void>;
  remove(id: string): Promise<void>;
}
export interface DocumentPorts {
  files: DocumentFiles;
  picker: DocumentPicker;
  prompts: DocumentPrompts;
  recovery: RecoveryStore;
}
