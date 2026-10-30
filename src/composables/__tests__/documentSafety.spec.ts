import { createTauriDocumentPorts } from "../../platform/tauri/documentPorts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { createDocumentController } from "../../document/createDocumentController";
import { useDocumentActions } from "../../document/useDocumentActions";
import { useDocumentRecovery } from "../../workspace/useDocumentRecovery";
import type { RecoverySnapshot } from "../../document/types";

const native = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn(), save: vi.fn(), message: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: native.open, save: native.save, message: native.message }));
let disk: Map<string, string>;
let records: Map<string, RecoverySnapshot>;
let failBackup = false;
const managers: ReturnType<typeof useDocumentRecovery>[] = [];
const version = (path: string) => disk.has(path) ? `v:${disk.get(path)}` : "missing";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  disk = new Map([["/note.md", "base"]]); records = new Map(); failBackup = false;
  native.open.mockReset().mockResolvedValue("/note.md"); native.save.mockReset().mockResolvedValue("/copy.md");
  native.message.mockReset().mockResolvedValue("Cancel");
  native.invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === "read_file") return { content: disk.get(args.path), encoding: "utf-8", bom: false, version: version(args.path), stamp: version(args.path) };
    if (command === "file_version") return version(args.path);
    if (command === "file_status") return version(args.path);
    if (command === "write_file") {
      if (args.expectedVersion !== version(args.path)) throw { code: "conflict", version: version(args.path) };
      disk.set(args.path, args.content); return version(args.path);
    }
    if (command === "recovery_list") return { records: [...records.values()], unreadable: 0 };
    if (command === "recovery_write") {
      if (failBackup) throw new Error("backup failed");
      records.set(args.snapshot.id, structuredClone(args.snapshot)); return;
    }
    if (command === "recovery_remove") { records.delete(args.id); return; }
    throw new Error(`Unexpected command ${command}`);
  });
});
afterEach(() => { managers.splice(0).forEach(manager => manager.stop()); vi.useRealTimers(); });
async function opened() { const workspace = createDocumentController(() => "utf-8", createTauriDocumentPorts()); await workspace.openFile(); return workspace; }
function actions(workspace: ReturnType<typeof createDocumentController>) {
  return useDocumentActions(workspace, createTauriDocumentPorts().prompts, { flushEditor: () => {} });
}
function manager(workspace: ReturnType<typeof createDocumentController>) {
  const value = useDocumentRecovery(workspace, createTauriDocumentPorts().recovery, { flushEditor: () => {}, getView: () => ({ scrollTop: 123 }) });
  managers.push(value); return value;
}
function record(): RecoverySnapshot {
  return { version: 1, id: "previous-session", path: "/note.md", content: "未保存 📝", savedContent: "base", encoding: "utf-16be", bom: true, diskVersion: "v:base", sourceMode: true, updatedAt: 123 };
}

it("rejects an external edit at save time even without a prior background check", async () => {
  const workspace = await opened(); workspace.markdown.value = "mine"; disk.set("/note.md", "external");
  expect(await workspace.saveFile()).toBe(false);
  expect(disk.get("/note.md")).toBe("external");
  expect(workspace.markdown.value).toBe("mine"); expect(workspace.dirty.value).toBe(true);
  expect(workspace.externalChange.value).toEqual({ kind: "changed", version: "v:external" });
  expect(native.message).not.toHaveBeenCalled();
});

it("marks deletion without recreating the original; Save As keeps local edits", async () => {
  const workspace = await opened(); workspace.markdown.value = "mine"; disk.delete("/note.md");
  await workspace.checkExternalChange(); expect(workspace.externalChange.value?.kind).toBe("deleted");
  expect(await workspace.saveFile()).toBe(false); expect(disk.has("/note.md")).toBe(false);
  expect(await workspace.saveFileAs()).toBe(true); expect(disk.get("/copy.md")).toBe("mine");
  expect(workspace.externalChange.value).toBeNull();
});

