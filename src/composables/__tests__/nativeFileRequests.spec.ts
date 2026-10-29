import { createApp, h, nextTick } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useNativeFileRequests } from "../useNativeFileRequests";

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), isTauri: vi.fn(), stop: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: native.isTauri }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
const cleanups: (() => void)[] = [];
let queue: { id: number; paths: string[] }[] = [];
let notify: () => void;
beforeEach(() => {
  vi.clearAllMocks(); queue = []; notify = () => {};
  native.isTauri.mockReturnValue(true);
  native.listen.mockImplementation(async (_event, callback) => { notify = callback; return native.stop; });
  native.invoke.mockImplementation(async (command, args) => {
    if (command === "pending_open_requests") return structuredClone(queue);
    if (command === "acknowledge_open_request") { queue = queue.filter(request => request.id !== args.id); return; }
    throw new Error(`Unexpected command ${command}`);
  });
});
afterEach(() => cleanups.splice(0).forEach(stop => stop()));
function mount(handler = vi.fn(async (_paths: readonly string[]) => true)) {
  let receiver!: ReturnType<typeof useNativeFileRequests>;
  const root = document.createElement("div"); document.body.appendChild(root);
  const app = createApp({ setup() { receiver = useNativeFileRequests(handler); return () => h("div"); } });
  app.mount(root);
  cleanups.push(() => { app.unmount(); root.remove(); });
  return { receiver, handler, unmount: () => app.unmount() };
}

it("registers before fetching cold-start requests and acknowledges only after handling", async () => {
  queue.push({ id: 1, paths: ["/cold.md"] });
  const { handler } = mount();
  await vi.waitFor(() => expect(queue).toEqual([]));
  expect(handler).toHaveBeenCalledWith(["/cold.md"]);
  expect(native.listen.mock.invocationCallOrder[0]).toBeLessThan(native.invoke.mock.invocationCallOrder[0]);
  expect(handler.mock.invocationCallOrder[0]).toBeLessThan(native.invoke.mock.invocationCallOrder.at(-1)!);
});

it("coalesces warm notifications while a document operation is waiting", async () => {
  queue.push({ id: 1, paths: ["/first.md"] });
  let finish!: () => void;
  const handler = vi.fn<(paths: readonly string[]) => Promise<boolean>>()
    .mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(true); })).mockResolvedValue(true);
  mount(handler);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  queue.push({ id: 2, paths: ["/second.md"] }); notify(); notify();
  finish(); await vi.waitFor(() => expect(queue).toEqual([]));
  expect(handler.mock.calls.map(([paths]) => paths)).toEqual([["/first.md"], ["/second.md"]]);
  expect(native.invoke.mock.calls.filter(([command]) => command === "acknowledge_open_request").map(([, args]) => args.id)).toEqual([1, 2]);
});

it("keeps pending requests after UI teardown and unregisters its listener", async () => {
  queue.push({ id: 1, paths: ["/pending.md"] });
  let finish!: () => void;
  const { unmount } = mount(vi.fn(() => new Promise(resolve => { finish = () => resolve(true); })));
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  unmount(); finish(); await nextTick(); await Promise.resolve();
  expect(queue).toHaveLength(1); expect(native.stop).toHaveBeenCalledTimes(1);
  expect(native.invoke.mock.calls.some(([command]) => command === "acknowledge_open_request")).toBe(false);
});

it("leaves requests available on acknowledgement failure and retry does not add another listener", async () => {
  queue.push({ id: 1, paths: ["/retry.md"] });
  const implementation = native.invoke.getMockImplementation()!;
  let fail = true;
  native.invoke.mockImplementation((command, args) => command === "acknowledge_open_request" && fail ? Promise.reject(new Error("temporary")) : implementation(command, args));
  const { receiver } = mount();
  await vi.waitFor(() => expect(receiver.failed.value).toBe(true)); expect(queue).toHaveLength(1);
  fail = false; await receiver.retry();
  expect(queue).toEqual([]); expect(receiver.failed.value).toBe(false); expect(native.listen).toHaveBeenCalledTimes(1);
});

it("handles a reported file failure once and keeps the rest of the queue moving", async () => {
  queue.push({ id: 1, paths: ["/missing.md"] }, { id: 2, paths: ["/good.md"] });
  const handler = vi.fn<(paths: readonly string[]) => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValue(true);
  mount(handler); await vi.waitFor(() => expect(queue).toEqual([])); expect(handler).toHaveBeenCalledTimes(2);
});

it("does not invoke native APIs in a plain browser", async () => {
  native.isTauri.mockReturnValue(false); mount(); await nextTick();
  expect(native.listen).not.toHaveBeenCalled(); expect(native.invoke).not.toHaveBeenCalled();
});
