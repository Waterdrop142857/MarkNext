import { createApp, h, nextTick, ref } from "vue";
import CodeMirror from "codemirror";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SourceEditor from "../../SourceEditor.vue";
const cleanup: (() => void)[] = [];
beforeEach(() => {
  vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 10, 18));
  vi.spyOn(Range.prototype, "getClientRects").mockReturnValue([] as unknown as DOMRectList);
});
afterEach(() => { cleanup.splice(0).forEach(stop => stop()); document.body.replaceChildren(); vi.restoreAllMocks(); });
async function mount(text = "foo bar foo") {
  const value = ref(text), active = ref(true), generation = ref(0);
  const source = ref<InstanceType<typeof SourceEditor> | null>(null);
  const host = document.createElement("div"); document.body.appendChild(host);
  const app = createApp({ render: () => h(SourceEditor, { key: generation.value, ref: source, modelValue: value.value, active: active.value, "onUpdate:modelValue": (text: string) => { value.value = text; } }) });
  app.mount(host); cleanup.push(() => app.unmount()); await nextTick();
  const editor = () => (host.querySelector(".CodeMirror") as HTMLElement & { CodeMirror: CodeMirror.Editor }).CodeMirror;
  return { value, active, generation, source, editor };
}
describe("source search and history", () => {
  it("does not replace unrelated selection", async () => {
    const { source, editor } = await mount(); editor().setSelection({ line: 0, ch: 4 }, { line: 0, ch: 7 });
    expect(source.value!.replaceCurrent("foo", "X")).toBe(false); expect(source.value!.getValue()).toBe("foo bar foo");
  });
  it("replaces the valid current match and advances to the next", async () => {
    const { source, editor } = await mount(); source.value!.search("FOO");
    expect(source.value!.replaceCurrent("FOO", "X")).toBe(true); expect(source.value!.getValue()).toBe("X bar foo");
    expect(editor().getSelection()).toBe("foo"); expect(editor().getCursor("from").ch).toBe(6);
  });
  it("empty and missing queries cannot replace a selection", async () => {
    const { source, editor } = await mount(); editor().setSelection({ line: 0, ch: 0 }, { line: 0, ch: 3 });
    expect(source.value!.replaceCurrent("", "X")).toBe(false); expect(source.value!.replaceCurrent("missing", "X")).toBe(false);
    source.value!.replaceAll("", "X"); expect(source.value!.getValue()).toBe("foo bar foo");
  });
  it("search navigation is case insensitive, skips the selected match and wraps", async () => {
    const { source, editor } = await mount("Foo bar foo"); source.value!.search("foo"); expect(editor().getCursor("from").ch).toBe(0);
    source.value!.findNext("foo"); expect(editor().getCursor("from").ch).toBe(8);
    source.value!.findNext("foo"); expect(editor().getCursor("from").ch).toBe(0);
    source.value!.findPrev("foo"); expect(editor().getCursor("from").ch).toBe(8);
  });
  it("replace-all is literal and undoable as one operation", async () => {
    const { source } = await mount("Foo bar foo"); source.value!.replaceAll("foo", "$&"); expect(source.value!.getValue()).toBe("$& bar $&");
    source.value!.undo(); expect(source.value!.getValue()).toBe("Foo bar foo");
  });
  it("preserves the same editor and undo/redo across inactive sessions", async () => {
    const { source, editor, active } = await mount("original"); const original = editor(); source.value!.pasteText("edit "); await nextTick();
    active.value = false; await nextTick(); active.value = true; await nextTick();
    expect(editor()).toBe(original); source.value!.undo(); expect(source.value!.getValue()).toBe("original");
    source.value!.redo(); expect(source.value!.getValue()).toBe("edit original");
  });
  it("external WYSIWYG changes reset stale source history", async () => {
    const { source, value, active } = await mount("original"); source.value!.pasteText("edit "); await nextTick(); active.value = false; await nextTick();
    value.value = "different structure"; await nextTick(); active.value = true; await nextTick(); source.value!.undo();
    expect(source.value!.getValue()).toBe("different structure");
  });
  it("a different document generation cannot inherit previous undo history", async () => {
    const { source, value, generation } = await mount("original"); source.value!.pasteText("edit "); await nextTick();
    value.value = "new document"; generation.value++; await nextTick(); source.value!.undo(); expect(source.value!.getValue()).toBe("new document");
  });
});
