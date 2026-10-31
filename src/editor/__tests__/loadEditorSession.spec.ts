import { defineComponent } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditorSessionLoader, scheduleEditorWarmup } from "../loadEditorSession";

const component = defineComponent({ render: () => null });

describe("editor module loading", () => {
  it("shares a pending warmup with activation and reuses the loaded module", async () => {
    let resolve!: (value: typeof component) => void;
    const importer = vi.fn(() => new Promise<typeof component>(done => { resolve = done; }));
    const load = createEditorSessionLoader(importer);
    const warmup = load();
    const activation = load();
    expect(activation).toBe(warmup);
    resolve(component);
    expect(await activation).toBe(component);
    expect(await load()).toBe(component);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it("calls the importer again after a rejected load", async () => {
    const importer = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(component);
    const load = createEditorSessionLoader(importer);
    await expect(load()).rejects.toThrow("unavailable");
    expect(await load()).toBe(component);
    expect(importer).toHaveBeenCalledTimes(2);
  });
});

describe("idle editor warmup", () => {
  let idleCallback: IdleRequestCallback;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    vi.stubGlobal("requestIdleCallback", vi.fn((callback: IdleRequestCallback) => { idleCallback = callback; return 7; }));
    vi.stubGlobal("cancelIdleCallback", vi.fn());
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("waits for a painted frame and idle time before importing", async () => {
    const load = vi.fn().mockResolvedValue(component);
    scheduleEditorWarmup(load);
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(17);
    expect(window.requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 1000 });
    expect(load).not.toHaveBeenCalled();
    idleCallback({ didTimeout: false, timeRemaining: () => 30 });
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("uses a deferred fallback when requestIdleCallback is unavailable", async () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    const load = vi.fn().mockResolvedValue(component);
    scheduleEditorWarmup(load);
    await vi.advanceTimersByTimeAsync(200);
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("can cancel before the first frame or after scheduling idle work", async () => {
    const load = vi.fn().mockResolvedValue(component);
    scheduleEditorWarmup(load)();
    await vi.advanceTimersByTimeAsync(17);
    expect(window.requestIdleCallback).not.toHaveBeenCalled();
    const cancel = scheduleEditorWarmup(load);
    await vi.advanceTimersByTimeAsync(17);
    cancel();
    expect(window.cancelIdleCallback).toHaveBeenCalledWith(7);
    idleCallback({ didTimeout: true, timeRemaining: () => 0 });
    expect(load).not.toHaveBeenCalled();
  });

  it("contains background failures so a failed warmup does not break startup", async () => {
    const load = vi.fn().mockRejectedValue(new Error("unavailable"));
    scheduleEditorWarmup(load);
    await vi.advanceTimersByTimeAsync(17);
    idleCallback({ didTimeout: false, timeRemaining: () => 30 });
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
