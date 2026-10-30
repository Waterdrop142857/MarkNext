import { createTauriDocumentPorts } from "../../platform/tauri/documentPorts";
import { beforeEach, expect, it, vi } from "vitest";
import { useWorkspace } from "../useWorkspace";
import type { FileEncoding } from "../../document/types";

const native = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn(), save: vi.fn(), message: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: native.open, save: native.save, message: native.message }));
beforeEach(() => {
  native.invoke.mockReset().mockImplementation(async command => command === "read_file" ? { content: "中文 📝", encoding: "utf-16be", bom: false, version: "disk-v1" } : command === "file_version" ? "missing" : "written");
  native.open.mockReset().mockResolvedValue("/opened.md"); native.save.mockReset().mockResolvedValue("/saved.md"); native.message.mockReset();
});

it("captures default encoding at new document creation and retains it for Save As", async () => {
  let encoding: FileEncoding = "utf-16le";
  const workspace = useWorkspace(() => encoding, createTauriDocumentPorts()); workspace.newFile(); workspace.markdown.value = "你好";
  encoding = "utf-8";
  expect(await workspace.saveFile()).toBe(true);
  expect(native.invoke).toHaveBeenCalledWith("write_file", { path: "/saved.md", content: "你好", encoding: "utf-16le", bom: true, expectedVersion: "missing" });
  workspace.newFile(); expect(workspace.fileFormat.value).toEqual({ encoding: "utf-8", bom: false });
});

it("passes the fallback to reads and preserves detected encoding and absent BOM on Save and Save As", async () => {
  const workspace = useWorkspace(() => "utf-8-bom", createTauriDocumentPorts());
  expect(await workspace.openFile()).toBe(true);
  expect(native.invoke).toHaveBeenCalledWith("read_file", { path: "/opened.md", defaultEncoding: "utf-8-bom" });
  workspace.markdown.value += " edit";
  expect(await workspace.saveFile()).toBe(true); expect(await workspace.saveFileAs()).toBe(true);
  const writes = native.invoke.mock.calls.filter(([command]) => command === "write_file");
  expect(writes.map(([, args]) => args)).toEqual([
    { path: "/opened.md", content: "中文 📝 edit", encoding: "utf-16be", bom: false, expectedVersion: "disk-v1" },
    { path: "/saved.md", content: "中文 📝 edit", encoding: "utf-16be", bom: false, expectedVersion: "missing" },
  ]);
});

it("does not replace current format when the incoming document is cancelled", async () => {
  const workspace = useWorkspace(() => "utf-8", createTauriDocumentPorts()); workspace.newFile();
  expect(await workspace.openFile(async () => false)).toBe(false);
  expect(workspace.fileFormat.value).toEqual({ encoding: "utf-8", bom: false });
  workspace.closeFile(); expect(workspace.fileFormat.value).toBeNull();
});

it("isolates encoding snapshots between queued saves and document generations", async () => {
  let resolve!: (value: string) => void;
  const pending = new Promise<string>(done => { resolve = done; });
  native.invoke.mockImplementationOnce(() => pending).mockResolvedValue("written");
  let encoding: FileEncoding = "utf-16le";
  const workspace = useWorkspace(() => encoding, createTauriDocumentPorts());
  workspace.newFile(); workspace.currentFilePath.value = "/first.md"; workspace.markdown.value = "first";
  const first = workspace.saveFile(); await Promise.resolve();
  encoding = "utf-8"; workspace.newFile(); workspace.currentFilePath.value = "/second.md"; workspace.markdown.value = "second";
  const second = workspace.saveFile(); resolve("written"); await Promise.all([first, second]);
  expect(native.invoke.mock.calls.map(([, args]) => args)).toEqual([
    { path: "/first.md", content: "first", encoding: "utf-16le", bom: true, expectedVersion: "missing" },
    { path: "/second.md", content: "second", encoding: "utf-8", bom: false, expectedVersion: "missing" },
  ]);
  expect(workspace.fileFormat.value).toEqual({ encoding: "utf-8", bom: false }); expect(workspace.savedMarkdown.value).toBe("second");
});
