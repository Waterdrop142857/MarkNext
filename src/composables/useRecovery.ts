import { ref, watch } from "vue";
import type { RecoverySource } from "../document/consumers";
import type { RecoveryStore } from "../document/ports";
import type { RecoveryListing, RecoverySnapshot, RecoveryView } from "../document/types";
import { defaultFileFormat } from "../document/types";

// One write queue orders backups and deletions across document switches. Never
// send a mutable workspace object to an asynchronous write.
export function useRecovery(workspace: RecoverySource, store: RecoveryStore, options: {
  flushEditor: () => void;
  getView?: () => RecoveryView | undefined;
}) {
  const records = ref<RecoverySnapshot[]>([]);
  const unreadable = ref(0);
  const failed = ref(false);
  const ready = ref(false);
  const known = new Set<string>();
  const signatures = new Map<string, string>();
  let queue: Promise<boolean> = Promise.resolve(true);
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let suspended = false;

  function enqueue(operation: () => Promise<void>): Promise<boolean> {
    const result = queue.then(operation).then(() => { failed.value = false; return true; }, () => { failed.value = true; return false; });
    queue = result;
    return result;
  }
  function clearTimers() { clearTimeout(debounce); clearTimeout(deadline); debounce = deadline = undefined; }
  function remove(id: string): Promise<boolean> {
    return enqueue(async () => {
      await store.remove(id);
      known.delete(id); signatures.delete(id);
      records.value = records.value.filter(record => record.id !== id);
    });
  }
  function snapshot(): RecoverySnapshot {
    return {
      version: 1, id: workspace.documentId.value, path: workspace.currentFilePath.value,
      content: workspace.markdown.value, savedContent: workspace.savedMarkdown.value,
      ...(workspace.fileFormat.value ?? defaultFileFormat("utf-8")),
      diskVersion: workspace.diskVersion.value, sourceMode: workspace.isSourceMode.value,
      updatedAt: Date.now(), view: options.getView?.(),
    };
  }
  async function flush(): Promise<boolean> {
    clearTimers();
    if (suspended) return queue;
    options.flushEditor();
    const id = workspace.documentId.value;
    if (!workspace.dirty.value) return known.has(id) ? remove(id) : queue;
    const record = snapshot();
    const signature = JSON.stringify({ ...record, updatedAt: 0 });
    if (signatures.get(id) === signature) return queue;
    known.add(id);
    return enqueue(async () => {
      known.add(id);
      if (signatures.get(id) === signature) return;
      await store.write(record);
      signatures.set(id, signature);
    });
  }
  function schedule() {
    if (suspended || !ready.value) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => { void flush(); }, 750);
    deadline ??= setTimeout(() => { void flush(); }, 5000);
  }
  const stopWatch = watch([
    workspace.documentId, workspace.markdown, workspace.savedMarkdown, workspace.dirty,
    workspace.currentFilePath, workspace.fileFormat, workspace.diskVersion, workspace.isSourceMode,
  ], (_next, previous) => {
    const oldId = previous?.[0];
    if (typeof oldId === "string" && oldId !== workspace.documentId.value) {
      clearTimers();
      if (known.has(oldId)) void remove(oldId);
    }
    if (!workspace.dirty.value && known.has(workspace.documentId.value) && ready.value && !suspended) {
      clearTimers(); void remove(workspace.documentId.value);
    }
    else schedule();
  }, { flush: "post" });

  async function start(initial?: RecoveryListing): Promise<void> {
    try {
      const listing = initial ?? await store.list();
      listing.records.forEach(record => known.add(record.id));
      records.value = listing.records.filter(record => record.id !== workspace.documentId.value);
      unreadable.value = listing.unreadable;
      failed.value = false;
    }
    catch { failed.value = true; }
    ready.value = true;
    if (workspace.dirty.value) schedule();
  }
  async function prepareExit(): Promise<boolean> {
    clearTimers(); suspended = true;
    const id = workspace.documentId.value;
    // Always queue the deletion after every pending backup. An earlier
    // deletion may have cleared `known` while a later write is still queued.
    return remove(id);
  }
  function resume() { suspended = false; schedule(); }
  function stop() { suspended = true; clearTimers(); stopWatch(); }
  return { records, unreadable, failed, ready, start, flush, remove, prepareExit, resume, stop };
}
