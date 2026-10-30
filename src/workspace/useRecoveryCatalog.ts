import { computed, ref } from "vue";
import type { RecoveryStore } from "../document/ports";
import type { RecoverySnapshot } from "../document/types";

/** Records not owned by open documents. Each document retains its own writer. */
export function useRecoveryCatalog(store: RecoveryStore, openIds: () => readonly string[], stopped: () => boolean) {
  const archive = ref<RecoverySnapshot[]>([]);
  const unreadable = ref(0);
  const failed = ref(false);
  const ready = ref(false);
  const retired = new Set<string>();
  let queue: Promise<boolean> = Promise.resolve(true);
  const isOpen = (id: string) => openIds().includes(id);
  const records = computed(() => archive.value.filter(record => !isOpen(record.id)));

  function retire(id: string) {
    retired.add(id);
    archive.value = archive.value.filter(record => record.id !== id);
  }
  async function start() {
    try {
      const listing = await store.list();
      if (stopped()) return;
      archive.value = listing.records.filter(record => !retired.has(record.id) && !isOpen(record.id));
      unreadable.value = listing.unreadable;
      failed.value = false;
    } catch { failed.value = true; }
  }
  function markReady() { if (!stopped()) ready.value = true; }
  function remove(id: string): Promise<boolean> {
    if (isOpen(id)) return Promise.resolve(false);
    const operation = queue.then(async () => {
      if (isOpen(id)) return false;
      try {
        await store.remove(id);
        retire(id);
        failed.value = false;
        return true;
      } catch { failed.value = true; return false; }
    });
    queue = operation;
    return operation;
  }
  return { records, unreadable, failed, ready, start, markReady, remove, retire };
}