it("rechecks the specific version approved for overwrite and rejects a later edit", async () => {
  const workspace = await opened(); workspace.markdown.value = "mine"; disk.set("/note.md", "first external");
  await workspace.checkExternalChange();
  const answer = deferred<string>(); native.message.mockReturnValueOnce(answer.promise);
  const saving = actions(workspace).run("overwrite");
  disk.set("/note.md", "second external"); answer.resolve("Ok");
  expect(await saving).toBe(false); expect(disk.get("/note.md")).toBe("second external");
  expect(workspace.externalChange.value?.version).toBe("v:second external");
  native.message.mockResolvedValue("Ok"); expect(await actions(workspace).run("overwrite")).toBe(true);
  expect(disk.get("/note.md")).toBe("mine");
});

it.each([false, true])("asks before replacing an externally changed file (dirty: %s) and keeps both versions on dismissal", async dirty => {
  const workspace = await opened(); const command = actions(workspace);
  if (dirty) workspace.markdown.value = "mine";
  const content = workspace.markdown.value; const generation = workspace.documentGeneration.value;
  disk.set("/note.md", "external"); await workspace.checkExternalChange();
  expect(await command.reviewExternalChange()).toBe(false);
  expect(workspace.markdown.value).toBe(content); expect(workspace.documentGeneration.value).toBe(generation);
  expect(disk.get("/note.md")).toBe("external");
  await workspace.checkExternalChange(); expect(await command.reviewExternalChange()).toBe(false);
  expect(native.message).toHaveBeenCalledTimes(1);
  expect(native.invoke.mock.calls.filter(([command]) => command === "read_file")).toHaveLength(1);
  expect(native.invoke.mock.calls.filter(([command]) => command === "write_file")).toHaveLength(0);
  // Retaining the editor never acknowledges the external version for saving.
  expect(await workspace.saveFile()).toBe(false); expect(disk.get("/note.md")).toBe("external");
});

it.each([false, true])("loads disk content only after approval with one prompt (dirty: %s)", async dirty => {
  const workspace = await opened(); const command = actions(workspace);
  if (dirty) workspace.markdown.value = "mine";
  disk.set("/note.md", "external"); await workspace.checkExternalChange();
  native.message.mockResolvedValue("Ok");
  expect(await command.reviewExternalChange()).toBe(true);
  expect(workspace.markdown.value).toBe("external"); expect(workspace.dirty.value).toBe(false);
  expect(workspace.diskVersion.value).toBe("v:external"); expect(workspace.externalChange.value).toBeNull();
  expect(native.message).toHaveBeenCalledTimes(1);
  expect(native.invoke.mock.calls.filter(([command]) => command === "write_file")).toHaveLength(0);
});

it("asks again for a new external version or another document session", async () => {
  const workspace = await opened(); const command = actions(workspace);
  disk.set("/note.md", "external"); await workspace.checkExternalChange(); await command.reviewExternalChange();
  disk.set("/note.md", "second external"); await workspace.checkExternalChange(); await command.reviewExternalChange();
  expect(native.message).toHaveBeenCalledTimes(2);
  await workspace.openFile(); disk.set("/note.md", "external");
  await workspace.checkExternalChange(); await command.reviewExternalChange();
  expect(native.message).toHaveBeenCalledTimes(3);
});

it("serializes external review and protects edits arriving while its prompt is open", async () => {
  const workspace = await opened(); const command = actions(workspace);
  disk.set("/note.md", "external"); await workspace.checkExternalChange();
  const answer = deferred<string>(); native.message.mockReturnValueOnce(answer.promise);
  const reviewing = command.reviewExternalChange();
  expect(command.isPending()).toBe(true); expect(await command.reviewExternalChange()).toBe(false);
  expect(await command.run("save")).toBe(false);
  workspace.markdown.value = "new edits during prompt"; answer.resolve("Ok");
  expect(await reviewing).toBe(false); expect(workspace.markdown.value).toBe("new edits during prompt");
  expect(native.message).toHaveBeenCalledTimes(2); expect(command.isPending()).toBe(false);
});

