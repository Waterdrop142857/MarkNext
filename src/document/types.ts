/** File format and persisted document data shared independently of UI preferences. */
export const fileEncodings = ["utf-8", "utf-8-bom", "utf-16le", "utf-16be"] as const;
export type FileEncoding = typeof fileEncodings[number];
export interface FileFormat { encoding: FileEncoding; bom: boolean }

export function defaultFileFormat(encoding: FileEncoding): FileFormat {
  return { encoding, bom: encoding !== "utf-8" };
}

export interface ReadDocument extends FileFormat { content: string; version: string; stamp?: string }
export interface ExternalChange { kind: "changed" | "deleted" | "unavailable"; version: string | null }
export interface RecoveryView {
  scrollTop: number;
  sourceCursor?: { anchor: { line: number; ch: number }; focus: { line: number; ch: number } };
  muyaSelection?: { anchor: { offset: number; path: (string | number)[] }; focus: { offset: number; path: (string | number)[] } };
}
export interface RecoverySnapshot extends FileFormat {
  version: 1;
  id: string;
  path: string | null;
  content: string;
  savedContent: string;
  diskVersion: string;
  sourceMode: boolean;
  updatedAt: number;
  view?: RecoveryView | null;
}
export interface RecoveryListing { records: RecoverySnapshot[]; unreadable: number }
