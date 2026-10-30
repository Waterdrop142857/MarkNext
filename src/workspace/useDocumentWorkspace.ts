import { computed, nextTick, onScopeDispose, ref, shallowRef, watch, type Ref } from "vue";
import { createDocumentController } from "../document/createDocumentController";
import { useDocumentActions, type DocumentAction } from "../document/useDocumentActions";
import { useDocumentRecovery } from "./useDocumentRecovery";
import { useRecoveryCatalog } from "./useRecoveryCatalog";
import type { ExternalChange, FileEncoding } from "../document/types";
import type { DocumentActionsSource, RecoverySource } from "../document/consumers";
import type { DocumentPorts } from "../document/ports";
import type { EditorSessionCheckpoint } from "../editor/sessionTypes";
import type { EditorEvent, EditorLifecyclePort } from "../editor/editorPort";
import type { RecoverySnapshot, RecoveryView } from "../document/types";
import { t } from "../i18n";

interface Workspace extends DocumentActionsSource, RecoverySource {
  readonly markdown: Ref<string>;
  readonly currentFilePath: Ref<string | null>;
  readonly isUntitled: Ref<boolean>;
  readonly isSourceMode: Ref<boolean>;
  readonly selection: Ref<unknown>;
  readonly documentGeneration: Ref<number>;
  readonly externalChange: Readonly<Ref<ExternalChange | null>>;
  readonly recoveredCopy: Readonly<Ref<boolean>>;
  openPath(path: string): Promise<boolean>;
  checkExternalChange(): Promise<boolean>;
}
interface DocumentTab {
  readonly id: string;
  readonly workspace: Workspace;
  readonly revision: Ref<number>;
  readonly untitledNumber: number;
  checkpoint: EditorSessionCheckpoint | null;
  view?: RecoveryView;
  actions: ReturnType<typeof useDocumentActions>;
  recovery: ReturnType<typeof useDocumentRecovery>;
  stop(): void;
}
export type TabAction = DocumentAction | "exit" | "saveAll" | "closeAll" | "nextTab" | "previousTab";