it("ignores approval for a superseded document", async () => {
  const workspace = await opened(); const command = actions(workspace);
  disk.set("/note.md", "external"); await workspace.checkExternalChange();
  const answer = deferred<string>(); native.message.mockReturnValueOnce(answer.promise);
  const reviewing = command.reviewExternalChange(); workspace.newFile(); workspace.markdown.value = "another document";
  answer.resolve("Ok"); expect(await reviewing).toBe(false);
  expect(workspace.markdown.value).toBe("another document"); expect(workspace.currentFilePath.value).toBeNull();
});

it("preserves edits that arrive while an approved external reload is reading", async () => {
  const workspace = await opened(); const pending = deferred<unknown>();
  disk.set("/note.md", "external"); await workspace.checkExternalChange();
  native.message.mockResolvedValueOnce("Ok");
  native.invoke.mockImplementationOnce(() => pending.promise);
  const reloading = actions(workspace).reviewExternalChange();
  await vi.waitFor(() => expect(native.invoke.mock.calls.filter(([command]) => command === "read_file")).toHaveLength(2));
  workspace.markdown.value = "typed while reading";
  pending.resolve({ content: "external", version: "v:external", encoding: "utf-8", bom: false });
  expect(await reloading).toBe(false); expect(workspace.markdown.value).toBe("typed while reading");
  expect(native.message).toHaveBeenCalledTimes(2);
});

it("ignores a stale disk check returned after a successful save", async () => {
  const workspace = await opened(); const pending = deferred<string>();
  native.invoke.mockImplementationOnce(() => pending.promise);
  const checking = workspace.checkExternalChange(); workspace.markdown.value = "mine";
  expect(await workspace.saveFile()).toBe(true); pending.resolve("v:base");
  expect(await checking).toBe(false); expect(workspace.externalChange.value).toBeNull();
});

it("serializes saves using the previous write's returned version", async () => {
  const workspace = await opened(); workspace.markdown.value = "first";
  const original = native.invoke.getMockImplementation()!; const wait = deferred<void>();
  native.invoke.mockImplementationOnce(async (command, args) => { await wait.promise; return original(command, args); });
  const first = workspace.saveFile(); await Promise.resolve();
  workspace.markdown.value = "second"; const second = workspace.saveFile(); wait.resolve();
  expect(await first).toBe(true); expect(await second).toBe(true);
  expect(disk.get("/note.md")).toBe("second");
  const writes = native.invoke.mock.calls.filter(([command]) => command === "write_file");
  expect(writes.map(([, args]) => args.expectedVersion)).toEqual(["v:base", "v:first"]);
});

it("uses metadata for unchanged polling and fingerprints each newly observed disk state once", async () => {
  const workspace = await opened();
  await workspace.checkExternalChange(); await workspace.checkExternalChange();
  expect(native.invoke.mock.calls.filter(([command]) => command === "file_version")).toHaveLength(0);
  disk.set("/note.md", "external"); await workspace.checkExternalChange();
  const notice = workspace.externalChange.value;
  await workspace.checkExternalChange(); await workspace.checkExternalChange();
  expect(native.invoke.mock.calls.filter(([command]) => command === "file_version")).toHaveLength(1);
  expect(workspace.externalChange.value).toBe(notice);
});

it.each(["changed", "deleted"])("restores %s originals as independent copies with preserved encoding and empty edits", async kind => {
  const workspace = createDocumentController(() => "utf-8", createTauriDocumentPorts()); const snapshot = { ...record(), content: "" };
  if (kind === "changed") disk.set("/note.md", "external"); else disk.delete("/note.md");
  const original = disk.get("/note.md");
  expect(await actions(workspace).restore(snapshot)).toBe(true);
  expect(workspace.currentFilePath.value).toBeNull(); expect(workspace.isUntitled.value).toBe(true);
  expect(workspace.dirty.value).toBe(true); expect(workspace.isSourceMode.value).toBe(true);
  expect(workspace.fileFormat.value).toEqual({ encoding: "utf-16be", bom: true });
  expect(workspace.documentId.value).not.toBe(snapshot.id); expect(disk.get("/note.md")).toBe(original);
});

