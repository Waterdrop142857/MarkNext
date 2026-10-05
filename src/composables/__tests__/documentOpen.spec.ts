// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Muya } from "../../muya";
import { useWorkspace } from "../useWorkspace";
import { useDocumentActions } from "../useDocumentActions";

const native = vi.hoisted(() => ({ invoke: vi.fn(), message: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: native.open, save: async () => "/saved.md", message: native.message,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const editors: Muya[] = [];
const originalVersion = window.MUYA_VERSION;
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  window.MUYA_VERSION = "test";
  native.invoke.mockReset();
  native.message.mockReset().mockResolvedValue("不保存");
  native.open.mockReset().mockResolvedValue("/new.md");
});
afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy());
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
  vi.unstubAllGlobals();
  if (originalVersion === undefined) delete (window as Partial<Window>).MUYA_VERSION;
  else window.MUYA_VERSION = originalVersion;
});

function harness() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Muya(host, { markdown: "original" });
  editor.init();
  editors.push(editor);
  const workspace = useWorkspace();
  workspace.currentFilePath.value = "/old.md";
  workspace.markdown.value = workspace.savedMarkdown.value = editor.getMarkdown();
  editor.on("json-change", () => { workspace.markdown.value = editor.getMarkdown(); });
  const flush = vi.fn(() => editor.flush());
  const closeWindow = vi.fn(async () => {});
  const actions = useDocumentActions(workspace, { flushEditor: flush, closeWindow });
  const read = deferred<string>();
  const reading = deferred<void>();
  native.invoke.mockImplementation((command: string) => {
    if (command === "read_file") { reading.resolve(); return read.promise.then(content => ({ content, encoding: "utf-8", bom: false })); }
    return Promise.resolve();
  });
  const edit = (text: string) => { editor.editor.scrollPage!.firstContentInDescendant()!.text = text; };
  return { editor, workspace, actions, read, reading, edit, closeWindow };
}

describe("opening a document with real pending Muya changes", () => {
  it("opens a clean document with a single read and no prompt", async () => {
    const { actions, read, reading, workspace } = harness();
    const opening = actions.run("open");
    await reading.promise;
    read.resolve("replacement");
    expect(await opening).toBe(true);
    expect(native.message).not.toHaveBeenCalled();
    expect(native.invoke.mock.calls.filter(([command]) => command === "read_file")).toHaveLength(1);
    expect(workspace.markdown.value).toBe("replacement");
    expect(workspace.dirty.value).toBe(false);
    expect(workspace.documentGeneration.value).toBe(1);
  });

  it.each(["取消", "不保存", "保存"])("protects queued edits when choosing %s after the read", async choice => {
    const { actions, read, reading, edit, editor, workspace } = harness();
    native.message.mockResolvedValue(choice);
    const opening = actions.run("open");
    await reading.promise;
    edit("latest pending keystroke");
    expect(workspace.dirty.value).toBe(false);
    read.resolve("replacement");
    expect(await opening).toBe(choice !== "取消");
    expect(native.message).toHaveBeenCalledTimes(1);
    expect(native.invoke.mock.calls.filter(([command]) => command === "read_file")).toHaveLength(1);
    if (choice === "取消") {
      expect(workspace.currentFilePath.value).toBe("/old.md");
      expect(workspace.markdown.value).toBe(editor.getMarkdown());
      expect(workspace.markdown.value).toContain("latest pending keystroke");
      expect(workspace.dirty.value).toBe(true);
      expect(workspace.documentGeneration.value).toBe(0);
    }
    else {
      expect(workspace.currentFilePath.value).toBe("/new.md");
      expect(workspace.markdown.value).toBe("replacement");
      expect(workspace.dirty.value).toBe(false);
    }
    const writes = native.invoke.mock.calls.filter(([command]) => command === "write_file");
    expect(writes).toHaveLength(choice === "保存" ? 1 : 0);
    if (choice === "保存") {
      expect(writes[0]![1]).toEqual({ path: "/old.md", content: editor.getMarkdown(), encoding: "utf-8", bom: false });
    }
  });

  it("does not prompt again for the same discarded version after the read", async () => {
    const { actions, read, reading, edit } = harness();
    edit("initial unsaved edit");
    const opening = actions.run("open");
    await reading.promise;
    expect(native.message).toHaveBeenCalledTimes(1);
    read.resolve("replacement");
    expect(await opening).toBe(true);
    expect(native.message).toHaveBeenCalledTimes(1);
  });

  it("asks again only for new edits after an initial discard approval", async () => {
    const { actions, read, reading, edit, workspace } = harness();
    edit("first version");
    native.message.mockResolvedValueOnce("不保存").mockResolvedValueOnce("取消");
    const opening = actions.run("open");
    await reading.promise;
    edit("second pending version");
    read.resolve("replacement");
    expect(await opening).toBe(false);
    expect(native.message).toHaveBeenCalledTimes(2);
    expect(workspace.markdown.value).toContain("second pending version");
    expect(native.invoke.mock.calls.filter(([command]) => command === "read_file")).toHaveLength(1);
  });

  it("does not discard a newer version queued while the confirmation is pending", async () => {
    const { actions, read, reading, edit, workspace } = harness();
    const answer = deferred<string>();
    const prompted = deferred<void>();
    native.message.mockImplementationOnce(() => { prompted.resolve(); return answer.promise; })
      .mockResolvedValueOnce("取消");
    const opening = actions.run("open");
    await reading.promise;
    edit("version shown in confirmation");
    read.resolve("replacement");
    await prompted.promise;
    edit("newer pending version");
    answer.resolve("不保存");
    expect(await opening).toBe(false);
    expect(native.message).toHaveBeenCalledTimes(2);
    expect(workspace.markdown.value).toContain("newer pending version");
  });

  it("keeps the current document when reading fails", async () => {
    const { actions, read, reading, workspace } = harness();
    const original = workspace.markdown.value;
    const opening = actions.run("open");
    await reading.promise;
    read.reject(new Error("simulated read failure"));
    expect(await opening).toBe(false);
    expect(workspace.markdown.value).toBe(original);
    expect(workspace.currentFilePath.value).toBe("/old.md");
    expect(native.message.mock.calls[0]![1]).toMatchObject({ kind: "error" });
  });

  it("never replaces a different document generation with a stale read", async () => {
    const { actions, read, reading, workspace } = harness();
    const opening = actions.run("open");
    await reading.promise;
    workspace.newFile();
    read.resolve("stale incoming file");
    expect(await opening).toBe(false);
    expect(workspace.isUntitled.value).toBe(true);
    expect(workspace.markdown.value).toBe("");
    expect(workspace.currentFilePath.value).toBeNull();
  });

  it.each(["new", "close", "exit"] as const)("protects newer queued edits during the shared %s confirmation", async action => {
    const { actions, edit, workspace, closeWindow } = harness();
    const answer = deferred<string>();
    const prompted = deferred<void>();
    native.message.mockImplementationOnce(() => { prompted.resolve(); return answer.promise; })
      .mockResolvedValueOnce("取消");
    edit("version shown in confirmation");
    const operation = actions.run(action);
    await prompted.promise;
    edit("newer queued edit");
    answer.resolve("不保存");
    expect(await operation).toBe(false);
    expect(native.message).toHaveBeenCalledTimes(2);
    expect(workspace.markdown.value).toContain("newer queued edit");
    expect(workspace.currentFilePath.value).toBe("/old.md");
    expect(workspace.documentGeneration.value).toBe(0);
    expect(closeWindow).not.toHaveBeenCalled();
  });
});
