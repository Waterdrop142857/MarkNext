import { computed, createApp, h, nextTick, ref, watch } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type CodeMirror from "codemirror";
import type { IMuyaOptions } from "../../muya/types";
import EditorSession from "../../components/EditorSession.vue";
import type { EditorSessionCheckpoint } from "../sessionTypes";

const cleanup: (() => void)[] = [];
beforeEach(() => {
  vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 10, 18));
  vi.spyOn(Range.prototype, "getClientRects").mockReturnValue([] as unknown as DOMRectList);
});
afterEach(() => { cleanup.splice(0).reverse().forEach(stop => stop()); document.body.replaceChildren(); vi.restoreAllMocks(); });

async function mount(text = "original", checkpoint?: EditorSessionCheckpoint, options: Partial<IMuyaOptions> = {}) {
  const markdown = ref(text), sourceMode = ref(false), revision = ref(checkpoint?.active.revision ?? 0);
  const stop = watch(markdown, () => { revision.value++; }, { flush: "sync" });
  const identity = computed(() => ({ documentId: "doc-a", revision: revision.value }));
  const session = ref<InstanceType<typeof EditorSession> | null>(null);
  const errors: unknown[] = [];
  const host = document.createElement("main"); document.body.appendChild(host);
  const app = createApp({ render: () => h(EditorSession, {
    ref: session, modelValue: markdown.value, sourceMode: sourceMode.value, identity: identity.value, documentPath: null, options, checkpoint,
    "onUpdate:modelValue": value => { markdown.value = value; },
    "onUpdate:sourceMode": value => { sourceMode.value = value; }, onError: error => errors.push(error),
  }) });
  app.mount(host); await nextTick();
  cleanup.push(() => { app.unmount(); stop(); expect(errors).toEqual([]); });
  const source = () => (host.querySelector(".CodeMirror") as HTMLElement & { CodeMirror: CodeMirror.Editor }).CodeMirror;
  return { session, markdown, sourceMode, revision, host, source, unmount: () => app.unmount() };
}

