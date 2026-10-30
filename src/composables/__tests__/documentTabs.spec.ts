import { createTauriDocumentPorts } from "../../platform/tauri/documentPorts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick } from "vue";
import { useDocumentWorkspace } from "../../workspace/useDocumentWorkspace";
import type { EditorSessionCheckpoint } from "../../editor/sessionTypes";
import type { RecoverySnapshot } from "../../document/types";

const native = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn(), save: vi.fn(), message: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: native.open, save: native.save, message: native.message }));
const disk = new Map<string, string>(), backups = new Map<string, RecoverySnapshot>(), aliases = new Map<string, string>();
const cleanups: (() => void)[] = [];
const choices: string[] = [];
let failWrites = false;

beforeEach(() => {
  vi.clearAllMocks(); disk.clear(); backups.clear(); aliases.clear(); choices.length = 0; failWrites = false;
  disk.set("/one.md", "one"); disk.set("/two.md", "two");
  native.open.mockResolvedValue("/one.md"); native.save.mockResolvedValue("/saved.md");
  native.message.mockImplementation(async (_text, options) => options.buttons?.ok && !options.buttons?.cancel ? "Ok" : choices.shift() ?? "Cancel");
  native.invoke.mockImplementation(async (command, args) => {
    const version = (path: string) => disk.has(path) ? `v:${disk.get(path)}` : "missing";
    if (command === "canonical_document_path") return aliases.get(args.path) ?? args.path;
    if (command === "read_file") return { content: disk.get(args.path), version: version(args.path), encoding: args.path === "/one.md" ? "utf-16le" : "utf-8", bom: args.path === "/one.md" };
    if (command === "file_version" || command === "file_status") return version(args.path);
    if (command === "write_file") {
      if (failWrites) throw new Error("write failed");
      if (args.expectedVersion !== version(args.path)) throw { code: "conflict", version: version(args.path) };
      disk.set(args.path, args.content); return version(args.path);
    }
    if (command === "recovery_list") return { records: [...backups.values()], unreadable: 0 };
    if (command === "recovery_write") { backups.set(args.snapshot.id, structuredClone(args.snapshot)); return; }
    if (command === "recovery_remove") { backups.delete(args.id); return; }
    throw new Error(`Unexpected command ${command}`);
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { cleanups.splice(0).reverse().forEach(cleanup => cleanup()); vi.restoreAllMocks(); });

function mount(prepareEditor?: () => Promise<void>) {
  const scope = effectScope();
  let manager!: ReturnType<typeof useDocumentWorkspace>;
  const mounted: string[] = [], suspended: string[] = [];
  const captures = new Map<string, EditorSessionCheckpoint>();
  const failMount = new Set<string>();
  let closed = 0;
  function capture(): EditorSessionCheckpoint | null {
    const id = manager.activeId.value;
    if (!id) return null;
    return { version: 1, mode: "wysiwyg", cachedSource: null, active: {
      version: 1, engine: "muya", documentId: id, revision: manager.identity.value.revision,
      markdown: manager.workspace.markdown.value, state: [{ name: "paragraph", text: manager.workspace.markdown.value }],
      history: { stack: { undo: [], redo: [] }, lastRecorded: 0, selectionStack: [] },
      selection: null, scroll: { top: 0, left: 0 }, parseProfile: { math: true, footnote: true, frontMatter: true, isGitlabCompatibilityEnabled: false, trimUnnecessaryCodeBlockEmptyLines: true },
    } };
  }
  const renderer = {
    flush() {}, capture: async () => capture(),
    suspend: async () => { const id = manager.activeId.value!; suspended.push(id); const snapshot = capture(); if (snapshot) captures.set(id, snapshot); return snapshot; },
    resume: async () => { mounted.push(manager.activeId.value!); return !failMount.has(manager.workspace.currentFilePath.value ?? ""); },
  };
  manager = scope.run(() => useDocumentWorkspace(() => "utf-8", createTauriDocumentPorts(), {
    prepareEditor,
    editor: () => manager.activeId.value ? renderer : null,
    getView: () => ({ scrollTop: 42 }),
    closeWindow: async () => {
      if (!(await manager.recovery.prepareExit())) throw new Error("cleanup failed");
      closed++;
    },
  }))!;
  cleanups.push(() => scope.stop());
  return { manager, mounted, suspended, captures, failMount, closed: () => closed, stop: () => scope.stop(),
    async edit(id: string, text: string) { expect(await manager.activate(id)).toBe(true); manager.workspace.markdown.value = text; },
    async read(id: string) { expect(await manager.activate(id)).toBe(true); return { text: manager.workspace.markdown.value, dirty: manager.workspace.dirty.value }; },
  };
}
async function two() {
  const harness = mount();
  await harness.manager.recovery.start();
  await harness.manager.actions.run("open");
  const first = { id: harness.manager.activeId.value! };
  native.open.mockResolvedValue("/two.md"); await harness.manager.actions.run("open");
  return { ...harness, first, second: { id: harness.manager.activeId.value! } };
}

describe("multi-document workspaces", () => {
  it("waits for a lazy editor before mounting a tab, without blocking the outer shell", async () => {
    let ready!: () => void;
    const { manager, mounted } = mount(() => new Promise(resolve => { ready = resolve; }));
    const opening = manager.actions.run("new");
    await vi.waitFor(() => expect(ready).toBeTypeOf("function"));
    expect(manager.busy.value).toBe(true);
    expect(manager.activeId.value).toBeNull();
    expect(mounted).toEqual([]);
    ready();
    expect(await opening).toBe(true);
    expect(mounted).toHaveLength(1);
    expect(manager.tabs.value).toHaveLength(1);
  });

  it("retains a document after a failed lazy import and allows retrying its tab", async () => {
    const prepare = vi.fn().mockRejectedValueOnce(new Error("module unavailable")).mockResolvedValue(undefined);
    const { manager } = mount(prepare);
    expect(await manager.actions.run("new")).toBe(false);
    expect(manager.activeId.value).toBeNull();
    expect(manager.tabs.value).toHaveLength(1);
    expect(await manager.activate(manager.tabs.value[0].id)).toBe(true);
    expect(manager.activeId.value).toBe(manager.tabs.value[0].id);
  });

  it("creates tabs without replacing dirty content, preserving identity, mode and pure checkpoints", async () => {
    const { manager, suspended, captures } = mount();
    expect(await manager.actions.run("new")).toBe(true);
    const first = { id: manager.activeId.value! }; manager.workspace.markdown.value = "unsaved"; manager.workspace.isSourceMode.value = true;
    expect(await manager.actions.run("new")).toBe(true);
    expect(manager.tabs.value).toHaveLength(2); expect(native.message).not.toHaveBeenCalled();
    expect(captures.get(first.id)?.active.documentId).toBe(first.id);
    expect(() => JSON.stringify(captures.get(first.id))).not.toThrow();
    expect(await manager.activate(first.id)).toBe(true); expect(manager.workspace.isSourceMode.value).toBe(true);
    expect(manager.workspace.markdown.value).toBe("unsaved"); expect(manager.workspace.dirty.value).toBe(true);
    const count = suspended.length; await manager.activate(first.id); expect(suspended).toHaveLength(count);
    expect(manager.tabs.value.map(tab => tab.title)).toEqual(["未命名 1", "未命名 2"]);
  });

  it("opens several files and canonical aliases only once", async () => {
    const { manager } = mount(); aliases.set("/alias.md", "/one.md");
    native.open.mockResolvedValue(["/one.md", "/alias.md", "/two.md"]);
    expect(await manager.actions.run("open")).toBe(true);
    expect(manager.tabs.value).toHaveLength(2);
    expect(native.invoke.mock.calls.filter(([command]) => command === "read_file").map(([, args]) => args.path)).toEqual(["/one.md", "/two.md"]);
    expect(manager.workspace.currentFilePath.value).toBe("/two.md");
    native.open.mockResolvedValue("/alias.md"); await manager.actions.run("open");
    expect(manager.workspace.currentFilePath.value).toBe("/one.md"); expect(manager.tabs.value).toHaveLength(2);
  });

  it("rejects Save As into another open file, including aliases", async () => {
    const { manager, first, read } = await two(); manager.workspace.markdown.value = "my edits";
    aliases.set("/alias.md", "/one.md"); native.save.mockResolvedValue("/alias.md");
    expect(await manager.actions.run("saveAs")).toBe(false);
    expect(disk.get("/one.md")).toBe("one"); expect(manager.workspace.currentFilePath.value).toBe("/two.md");
    expect(manager.workspace.dirty.value).toBe(true); expect((await read(first.id)).text).toBe("one");
    expect(native.invoke.mock.calls.filter(([command]) => command === "write_file")).toHaveLength(0);
  });

  it("saves all dirty tabs with independent encoding and disk versions", async () => {
    const { manager, first, second, edit, read } = await two();
    await edit(first.id, "first edit"); await edit(second.id, "second edit");
    expect(await manager.actions.run("saveAll")).toBe(true);
    expect(disk.get("/one.md")).toBe("first edit"); expect(disk.get("/two.md")).toBe("second edit");
    const writes = native.invoke.mock.calls.filter(([command]) => command === "write_file").map(([, args]) => args);
    expect(writes.map(args => [args.path, args.encoding, args.bom])).toEqual([["/one.md", "utf-16le", true], ["/two.md", "utf-8", false]]);
    expect((await read(first.id)).dirty).toBe(false); expect((await read(second.id)).dirty).toBe(false);
  });

  it.each(["Cancel", "No", "Yes"])("closes a dirty background tab with one named confirmation: %s", async choice => {
    const { manager, first, second, edit, read } = await two(); await edit(first.id, "first edit"); await manager.activate(second.id);
    choices.push(choice);
    expect(await manager.close(first.id)).toBe(choice !== "Cancel");
    expect(native.message.mock.calls[0][0]).toContain("one.md");
    expect((await read(second.id)).text).toBe("two");
    expect(manager.tabs.value).toHaveLength(choice === "Cancel" ? 2 : 1);
    expect(disk.get("/one.md")).toBe(choice === "Yes" ? "first edit" : "one");
  });

  it("keeps all tabs and backups if exit is cancelled after an earlier discard", async () => {
    const { manager, first, second, closed, edit, read } = await two();
    await edit(first.id, "first edit"); await edit(second.id, "second edit");
    await manager.recovery.flush();
    choices.push("No", "Cancel"); expect(await manager.actions.run("exit")).toBe(false);
    await manager.recovery.flush();
    expect(closed()).toBe(0); expect(manager.tabs.value).toHaveLength(2);
    expect((await read(first.id)).dirty).toBe(true); expect((await read(second.id)).dirty).toBe(true);
    expect(backups.get(first.id)?.content).toBe("first edit"); expect(backups.get(second.id)?.content).toBe("second edit");
    choices.push("No", "No"); expect(await manager.actions.run("exit")).toBe(true);
    expect(closed()).toBe(1); expect(backups.size).toBe(0);
  });

  it("cancels exit on save failure and blocks tab mutation while a confirmation is pending", async () => {
    const { manager, first, second, closed, edit, read } = await two(); await edit(first.id, "changed"); await manager.activate(second.id);
    choices.push("Yes"); failWrites = true; expect(await manager.actions.run("exit")).toBe(false);
    expect(closed()).toBe(0); expect(manager.tabs.value).toHaveLength(2);
    failWrites = false;
    let answer!: (choice: string) => void;
    native.message.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    const closing = manager.close(first.id); await vi.waitFor(() => expect(answer).toBeTypeOf("function"));
    expect(await manager.activate(second.id)).toBe(false);
    answer("Cancel"); expect(await closing).toBe(false); expect((await read(first.id)).text).toBe("changed");
  });

  it("retains both drafts across switching, removes only a closed tab and never advertises open drafts as recovery records", async () => {
    const { manager, first, second, edit } = await two();
    await edit(first.id, "first draft"); await edit(second.id, "second draft");
    await manager.recovery.flush(); await manager.activate(first.id); await manager.recovery.flush();
    expect([...backups.keys()].sort()).toEqual([first.id, second.id].sort());
    await manager.recovery.start(); expect(manager.recovery.records.value).toHaveLength(0);
    choices.push("No"); await manager.close(first.id);
    expect(backups.has(first.id)).toBe(false); expect(backups.get(second.id)?.content).toBe("second draft");
    expect(manager.recovery.records.value).toHaveLength(0);
  });

  it("tracks background external edits and reviews only the active file without overwriting it", async () => {
    const { manager, first } = await two(); disk.set("/one.md", "external");
    expect(await manager.workspace.checkExternalChange()).toBe(false);
    expect(manager.tabs.value.find(tab => tab.id === first.id)?.external).toBe(true);
    await manager.activate(first.id); choices.push("Cancel");
    expect(await manager.actions.reviewExternalChange()).toBe(false); expect(manager.workspace.markdown.value).toBe("one");
  });

  it("restores an already open path as an independent copy and preserves other unsaved tabs", async () => {
    const { manager, first, edit } = await two(); await edit(first.id, "live edit");
    const record: RecoverySnapshot = { version: 1, id: "old-recovery", path: "/one.md", content: "recovered", savedContent: "one", diskVersion: "v:one", sourceMode: false, encoding: "utf-8", bom: false, updatedAt: 1 };
    expect(await manager.actions.restore(record)).toBe(true);
    expect(manager.tabs.value).toHaveLength(3); expect(manager.tabs.value.find(tab => tab.id === first.id)?.dirty).toBe(true);
    expect(manager.workspace.currentFilePath.value).toBeNull(); expect(manager.workspace.recoveredCopy.value).toBe(true);
    expect(manager.workspace.markdown.value).toBe("recovered"); expect(native.message).not.toHaveBeenCalled();
  });

  it("retains edits made while another file is being read without asking to discard them", async () => {
    const { manager, first } = await two(); await manager.activate(first.id);
    const implementation = native.invoke.getMockImplementation()!;
    let finish!: () => void;
    native.invoke.mockImplementation((command, args) => command === "read_file" && args.path === "/three.md"
      ? new Promise(resolve => { finish = () => resolve({ content: "three", version: "v:three", encoding: "utf-8", bom: false }); }) : implementation(command, args));
    native.open.mockResolvedValue("/three.md");
    const opening = manager.actions.run("open"); await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    manager.workspace.markdown.value = "edit during read"; finish();
    expect(await opening).toBe(true); expect(manager.tabs.value.find(tab => tab.id === first.id)?.dirty).toBe(true); expect(native.message).not.toHaveBeenCalled();
    expect(await manager.activate(first.id)).toBe(true); expect(manager.workspace.markdown.value).toBe("edit during read");
  });

  it("rolls back activation when a target renderer fails to mount", async () => {
    const { manager, failMount } = mount(); await manager.actions.run("open"); const first = manager.activeId.value!;
    manager.workspace.markdown.value = "first draft";
    native.open.mockResolvedValue("/two.md"); failMount.add("/two.md");
    expect(await manager.actions.run("open")).toBe(false);
    expect(manager.activeId.value).toBe(first); expect(manager.workspace.markdown.value).toBe("first draft");
    expect(manager.tabs.value).toHaveLength(2);
  });

  it("closes all atomically, preserving unread recovery records, then shows the welcome state", async () => {
    const { manager, first, second, edit } = await two(); await edit(first.id, "a"); await edit(second.id, "b");
    choices.push("No", "Cancel"); expect(await manager.actions.run("closeAll")).toBe(false); expect(manager.tabs.value).toHaveLength(2);
    choices.push("No", "No"); expect(await manager.actions.run("closeAll")).toBe(true);
    expect(manager.tabs.value).toHaveLength(0); expect(manager.workspace.markdown.value).toBe(""); expect(manager.workspace.isUntitled.value).toBe(false);
    native.open.mockResolvedValue(null); expect(await manager.actions.run("open")).toBe(false);
    await nextTick(); expect(manager.activeId.value).toBeNull();
  });

  it("queues OS file opens behind a pending close confirmation without losing either document", async () => {
    const { manager, first, edit, read } = await two(); await edit(first.id, "draft");
    let answer!: (choice: string) => void;
    native.message.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    const closing = manager.close(first.id); await vi.waitFor(() => expect(answer).toBeTypeOf("function"));
    disk.set("/external.md", "opened from file manager");
    let delivered = false;
    const opening = manager.openPaths(["/external.md"]).then(value => { delivered = true; return value; });
    await nextTick(); expect(delivered).toBe(false);
    answer("Cancel"); expect(await closing).toBe(false); expect(await opening).toBe(true);
    expect(manager.tabs.value).toHaveLength(3); expect(manager.workspace.currentFilePath.value).toBe("/external.md");
    expect((await read(first.id)).text).toBe("draft");
  });

  it("cancels queued OS delivery when disposed instead of reopening a dead window", async () => {
    const { manager, first, stop, edit } = await two(); await edit(first.id, "draft");
    let answer!: (choice: string) => void;
    native.message.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    const closing = manager.close(first.id); await vi.waitFor(() => expect(answer).toBeTypeOf("function"));
    const opening = manager.openPaths(["/external.md"]); await nextTick(); stop(); answer("Cancel");
    expect(await closing).toBe(false); expect(await opening).toBe(false);
    expect(manager.tabs.value).toHaveLength(2);
  });
});
