// Real editor components, no test hooks in the production application.
import { computed, createApp, h, nextTick, ref, shallowRef, watch } from "vue";
import type CodeMirror from "codemirror";
import EditorSession from "../../src/components/EditorSession.vue";
import { Muya } from "../../src/muya";
import type { EditorSessionCheckpoint } from "../../src/editor/sessionTypes";
import "../../src/styles.css";
import "../../src/styles/ui-controls.css";
import "../../src/styles/app.css";
import "../../src/styles/muya-editor.css";
import "../../src/styles/source-editor.css";

const markdown = ref("# Heading\n\nBody"), sourceMode = ref(false), revision = ref(0), mounted = ref(true);
const checkpoint = shallowRef<EditorSessionCheckpoint | null>(null);
const session = ref<InstanceType<typeof EditorSession> | null>(null);
const identity = computed(() => ({ documentId: "fixture-doc", revision: revision.value }));
const errors: string[] = [];
watch(markdown, () => { revision.value++; }, { flush: "sync" });
let saved: EditorSessionCheckpoint | null = null;
const engines: Muya[] = [];
const originalInit = Muya.prototype.init;
Muya.prototype.init = function () { engines.push(this); return originalInit.call(this); };
const activeEditor = () => [...engines].reverse().find(editor => editor.domNode.isConnected) ?? null;
let oldEditor: Muya | null = null;

const fixture = {
  async suspend() {
    oldEditor = activeEditor();
    saved = await session.value!.suspend();
    return saved !== null;
  },
  resume: () => session.value!.resume(),
  toggle: () => session.value!.toggleMode(),
  undo: () => session.value!.undo(),
  redo: () => session.value!.redo(),
  async recreate() {
    if (!saved) throw new Error("Capture before recreating");
    mounted.value = false; await nextTick();
    checkpoint.value = JSON.parse(JSON.stringify(saved)) as EditorSessionCheckpoint;
    mounted.value = true; await nextTick();
  },
  async replace(text: string) {
    activeEditor()!.replaceContent(text); session.value!.flush(); await nextTick();
  },
  state: () => ({ markdown: markdown.value, sourceMode: sourceMode.value, revision: revision.value, errors,
    oldEvents: oldEditor?.eventCenter.events.length ?? 0, oldListeners: Object.keys(oldEditor?.eventCenter.listeners ?? {}).length,
    checkpoint: saved }),
  source: () => (document.querySelector(".CodeMirror") as HTMLElement & { CodeMirror: CodeMirror.Editor }).CodeMirror,
};
declare global { interface Window { editorSessionFixture: typeof fixture } }
window.editorSessionFixture = fixture;
createApp({ render: () => h("div", { class: "app-shell" }, [
  h("header", { style: "height:40px;flex-shrink:0" }, "Editor lifecycle fixture"),
  h("main", { class: ["editor-area", { "source-mode": sourceMode.value }] }, mounted.value ? [h(EditorSession, {
    ref: session, modelValue: markdown.value, sourceMode: sourceMode.value, identity: identity.value,
    documentPath: null, options: {}, checkpoint: checkpoint.value,
    "onUpdate:modelValue": (value: string) => { markdown.value = value; },
    "onUpdate:sourceMode": (value: boolean) => { sourceMode.value = value; },
    onError: (error: unknown) => errors.push(String(error)),
  })] : []),
]) }).mount("#app");