describe("editor session lifecycle", () => {
  it("destroys and reconstructs a WYSIWYG renderer with pending edits and both history stacks", async () => {
    const { session, markdown, host } = await mount("start");
    const editor = session.value!.getMuya()!;
    editor.replaceContent("# Edited\n\n- item"); editor.flush(); await nextTick();
    editor.replaceContent("final"); editor.flush(); await nextTick();
    session.value!.undo(); await nextTick();
    const content = markdown.value;
    const expected = editor.getState(), history = editor.getHistory();
    const snapshot = await session.value!.suspend();
    expect(snapshot?.mode).toBe("wysiwyg"); expect(host.querySelector(".mu-editor")).toBeNull();
    expect(editor.eventCenter.events).toHaveLength(0);
    const resuming = session.value!.resume();
    await nextTick(); expect(session.value!.undo()).toBe(false);
    expect(await resuming).toBe(true);
    const restored = session.value!.getMuya()!;
    expect(restored).not.toBe(editor); expect(restored.getState()).toEqual(expected);
    expect(restored.getHistory().stack).toEqual(history.stack);
    expect(markdown.value).toBe(content);
    session.value!.redo(); await nextTick(); expect(markdown.value.trim()).toBe("final");
    session.value!.undo(); session.value!.undo(); await nextTick(); expect(markdown.value.trim()).toBe("start");
  });

  it("suspends source mode with its bridge and commits it as one Muya step after reconstruction", async () => {
    const { session, sourceMode, source, markdown, host } = await mount("start");
    session.value!.getMuya()!.replaceContent("before source"); session.value!.flush(); await nextTick();
    expect(await session.value!.toggleMode()).toBe(true);
    source().replaceRange(" source one", { line: 0, ch: source().getLine(0).length });
    source().getDoc().changeGeneration(true);
    source().replaceRange(" source two", { line: 0, ch: source().getLine(0).length }); await nextTick();
    const value = source().getValue();
    const snapshot = await session.value!.suspend();
    expect(snapshot?.mode).toBe("source"); expect(host.querySelector(".CodeMirror")).toBeNull();
    expect(await session.value!.resume()).toBe(true);
    expect(sourceMode.value).toBe(true); expect(source().getValue()).toBe(value);
    expect(host.querySelector(".mu-editor")).toBeNull();
    session.value!.undo(); await nextTick(); expect(source().getValue()).not.toContain("source two");
    session.value!.redo(); await nextTick(); expect(source().getValue()).toBe(value);
    expect(await session.value!.toggleMode()).toBe(true);
    session.value!.undo(); await nextTick(); expect(markdown.value.trim()).toBe("before source");
    session.value!.undo(); await nextTick(); expect(markdown.value.trim()).toBe("start");
  });

  it("keeps cached source undo when text matches after a WYSIWYG suspension", async () => {
    const { session, source } = await mount("start");
    await session.value!.toggleMode(); source().replaceRange("edited ", { line: 0, ch: 0 }); await nextTick();
    await session.value!.toggleMode(); await session.value!.suspend(); await session.value!.resume();
    await session.value!.toggleMode(); session.value!.undo(); await nextTick();
    expect(source().getValue().trim()).toBe("start");
  });

  it.each([false, true])("restores a portable checkpoint after the whole session component is destroyed: source=%s", async sourceMode => {
    const first = await mount("start");
    first.session.value!.getMuya()!.replaceContent("before source"); first.session.value!.flush(); await nextTick();
    if (sourceMode) {
      await first.session.value!.toggleMode(); first.source().replaceRange("source ", { line: 0, ch: 0 }); await nextTick();
    }
    const snapshot = await first.session.value!.suspend();
    const text = first.markdown.value;
    first.unmount();
    const second = await mount(text, JSON.parse(JSON.stringify(snapshot)) as EditorSessionCheckpoint);
    await vi.waitFor(() => expect(second.host.querySelector(sourceMode ? ".CodeMirror" : ".mu-editor")).not.toBeNull());
    expect(await second.session.value!.resume()).toBe(true);
    expect(second.sourceMode.value).toBe(sourceMode);
    expect(second.markdown.value).toBe(text);
    second.session.value!.undo(); await nextTick();
    expect(second.markdown.value.trim()).toBe(sourceMode ? "before source" : "start");
  });

  it("keeps document content authoritative when generic options contain a different document", async () => {
    const first = await mount("start");
    first.session.value!.getMuya()!.replaceContent("edited"); first.session.value!.flush(); await nextTick();
    const checkpoint = await first.session.value!.suspend();
    first.unmount();
    const second = await mount("edited", checkpoint!, { markdown: "wrong", json: [{ name: "paragraph", text: "wrong" }] });
    await vi.waitFor(() => expect(second.session.value!.getMuya()?.getMarkdown().trim()).toBe("edited"));
    expect(await second.session.value!.resume()).toBe(true);
    second.session.value!.undo(); await nextTick(); expect(second.markdown.value.trim()).toBe("start");
  });

  it("waits for composition and serializes rapid mode requests without adding an empty source commit", async () => {
    const { session, sourceMode, host } = await mount("start");
    const root = host.querySelector(".mu-editor")!;
    root.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    let finished = false;
    const switching = session.value!.toggleMode().then(value => { finished = true; return value; });
    await nextTick(); expect(finished).toBe(false);
    root.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    expect(await switching).toBe(true);
    expect(await session.value!.toggleMode()).toBe(true);
    const before = session.value!.getMuya()!.getHistory().stack;
    expect(await Promise.all([session.value!.toggleMode(), session.value!.toggleMode()])).toEqual([true, true]);
    expect(sourceMode.value).toBe(false); expect(session.value!.getMuya()!.getHistory().stack).toEqual(before);
  });

  it("waits for asynchronous document edits before committing a checkpoint", async () => {
    const { session, markdown } = await mount("start");
    const editor = session.value!.getMuya()!;
    let finish!: () => void;
    const task = editor.trackTask(async () => {
      await new Promise<void>(resolve => { finish = resolve; });
      editor.replaceContent("async edit arrived"); editor.flush();
    });
    let done = false;
    const suspension = session.value!.suspend().then(value => { done = true; return value; });
    await nextTick(); expect(done).toBe(false);
    finish(); await task;
    expect((await suspension)?.active.markdown.trim()).toBe("async edit arrived");
    await session.value!.resume(); expect(markdown.value.trim()).toBe("async edit arrived");
  });

  it("rejects stale suspended revisions and cancels queued composition work on disposal", async () => {
    const { session, markdown, host, unmount } = await mount("start");
    await session.value!.suspend(); markdown.value = "external change"; await nextTick();
    expect(await session.value!.resume()).toBe(false); expect(host.querySelector(".mu-editor")).toBeNull();
    // A separately mounted session proves unmount cancels an IME wait.
    const second = await mount("second");
    second.host.querySelector(".mu-editor")!.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const work = second.session.value!.suspend(); await nextTick(); second.unmount();
    expect(await work).toBeNull(); unmount();
  });
});