export function useDocumentWorkspace(getDefaultEncoding: () => FileEncoding, ports: DocumentPorts, host: {
  editor(): EditorLifecyclePort | null;
  prepareEditor?(): Promise<void>;
  getView(): RecoveryView;
  applyView?(view: RecoveryView | undefined, sourceMode: boolean): void;
  closeWindow(): Promise<void>;
}) {
  const documents = shallowRef<DocumentTab[]>([]);
  const active = shallowRef<DocumentTab | null>(null);
  const generation = ref(0);
  const busy = ref(false);
  const locked = ref(false);
  let untitledSequence = 0;
  let stopped = false;
  const catalog = useRecoveryCatalog(ports.recovery, () => documents.value.map(tab => tab.id), () => stopped);
  let externalQueue: Promise<boolean> = Promise.resolve(true);
  const idleWaiters = new Set<(ready: boolean) => void>();

  function name(tab: DocumentTab): string {
    return tab.workspace.currentFilePath.value?.split(/[\\/]/).pop()
      || t("tabs.untitled", { number: tab.untitledNumber });
  }
  async function canonical(path: string) { return ports.files.canonicalPath(path); }
  async function guard(operation: () => Promise<boolean>): Promise<boolean> {
    if (busy.value || stopped) return false;
    busy.value = true;
    try { return await operation(); }
    catch (error) { if (!stopped) await ports.prompts.error("fileAction", error); return false; }
    finally { locked.value = false; busy.value = false; }
  }

  function createWorkspace() {
    let workspace: Workspace;
    workspace = createDocumentController(getDefaultEncoding, ports, {
      resolveSavePath: async path => {
        const selected = await canonical(path);
        const duplicate = documents.value.find(tab => tab.workspace !== workspace && tab.workspace.currentFilePath.value === selected);
        if (duplicate) { await ports.prompts.alreadyOpen(selected); return null; }
        return selected;
      },
    });
    return workspace;
  }

  function register(workspace: Workspace): DocumentTab {
    const revision = ref(0);
    const stopRevision = watch(workspace.markdown, () => { revision.value++; }, { flush: "sync" });
    const tab = {
      id: workspace.documentId.value, workspace, revision,
      untitledNumber: workspace.currentFilePath.value ? 0 : ++untitledSequence,
      checkpoint: null,
    } as DocumentTab;
    const flushEditor = () => { if (active.value === tab) host.editor()?.flush(); };
    tab.actions = useDocumentActions(workspace, ports.prompts, {
      flushEditor, documentName: () => name(tab),
    });
    tab.recovery = useDocumentRecovery(workspace, ports.recovery, {
      flushEditor,
      getView: () => active.value === tab && !tab.checkpoint ? host.getView() : tab.view,
    });
    // A reload is a new renderer generation inside the same document. A tab
    // activation is a different renderer generation without changing its mode.
    const stopGeneration = watch(workspace.documentGeneration, () => {
      tab.checkpoint = null;
      if (active.value === tab) generation.value++;
    }, { flush: "sync" });
    tab.stop = () => { stopRevision(); stopGeneration(); tab.recovery.stop(); };
    documents.value = [...documents.value, tab];
    if (catalog.ready.value) void tab.recovery.start({ records: [], unreadable: 0 });
    return tab;
  }

  async function mount(tab: DocumentTab | null) {
    try { if (tab) await host.prepareEditor?.(); }
    catch (error) { if (!stopped) await ports.prompts.error("fileAction", error); return false; }
    if (stopped) return false;
    active.value = tab;
    generation.value++;
    await nextTick();
    if (stopped) return false;
    if (!tab) return true;
    const renderer = host.editor();
    return !!renderer && await renderer.resume();
  }
  async function activateInternal(target: DocumentTab | null): Promise<boolean> {
    const previous = active.value;
    if (target === previous) return !target || !!host.editor() && await host.editor()!.resume();
    if (previous) {
      const renderer = host.editor();
      if (!renderer) return false;
      previous.view = host.getView();
      const snapshot = await renderer.suspend();
      if (!snapshot || snapshot.active.documentId !== previous.id || snapshot.active.revision !== previous.revision.value) return false;
      previous.checkpoint = snapshot;
      previous.workspace.selection.value = null; // Never retain live block refs.
      // Queue an immutable backup without putting disk latency on tab switches.
      void previous.recovery.flush();
    }
    if (!(await mount(target))) {
      // Keep both checkpoints and restore the outgoing tab if the target's
      // renderer cannot be reconstructed. Neither document is discarded.
      const restored = await mount(previous);
      if (previous && restored) previous.checkpoint = null;
      return false;
    }
    if (target) target.checkpoint = null;
    return true;
  }
  const activate = (id: string) => guard(async () => {
    const tab = documents.value.find(item => item.id === id);
    return !!tab && await activateInternal(tab);
  });

  async function settle(tab: DocumentTab) {
    if (active.value !== tab) return true;
    const snapshot = await host.editor()?.capture();
    if (!snapshot) return false;
    tab.view = host.getView();
    return snapshot.active.documentId === tab.id && snapshot.active.revision === tab.revision.value;
  }
  async function confirm(tab: DocumentTab) {
    if (!(await activateInternal(tab)) || !(await settle(tab))) return false;
    return tab.actions.confirmAndRun();
  }
  async function closeInternal(tab: DocumentTab) {
    if (active.value === tab && !(await settle(tab))) return false;
    if (tab.workspace.dirty.value && !(await confirm(tab))) return false;
    const approved = tab.workspace.markdown.value;
    if (active.value === tab) { locked.value = true; await nextTick(); }
    if (tab.workspace.markdown.value !== approved && !(await confirm(tab))) return false;
    if (!(await tab.recovery.prepareExit())) { tab.recovery.resume(); return false; }
    if (active.value === tab) {
      const index = documents.value.indexOf(tab);
      const next = documents.value[index + 1] ?? documents.value[index - 1] ?? null;
      if (!(await activateInternal(next))) { tab.recovery.resume(); await tab.recovery.flush(); return false; }
    }
    documents.value = documents.value.filter(item => item !== tab);
    catalog.retire(tab.id);
    tab.stop();
    return true;
  }

  // Approvals are content-specific and do not remove tabs. Canceling a later
  // prompt must leave earlier "Don't Save" tabs dirty and recoverable.
  async function confirmAll(approved: Map<string, string>): Promise<boolean> {
    for (;;) {
      if (active.value && !(await settle(active.value))) return false;
      const tab = documents.value.find(item => item.workspace.dirty.value && approved.get(item.id) !== item.workspace.markdown.value);
      if (!tab) return true;
      if (!(await confirm(tab))) return false;
      approved.set(tab.id, tab.workspace.markdown.value);
    }
  }

  async function openDocuments(): Promise<boolean> {
    const paths = await ports.picker.openMany();
    if (!paths?.length || stopped) return false;
    return openPathsInternal(paths);
  }
  async function openPathsInternal(paths: readonly string[]): Promise<boolean> {
    let done = false;
    for (const path of paths) {
      try {
        const normalized = await canonical(path);
        if (stopped) return false;
        const existing = documents.value.find(tab => tab.workspace.currentFilePath.value === normalized);
        if (existing) { done = await activateInternal(existing) || done; continue; }
        const workspace = createWorkspace();
        if (!(await workspace.openPath(normalized))) continue;
        if (stopped) return false;
        const tab = register(workspace);
        done = await activateInternal(tab) || done;
      }
      catch (error) { if (!stopped) await ports.prompts.error("open", error); }
    }
    return done;
  }

  // OS deliveries wait for an in-progress confirmation instead of being
  // dropped by the user-command reentrancy guard.
  function openPaths(paths: readonly string[]): Promise<boolean> {
    const task = externalQueue.then(async () => {
      while (busy.value && !stopped) {
        const ready = await new Promise<boolean>(resolve => {
          const finish = (ready: boolean) => { stopWatch(); idleWaiters.delete(finish); resolve(ready); };
          const stopWatch = watch(busy, value => { if (!value) finish(true); });
          idleWaiters.add(finish);
        });
        if (!ready) return false;
      }
      return !stopped && guard(() => paths.length ? openPathsInternal(paths) : Promise.resolve(true));
    });
    externalQueue = task.catch(() => false);
    return task;
  }

  async function run(action: TabAction): Promise<boolean> {
    return guard(async () => {
      if (action === "new") {
        const workspace = createWorkspace(); workspace.newFile();
        return activateInternal(register(workspace));
      }
      if (action === "open") return openDocuments();
      if (action === "nextTab" || action === "previousTab") {
        if (!documents.value.length) return false;
        const index = documents.value.indexOf(active.value!);
        const offset = action === "nextTab" ? 1 : -1;
        return activateInternal(documents.value[(index + offset + documents.value.length) % documents.value.length]);
      }
      if (action === "exit") {
        const approved = new Map<string, string>();
        if (!(await confirmAll(approved))) return false;
        locked.value = true; await nextTick();
        if (!(await confirmAll(approved))) return false;
        await host.closeWindow(); return true;
      }
      if (action === "closeAll") {
        const approved = new Map<string, string>();
        if (!(await confirmAll(approved))) return false;
        locked.value = true; await nextTick();
        if (!(await confirmAll(approved))) return false;
        if (!(await prepareExit())) { resumeRecovery(); return false; }
        if (!(await activateInternal(null))) { resumeRecovery(); await flushRecovery(); return false; }
        documents.value.forEach(tab => { catalog.retire(tab.id); tab.stop(); });
        documents.value = [];
        return true;
      }
      if (action === "saveAll") {
        for (const tab of documents.value) {
          if (tab === active.value && !(await settle(tab))) return false;
          if (tab.workspace.dirty.value && !(await tab.actions.run("save"))) { await activateInternal(tab); return false; }
        }
        return true;
      }
      const tab = active.value;
      if (!tab) return false;
      if (action === "close") return closeInternal(tab);
      if (!(await settle(tab))) return false;
      return tab.actions.run(action);
    });
  }

  async function restore(record: RecoverySnapshot): Promise<boolean> {
    return guard(async () => {
      const workspace = createWorkspace();
      let incoming = record;
      if (record.path) {
        try {
          const path = await canonical(record.path);
          incoming = { ...record, path, ...(documents.value.some(tab => tab.workspace.currentFilePath.value === path) ? { diskVersion: "missing" } : {}) };
        }
        catch { incoming = { ...record, diskVersion: "missing" }; }
      }
      if (!(await workspace.restoreRecovery(incoming, async () => true, () => {}))) return false;
      if (stopped) return false;
      const tab = register(workspace);
      tab.view = record.view ?? undefined;
      const done = await activateInternal(tab);
      if (done) host.applyView?.(tab.view, workspace.isSourceMode.value);
      return done;
    });
  }

  async function checkExternalChange(): Promise<boolean> {
    const initial = active.value, initialGeneration = generation.value;
    let changed = false;
    for (const tab of documents.value) {
      const result = await tab.workspace.checkExternalChange();
      if (tab === initial) changed = result;
    }
    return changed && active.value === initial && generation.value === initialGeneration && !busy.value;
  }
  const reviewExternalChange = () => guard(async () => {
    const tab = active.value;
    return !!tab && await settle(tab) && await tab.actions.reviewExternalChange();
  });

  async function startRecovery() {
    await catalog.start();
    if (stopped) return;
    await Promise.all(documents.value.map(tab => tab.recovery.start({ records: [], unreadable: 0 })));
  }
  async function flushRecovery() {
    const results = await Promise.all(documents.value.map(tab => tab.recovery.flush()));
    return results.every(Boolean);
  }
  async function prepareExit() {
    const results = await Promise.all(documents.value.map(tab => tab.recovery.prepareExit()));
    return results.every(Boolean);
  }
  function resumeRecovery() { documents.value.forEach(tab => tab.recovery.resume()); }
  function stop() {
    stopped = true;
    for (const resolve of idleWaiters) resolve(false);
    idleWaiters.clear();
    documents.value.forEach(tab => tab.stop());
  }
  onScopeDispose(stop);

  function bind<T>(select: (workspace: Workspace) => Ref<T>, fallback: T) {
    return computed({ get: () => active.value ? select(active.value.workspace).value : fallback,
      set: value => { if (active.value) select(active.value.workspace).value = value; } });
  }
  const workspace = {
    markdown: bind(ws => ws.markdown, ""),
    currentFilePath: bind(ws => ws.currentFilePath, null),
    isUntitled: bind(ws => ws.isUntitled, false),
    isSourceMode: bind(ws => ws.isSourceMode, false),
    selection: bind(ws => ws.selection, null),
    dirty: computed(() => active.value?.workspace.dirty.value ?? false),
    documentGeneration: generation,
    documentId: computed(() => active.value?.id ?? "empty"),
    externalChange: computed(() => active.value?.workspace.externalChange.value ?? null),
    recoveredCopy: computed(() => active.value?.workspace.recoveredCopy.value ?? false),
    checkExternalChange,
  };
  function isCurrentRenderer(event: Pick<EditorEvent<unknown>, "documentId" | "generation">): boolean {
    return !stopped && active.value?.id === event.documentId && generation.value === event.generation;
  }
  function updateMarkdown(event: EditorEvent<string>): void {
    if (isCurrentRenderer(event) && active.value) active.value.workspace.markdown.value = event.value;
  }
  function updateMode(event: EditorEvent<boolean>): void {
    if (isCurrentRenderer(event) && active.value) active.value.workspace.isSourceMode.value = event.value;
  }
  function updateSelection(event: EditorEvent<boolean>): void {
    if (isCurrentRenderer(event) && active.value) active.value.workspace.selection.value = event.value;
  }
  return {
    isCurrentRenderer, updateMarkdown, updateMode, updateSelection,
    workspace, activeId: computed(() => active.value?.id ?? null), busy, locked,
    identity: computed(() => ({ documentId: active.value?.id ?? "empty", revision: active.value?.revision.value ?? 0 })),
    checkpoint: computed(() => { generation.value; return active.value?.checkpoint ?? null; }),
    title: computed(() => active.value ? name(active.value) : t("document.none")),
    tabs: computed(() => documents.value.map(tab => ({ id: tab.id, title: name(tab), path: tab.workspace.currentFilePath.value,
      dirty: tab.workspace.dirty.value, external: !!tab.workspace.externalChange.value }))),
    activate,
    openPaths,
    close: (id: string) => guard(async () => { const tab = documents.value.find(item => item.id === id); return !!tab && await closeInternal(tab); }),
    actions: { run, restore, reviewExternalChange, isPending: () => busy.value },
    recovery: {
      records: catalog.records,
      unreadable: catalog.unreadable, failed: computed(() => catalog.failed.value || documents.value.some(tab => tab.recovery.failed.value)),
      start: startRecovery, flush: flushRecovery, prepareExit, resume: resumeRecovery, remove: catalog.remove, stop,
    },
  };
}
