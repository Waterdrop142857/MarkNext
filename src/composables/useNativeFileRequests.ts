import { onMounted, onScopeDispose, ref } from "vue";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

interface OpenRequest { id: number; paths: string[] }

/** The Rust queue owns delivery until the UI has handled and acknowledged it. */
export function useNativeFileRequests(openPaths: (paths: readonly string[]) => Promise<boolean>) {
  const failed = ref(false);
  let disposed = false, draining = false, again = false;
  let unlisten: UnlistenFn | null = null;
  let starting: Promise<void> | null = null;

  async function drain() {
    if (disposed || !isTauri()) return;
    if (draining) { again = true; return; }
    draining = true;
    try {
      do {
        again = false;
        const requests = await invoke<OpenRequest[]>("pending_open_requests");
        for (const request of requests) {
          if (disposed) return;
          await openPaths(request.paths);
          if (disposed) return;
          // File errors have already been reported by the document manager.
          await invoke("acknowledge_open_request", { id: request.id });
        }
      } while (again && !disposed);
      failed.value = !unlisten;
    }
    catch { if (!disposed) failed.value = true; }
    finally { draining = false; }
  }

  function start(): Promise<void> {
    if (disposed || !isTauri()) return Promise.resolve();
    if (starting) return starting;
    const task = (async () => {
      try {
        if (!unlisten) {
          const stop = await listen("open-files-available", () => { void drain(); });
          if (disposed) { stop(); return; }
          unlisten = stop;
        }
        // Listen first, then fetch: startup and warm requests share a queue.
        await drain();
      }
      catch { if (!disposed) failed.value = true; }
    })();
    starting = task;
    void task.finally(() => { if (starting === task) starting = null; });
    return task;
  }
  const focus = () => { void drain(); };
  onMounted(() => { window.addEventListener("focus", focus); void start(); });
  onScopeDispose(() => {
    disposed = true; unlisten?.(); unlisten = null;
    window.removeEventListener("focus", focus);
  });
  return { failed, retry: start };
}
