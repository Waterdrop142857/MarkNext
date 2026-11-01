import { afterEach, expect, it, vi } from "vitest";
import { attachDocumentFileDrop, droppedDocumentPaths } from "../documentFileDrop";

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(stop => stop()); document.body.replaceChildren(); });
function data(types: string[], values: Record<string, string> = {}, files: File[] = []): DataTransfer {
  return {
    types, files: Object.assign(files, { item: (index: number) => files[index] ?? null }),
    getData: type => values[type] ?? "", dropEffect: "none", effectAllowed: "all",
    get items(): DataTransferItemList { throw new Error("Item API is unused in these payloads"); },
    setData: (type, value) => { values[type] = value; },
    clearData: type => { if (type) delete values[type]; },
    setDragImage: vi.fn(),
  };
}
function dispatch(type: "drop" | "dragover", transfer: DataTransfer, target: EventTarget = window) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: transfer });
  target.dispatchEvent(event); return event;
}

it("accepts protected URI drags before getData can expose paths", () => {
  const enqueue = vi.fn(); cleanups.push(attachDocumentFileDrop(window, enqueue));
  const transfer = data(["text/uri-list"]);
  expect(dispatch("dragover", transfer).defaultPrevented).toBe(true);
  expect(transfer.dropEffect).toBe("copy");
  expect(enqueue).not.toHaveBeenCalled();
});

it("routes local document URIs before an editor can insert the dropped content", () => {
  const enqueue = vi.fn(); cleanups.push(attachDocumentFileDrop(window, enqueue));
  const editor = document.createElement("div"); document.body.appendChild(editor);
  const insert = vi.fn(); editor.addEventListener("drop", insert);
  const transfer = data(["Files", "text/uri-list"], { "text/uri-list": "# comment\r\nfile:///tmp/%E6%96%87%E6%A1%A3%20%23%201.MD\r\nfile:///tmp/next.txt\r\nfile:///tmp/image.png\r\nhttps://example.com/file.md" });
  expect(dispatch("drop", transfer, editor).defaultPrevented).toBe(true);
  expect(enqueue).toHaveBeenCalledExactlyOnceWith(["file:///tmp/%E6%96%87%E6%A1%A3%20%23%201.MD", "file:///tmp/next.txt"]);
  expect(insert).not.toHaveBeenCalled();
});

it("supports file-manager plain URI payloads and genuine absolute File.path values", () => {
  const file = new File(["content"], "actual.md"); Object.defineProperty(file, "path", { value: "/tmp/actual.md" });
  expect(droppedDocumentPaths(data(["Files"], { "text/plain": "file:///tmp/next.Markdown" }, [file]))).toEqual(["file:///tmp/next.Markdown", "/tmp/actual.md"]);
  expect(droppedDocumentPaths(data(["Files"], { "text/plain": "/tmp/space notes.txt" }))).toEqual(["/tmp/space notes.txt"]);
});

it("never guesses a path from File.name, and blocks insertion of a document whose native path is unavailable", () => {
  const enqueue = vi.fn(); cleanups.push(attachDocumentFileDrop(window, enqueue));
  const transfer = data(["Files"], {}, [new File(["content"], "notes.md")]);
  expect(droppedDocumentPaths(transfer)).toEqual([]);
  expect(dispatch("drop", transfer).defaultPrevented).toBe(true);
  expect(enqueue).not.toHaveBeenCalled();
});

it("leaves internal text and image drops to the editor", () => {
  const enqueue = vi.fn(); cleanups.push(attachDocumentFileDrop(window, enqueue));
  for (const transfer of [data(["text/plain"], { "text/plain": "file:///tmp/text.md" }), data(["Files"], {}, [new File([""], "image.png")])]) {
    expect(dispatch("drop", transfer).defaultPrevented).toBe(false);
  }
  expect(enqueue).not.toHaveBeenCalled();
});

it("removes capture listeners when disposed", () => {
  const stop = attachDocumentFileDrop(window, vi.fn()); stop();
  expect(dispatch("dragover", data(["Files"])).defaultPrevented).toBe(false);
});
