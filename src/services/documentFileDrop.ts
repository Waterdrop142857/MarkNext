const documentExtension = /\.(md|markdown|txt)$/i;

function isDocumentPath(value: string): boolean {
  try {
    if (/^file:/i.test(value)) return documentExtension.test(decodeURIComponent(new URL(value).pathname));
    return /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(value) && documentExtension.test(value);
  } catch { return false; }
}

/** Use actual paths/URIs only; a browser File.name is never a disk path. */
export function droppedDocumentPaths(transfer: DataTransfer): string[] {
  const uriList = transfer.getData("text/uri-list");
  const text = uriList || (Array.from(transfer.types).includes("Files") ? transfer.getData("text/plain") : "");
  const paths = text.split(/\r?\n/).map(line => line.trim())
    .filter(line => isDocumentPath(line));
  for (const file of Array.from(transfer.files)) {
    // Some native WebViews expose an absolute path; standard browsers do not.
    const path: unknown = Reflect.get(file, "path");
    if (typeof path === "string" && isDocumentPath(path)) paths.push(path);
  }
  return [...new Set(paths)];
}

/** Capture before editor drop handlers can insert the document as text. */
export function attachDocumentFileDrop(target: Window, enqueue: (paths: string[]) => void): () => void {
  function over(event: DragEvent) {
    const transfer = event.dataTransfer;
    if (!transfer) return;
    if (Array.from(transfer.types).some(type => type === "Files" || type === "text/uri-list")) {
      event.preventDefault();
      transfer.dropEffect = "copy";
    }
  }
  function drop(event: DragEvent) {
    const transfer = event.dataTransfer;
    if (!transfer) return;
    const paths = droppedDocumentPaths(transfer);
    const documents = paths.length || Array.from(transfer.files).some(file => documentExtension.test(file.name));
    if (!documents) return; // Images and internal text retain their editor handlers.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (paths.length) enqueue(paths);
  }
  target.addEventListener("dragover", over, true);
  target.addEventListener("drop", drop, true);
  return () => {
    target.removeEventListener("dragover", over, true);
    target.removeEventListener("drop", drop, true);
  };
}
