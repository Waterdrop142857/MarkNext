export function newDocumentId(): string {
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
export function conflictVersion(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error && error.code === "conflict"
    && "version" in error && typeof error.version === "string") return error.version;
  return null;
}
