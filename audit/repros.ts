// Historical audit inputs, now asserting the repaired P1/P2 behavior.
// Full acceptance coverage is maintained under src and tests/e2e.
// Run: pnpm exec vitest run --config audit/vitest.config.ts
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import CodeMirror from "codemirror";
import SourceEditor from "../src/components/SourceEditor.vue";
import { Muya } from "../src/muya";
import DiagramPreview from "../src/muya/block/extra/diagram/diagramPreview";
import { getImageSrc } from "../src/muya/utils/image";
import { resolveLocalImagePath } from "../src/services/documentImages";
import { useWorkspace } from "../src/composables/useWorkspace";
import { useDocumentActions } from "../src/composables/useDocumentActions";

const native = vi.hoisted(() => ({ invoke: vi.fn(), message: vi.fn() }));
const renderer = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../src/muya/utils/diagram", () => ({ default: renderer.load }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: async () => "/new.md", save: async () => "/saved.md", message: native.message,
}));

const cleanups: (() => void)[] = [];
beforeEach(() => {
  window.MUYA_VERSION = "audit";
  native.invoke.mockReset();
  renderer.load.mockReset();
  native.message.mockReset().mockResolvedValue("不保存");
});
afterEach(() => {
  cleanups.splice(0).reverse().forEach(cleanup => cleanup());
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (window as Partial<Window>).MUYA_VERSION;
  delete (window as Partial<Window>).DIRNAME;
});

function boot(markdown: string) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Muya(host, { markdown });
  editor.init();
  cleanups.push(() => editor.destroy());
  return editor;
}

it("protects queued Muya edits while another file is read", async () => {
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const editor = boot("original");
  const workspace = useWorkspace();
  workspace.currentFilePath.value = "/old.md";
  workspace.markdown.value = workspace.savedMarkdown.value = editor.getMarkdown();
  editor.on("json-change", () => { workspace.markdown.value = editor.getMarkdown(); });
  const flush = vi.fn(() => editor.flush());
  const actions = useDocumentActions(workspace, { flushEditor: flush, closeWindow: async () => {} });
  let completeRead!: (content: string) => void;
  let readStarted!: () => void;
  const ready = new Promise<void>(resolve => { readStarted = resolve; });
  native.invoke.mockImplementation(() => {
    readStarted();
    return new Promise<string>(resolve => { completeRead = resolve; });
  });
  const opening = actions.run("open");
  await ready;
  editor.editor.scrollPage!.firstContentInDescendant().text = "last unsaved keystroke";
  expect(workspace.dirty.value).toBe(false); // edit is still in the RAF queue
  completeRead("replacement document");
  expect(await opening).toBe(true);
  expect(flush.mock.calls.length).toBeGreaterThan(1);
  expect(native.message).toHaveBeenCalledTimes(1);
  expect(workspace.markdown.value).toBe("replacement document");
});

it("clearing the query invalidates old matches", () => {
  const editor = boot("foo bar foo");
  editor.search("foo");
  editor.search("");
  editor.replace("X", { isSingle: false, isRegexp: false });
  editor.flush();
  expect(editor.getMarkdown().trim()).toBe("foo bar foo");
});

it("removes viewport-covering inline styles from HTML preview", () => {
  const editor = boot('<div><p style="position:fixed;inset:0;z-index:999999">overlay</p></div>\n\nafter');
  const preview = editor.domNode.querySelector(".mu-html-preview")!;
  expect(preview.querySelector("p")?.style.position).toBe("");
  expect(preview.querySelector("p")?.getAttribute("style") ?? "").not.toContain("inset");
  expect(preview.querySelector("p")?.style.zIndex).toBe("");
});

it("prevents uppercase STYLE from changing the application", () => {
  const shell = document.createElement("div");
  shell.className = "app-shell";
  document.body.appendChild(shell);
  const editor = boot('<div><STYLE>.app-shell { display: none !important }</STYLE><p>content</p></div>\n\nafter');
  const preview = editor.domNode.querySelector(".mu-html-preview")!;
  expect(preview.querySelector("style")).toBeNull();
  expect(getComputedStyle(shell).display).not.toBe("none");
});

it("resolves relative images using explicit document context", () => {
  expect(window.DIRNAME).toBeUndefined();
  const resolver = (source: string) => `asset://localhost/${encodeURIComponent(resolveLocalImagePath(source, "/docs/note.md")!)}`;
  expect(getImageSrc("images/picture.png", resolver).src).toBe("asset://localhost/%2Fdocs%2Fimages%2Fpicture.png");
});

it("SourceEditor rejects replacement of an unrelated selection", async () => {
  vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 10, 18));
  vi.spyOn(Range.prototype, "getClientRects").mockReturnValue([] as unknown as DOMRectList);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const source = ref<InstanceType<typeof SourceEditor> | null>(null);
  const app = createApp({ render: () => h(SourceEditor, { ref: source, modelValue: "foo bar" }) });
  app.mount(container);
  cleanups.push(() => app.unmount());
  await nextTick();
  const cm = (container.querySelector(".CodeMirror") as HTMLElement & { CodeMirror: CodeMirror.Editor }).CodeMirror;
  cm.setSelection(CodeMirror.Pos(0, 4), CodeMirror.Pos(0, 7));
  source.value!.replaceCurrent("foo", "X");
  expect(source.value!.getValue()).toBe("foo bar");
});

it("SourceEditor retains undo history across active/inactive sessions", async () => {
  vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 10, 18));
  vi.spyOn(Range.prototype, "getClientRects").mockReturnValue([] as unknown as DOMRectList);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const source = ref<InstanceType<typeof SourceEditor> | null>(null);
  const value = ref("original");
  const shown = ref(true);
  const app = createApp({ render: () => h(SourceEditor, {
    ref: source, modelValue: value.value, active: shown.value, "onUpdate:modelValue": (text: string) => { value.value = text; },
  }) });
  app.mount(container);
  cleanups.push(() => app.unmount());
  await nextTick();
  source.value!.pasteText("change ");
  await nextTick();
  const edited = source.value!.getValue();
  expect(edited).not.toBe("original");
  const cm = (container.querySelector(".CodeMirror") as HTMLElement & { CodeMirror: CodeMirror.Editor }).CodeMirror;
  expect(cm.historySize().undo).toBeGreaterThan(0);
  shown.value = false;
  await nextTick();
  shown.value = true;
  await nextTick();
  source.value!.undo();
  expect(source.value!.getValue()).toBe("original");
});

it("an older async diagram update cannot overwrite a newer preview", async () => {
  const editor = boot("host");
  const preview = new DiagramPreview(editor, { name: "diagram", text: "", meta: { lang: "flowchart", type: "flowchart" } });
  editor.domNode.appendChild(preview.domNode!);
  const render = { parse: (code: string) => ({ drawSVG: (target: HTMLElement) => {
    target.innerHTML = `<svg width="10" height="10"><text>${code}</text></svg>`;
  } }) };
  let releaseOld!: (value: typeof render) => void;
  renderer.load.mockImplementationOnce(() => new Promise(resolve => { releaseOld = resolve; }));
  renderer.load.mockResolvedValue(render);
  const oldUpdate = preview.update("old");
  await preview.update("new");
  expect(preview.domNode!.textContent).toBe("new");
  releaseOld(render);
  await oldUpdate;
  expect(preview.domNode!.textContent).toBe("new");
});
