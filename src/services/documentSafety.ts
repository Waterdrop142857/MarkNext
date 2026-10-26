import type { FileFormat } from "../config/preferences";

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
export function newDocumentId(): string {
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
export function conflictVersion(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error && error.code === "conflict"
    && "version" in error && typeof error.version === "string") return error.version;
  return null;
}
