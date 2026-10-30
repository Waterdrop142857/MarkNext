import { createApp, defineComponent, h, nextTick } from "vue";
import { expect, it, vi } from "vitest";
import { useDocumentMonitoring } from "../useDocumentMonitoring";

it("serializes disk checks and removes window listeners and its timer on unmount", async () => {
  vi.useFakeTimers();
  let finish!: (changed: boolean) => void;
  const check = vi.fn().mockReturnValue(new Promise<boolean>(resolve => { finish = resolve; }));
  const flush = vi.fn();
  const review = vi.fn().mockResolvedValue(undefined);
  const backup = vi.fn().mockResolvedValue(true);
  const target = document.createElement("div"); document.body.appendChild(target);
  const app = createApp(defineComponent({ setup() {
    useDocumentMonitoring({ busy: () => false, flushEditor: flush, checkExternalChange: check,
      canReview: () => true, reviewExternalChange: review, flushRecovery: backup });
    return () => h("div");
  } }));
  try {
    app.mount(target);
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(check).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledOnce();
    finish(true); await nextTick(); await Promise.resolve();
    expect(review).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event("blur"));
    expect(backup).toHaveBeenCalledOnce();
    app.unmount();
    window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(check).toHaveBeenCalledOnce();
    expect(backup).toHaveBeenCalledOnce();
  } finally { app.unmount(); target.remove(); vi.useRealTimers(); }
});
