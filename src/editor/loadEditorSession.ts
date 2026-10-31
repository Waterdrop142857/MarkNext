export function createEditorSessionLoader<T>(importSession: () => Promise<T>) {
  let loading: Promise<T> | null = null;
  return () => loading ??= importSession().catch(error => {
    loading = null;
    throw error;
  });
}

// Warmup and document activation share one import, without mounting a renderer.
export const loadEditorSession = createEditorSessionLoader(
  () => import("../components/EditorSession.vue").then(module => module.default),
);

/** Start only after the revealed application has had a chance to paint. */
export function scheduleEditorWarmup(load: () => Promise<unknown> = loadEditorSession): () => void {
  let cancelled = false;
  let timer: number | undefined;
  let idle: number | undefined;
  const warmup = () => {
    if (!cancelled) void load().catch(() => { /* Demand loading reports errors; warmup must not break startup. */ });
  };
  const frame = window.requestAnimationFrame(() => {
    // A task after rAF lets the browser paint before evaluating editor modules.
    timer = window.setTimeout(() => {
      if (cancelled) return;
      if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(warmup, { timeout: 1000 });
      else timer = window.setTimeout(warmup, 200);
    }, 0);
  });
  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frame);
    if (timer !== undefined) window.clearTimeout(timer);
    if (idle !== undefined) window.cancelIdleCallback(idle);
  };
}