it("restores matching originals with their old baseline and protects the current dirty document", async () => {
  const workspace = await opened(); workspace.markdown.value = "current unsaved";
  expect(await actions(workspace).restore(record())).toBe(false); expect(workspace.markdown.value).toBe("current unsaved");
  native.message.mockResolvedValue("No"); expect(await actions(workspace).restore(record())).toBe(true);
  expect(workspace.currentFilePath.value).toBe("/note.md"); expect(workspace.diskVersion.value).toBe("v:base");
  expect(workspace.markdown.value).toBe("未保存 📝"); expect(disk.get("/note.md")).toBe("base");
});

it("debounces backups, bounds continuous input to five seconds and removes records only after saving", async () => {
  vi.useFakeTimers(); const workspace = await opened(); const recovery = manager(workspace); await recovery.start();
  for (let index = 0; index < 9; index++) {
    workspace.markdown.value = `edit ${index}`; await nextTick(); await vi.advanceTimersByTimeAsync(600);
  }
  expect(records.get(workspace.documentId.value)?.content).toBe("edit 8");
  expect(records.get(workspace.documentId.value)?.view?.scrollTop).toBe(123);
  expect(native.invoke.mock.calls.filter(([command]) => command === "recovery_write")).toHaveLength(1);
  await recovery.flush(); await recovery.flush();
  expect(native.invoke.mock.calls.filter(([command]) => command === "recovery_write")).toHaveLength(1);
  await workspace.saveFile(); await nextTick(); await recovery.flush(); expect(records.size).toBe(0);
});

it("orders document retirement after in-flight backups so discarded records cannot reappear", async () => {
  const workspace = await opened(); workspace.markdown.value = "mine";
  const recovery = manager(workspace); await recovery.start();
  const original = native.invoke.getMockImplementation()!; const wait = deferred<void>();
  native.invoke.mockImplementationOnce(async (command, args) => { await wait.promise; return original(command, args); });
  const backup = recovery.flush(); await Promise.resolve(); workspace.newFile(); await nextTick();
  wait.resolve(); await backup; await recovery.flush(); expect(records.size).toBe(0);
});

it("keeps unreviewed startup records on exit and resumes backups after a failed window close", async () => {
  records.set(record().id, record()); const workspace = await opened(); workspace.markdown.value = "mine";
  const recovery = manager(workspace); await recovery.start(); await recovery.flush();
  expect(await recovery.prepareExit()).toBe(true); expect(records.has(workspace.documentId.value)).toBe(false);
  expect(records.has(record().id)).toBe(true);
  workspace.markdown.value = "new edits"; await nextTick(); await recovery.flush();
  expect(records.has(workspace.documentId.value)).toBe(false);
  recovery.resume(); await recovery.flush(); expect(records.get(workspace.documentId.value)?.content).toBe("new edits");
});

it("reports storage failure and preserves previous backups until a successful retry", async () => {
  const workspace = await opened(); workspace.markdown.value = "first";
  const recovery = manager(workspace); await recovery.start(); await recovery.flush();
  workspace.markdown.value = "latest"; failBackup = true;
  expect(await recovery.flush()).toBe(false); expect(recovery.failed.value).toBe(true);
  expect(records.get(workspace.documentId.value)?.content).toBe("first");
  failBackup = false; expect(await recovery.flush()).toBe(true);
  expect(recovery.failed.value).toBe(false); expect(records.get(workspace.documentId.value)?.content).toBe("latest");
});

it("exit cleanup follows backups queued after an earlier deletion", async () => {
  const workspace = await opened(); workspace.markdown.value = "first";
  const recovery = manager(workspace); await recovery.start(); await recovery.flush();
  const original = native.invoke.getMockImplementation()!;
  const deleting = deferred<void>(); const writing = deferred<void>();
  native.invoke.mockImplementationOnce(async (command, args) => { await deleting.promise; return original(command, args); });
  const removal = recovery.remove(workspace.documentId.value); await Promise.resolve();
  workspace.markdown.value = "later";
  native.invoke.mockImplementationOnce(async (command, args) => { await writing.promise; return original(command, args); });
  const backup = recovery.flush(); deleting.resolve(); await removal;
  const exiting = recovery.prepareExit(); writing.resolve();
  await backup; expect(await exiting).toBe(true); expect(records.size).toBe(0);
});
