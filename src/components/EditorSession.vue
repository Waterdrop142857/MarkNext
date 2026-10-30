<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import MuyaEditor from "./MuyaEditor.vue";
import SourceEditor from "./SourceEditor.vue";
import "../styles/muya-editor.css";
import "../styles/source-editor.css";
import type { Muya } from "../muya";
import type { EditorAppearance, EditorEvent } from "../editor/editorPort";
import type { IHistorySelection } from "../muya/selection/types";
import type { DocumentRevision, EditorSessionCheckpoint, MuyaCheckpoint, SourceCheckpoint } from "../editor/sessionTypes";
import { cloneData, decodeSessionCheckpoint, freezeData, matchesRevision } from "../editor/checkpointCodec";
import { readClipboardData } from "../services/clipboard";
import { createMuyaCommands } from "../editor/muyaCommands";
import { createSourceCommands } from "../editor/sourceCommands";
import type { RecoveryView } from "../document/types";
import type { OutlineHeading } from "../services/documentAnalysis";

const props = defineProps<{
  modelValue: string;
  sourceMode: boolean;
  identity: DocumentRevision;
  generation: number;
  documentPath: string | null;
  options: Partial<EditorAppearance>;
  checkpoint?: EditorSessionCheckpoint | null;
}>();
const emit = defineEmits<{
  (event: "document-change", value: EditorEvent<string>): void;
  (event: "mode-change", value: EditorEvent<boolean>): void;
  (event: "ready", value: EditorEvent<boolean>): void;
  (event: "availability", value: EditorEvent<boolean>): void;
  (event: "selection-change", value: EditorEvent<boolean>): void;
  (event: "error", error: unknown): void;
}>();

const muyaRef = ref<InstanceType<typeof MuyaEditor> | null>(null);
const sourceRef = ref<InstanceType<typeof SourceEditor> | null>(null);
const muya = shallowRef<Muya | null>(null);
const muyaMounted = ref(!props.checkpoint);
const sourceMounted = ref(!props.checkpoint && props.sourceMode);
const muyaCheckpoint = shallowRef<MuyaCheckpoint | null>(null);
const sourceCheckpoint = shallowRef<SourceCheckpoint | null>(null);
const suspended = shallowRef<EditorSessionCheckpoint | null>(props.checkpoint ?? null);
const activation = ref(0);
const lease = computed(() => ({ documentId: props.identity.documentId, activation: activation.value }));
let bridge: MuyaCheckpoint | null = null;
let sourceTextAtEntry = props.modelValue;
let disposed = false;
const composing = ref(false);
let restoreError: unknown = null;
let compositionTimer: ReturnType<typeof setTimeout> | undefined;
let queue: Promise<unknown> = Promise.resolve();
const transitioning = ref(false);
const waiting = new Set<(ready: boolean) => void>();
const taskWaiting = new Set<(ready: boolean) => void>();

function editorEvent<T>(value: T): EditorEvent<T> {
  return { documentId: props.identity.documentId, generation: props.generation, value };
}
function onReady(value: Muya) { muya.value = value; }
const ready = computed(() => !suspended.value && (props.sourceMode ? !!sourceRef.value : !!muya.value));
const available = computed(() => ready.value && !composing.value && !transitioning.value);
watch(ready, value => emit("ready", editorEvent(value)), { immediate: true });
watch(available, value => emit("availability", editorEvent(value)), { immediate: true });
function failed(error: unknown) { restoreError = error; emit("error", error); }
function compositionStart() { composing.value = true; }
function compositionEnd() {
  composing.value = false;
  // compositionend may precede the final input event. Yield one task before
  // flushing, without inventing a composition event or losing IME text.
  clearTimeout(compositionTimer);
  compositionTimer = setTimeout(() => {
    if (composing.value) return;
    for (const resolve of waiting) resolve(!disposed);
    waiting.clear();
  }, 0);
}

function serialize<T>(operation: () => Promise<T>, cancelled: T): Promise<T> {
  const task = queue.then(async () => {
    if (disposed) return cancelled;
    if (composing.value && !(await new Promise<boolean>(resolve => waiting.add(resolve)))) return cancelled;
    const editor = muya.value;
    if (editor?.busy && !(await new Promise<boolean>(resolve => {
      const finish = (ready: boolean) => { editor.off("async-idle", idle); taskWaiting.delete(finish); resolve(ready); };
      const idle = () => finish(true);
      taskWaiting.add(finish); editor.on("async-idle", idle);
      if (!editor.busy) finish(true);
    }))) return cancelled;
    if (disposed) return cancelled;
    transitioning.value = true;
    try { return await operation(); }
    finally { transitioning.value = false; }
  });
  queue = task.catch(() => undefined);
  return task;
}

function flush() { if (!props.sourceMode) muyaRef.value?.getHistoryAdapter()?.flush(); }

async function captureMuya() {
  muyaRef.value?.getHistoryAdapter()?.flush();
  await nextTick();
  if (disposed) return null;
  const result = muyaRef.value?.getHistoryAdapter()?.capture(props.identity);
  return result?.ok ? result.checkpoint : null;
}
async function captureSource() {
  await nextTick();
  if (disposed) return null;
  const result = sourceRef.value?.getHistoryAdapter()?.capture(props.identity);
  return result?.ok ? result.checkpoint : null;
}

async function checkpoint(): Promise<EditorSessionCheckpoint | null> {
  if (suspended.value) return suspended.value;
  if (props.sourceMode) {
    const source = await captureSource();
    // A file loaded/restored directly in source mode has no earlier source
    // session. Its still-live Muya instance supplies the initial boundary.
    const baseline = bridge ?? await captureMuya();
    if (!source || !baseline) return null;
    bridge = baseline;
    return freezeData({ version: 1, mode: "source", active: source, bridge: { muyaAtEntry: baseline, sourceTextAtEntry } } as const);
  }
  const active = await captureMuya();
  if (!active) return null;
  const cachedSource = sourceRef.value?.getHistoryAdapter()?.capture(props.identity);
  return freezeData({ version: 1, mode: "wysiwyg", active, cachedSource: cachedSource?.ok ? cachedSource.checkpoint : null } as const);
}

async function suspend(): Promise<EditorSessionCheckpoint | null> {
  return serialize(async () => {
    const snapshot = await checkpoint();
    if (!snapshot || disposed || !matchesRevision(snapshot.active, props.identity)) return null;
    suspended.value = snapshot; // Commit detached data BEFORE invalidating views.
    muyaRef.value?.getHistoryAdapter()?.destroy();
    sourceRef.value?.getHistoryAdapter()?.destroy();
    activation.value++;
    muya.value = null;
    muyaMounted.value = sourceMounted.value = false;
    muyaCheckpoint.value = sourceCheckpoint.value = null;
    await nextTick();
    return snapshot;
  }, null);
}

async function resume(): Promise<boolean> {
  return serialize(async () => {
    if (!suspended.value) return true;
    let snapshot: EditorSessionCheckpoint;
    try { snapshot = decodeSessionCheckpoint(suspended.value); }
    catch (error) { failed(error); return false; }
    if (!matchesRevision(snapshot.active, props.identity)) return false;
    restoreError = null;
    activation.value++;
    emit("mode-change", editorEvent(snapshot.mode === "source"));
    if (snapshot.mode === "source") {
      bridge = snapshot.bridge.muyaAtEntry;
      sourceTextAtEntry = snapshot.bridge.sourceTextAtEntry;
      sourceCheckpoint.value = snapshot.active;
      sourceMounted.value = true; // No hidden Muya renderer is needed here.
    }
    else {
      muyaCheckpoint.value = snapshot.active;
      muyaMounted.value = true;
    }
    await nextTick();
    if (disposed || restoreError || !matchesRevision(snapshot.active, props.identity)) {
      muyaRef.value?.getHistoryAdapter()?.destroy();
      sourceRef.value?.getHistoryAdapter()?.destroy();
      muya.value = null;
      muyaMounted.value = sourceMounted.value = false;
      await nextTick();
      return false; // The checkpoint remains available for retry.
    }
    if (snapshot.mode === "wysiwyg") sourceCheckpoint.value = snapshot.cachedSource;
    suspended.value = null;
    await nextTick();
    return true;
  }, false);
}

async function toggleMode(): Promise<boolean> {
  return serialize(async () => {
    if (suspended.value) return false;
    if (!props.sourceMode) {
      restoreError = null;
      const baseline = await captureMuya();
      if (!baseline) return false;
      bridge = baseline;
      sourceTextAtEntry = props.modelValue;
      if (!sourceMounted.value) {
        const cache = sourceCheckpoint.value;
        sourceCheckpoint.value = cache?.documentId === props.identity.documentId && cache.markdown === props.modelValue
          ? { ...cache, ...props.identity } : null;
        sourceMounted.value = true;
      }
      await nextTick();
      if (disposed || restoreError) {
        sourceMounted.value = false;
        bridge = null;
        return false;
      }
      emit("mode-change", editorEvent(true));
      await nextTick();
      if (disposed) return false;
      sourceRef.value?.focus();
      return true;
    }

    if (!muya.value) {
      if (!bridge) return false;
      restoreError = null;
      muyaCheckpoint.value = bridge;
      muyaMounted.value = true;
      await nextTick();
      if (disposed || restoreError || !muya.value) {
        muyaMounted.value = false;
        return false;
      }
    }
    const editor = muya.value;
    if (props.modelValue !== sourceTextAtEntry) {
      try {
        editor.replaceContent(props.modelValue, bridge?.selection ? cloneData<IHistorySelection>(bridge.selection) : undefined);
        editor.flush();
      }
      catch (error) { failed(error); return false; }
    }
    bridge = null;
    emit("mode-change", editorEvent(false));
    await nextTick();
    if (disposed) return false;
    editor.focus();
    return true;
  }, false);
}

// The session owns lifetime and mode checks; engine adapters own their details.
const muyaCommands = createMuyaCommands(() => muya.value);
const sourceCommands = createSourceCommands(() => sourceRef.value);
function interactive() { return !disposed && !transitioning.value && !composing.value && !suspended.value; }
function focus() {
  if (!interactive()) return;
  if (props.sourceMode) sourceCommands.focus(); else muyaCommands.focus();
}
function captureView(): RecoveryView {
  return props.sourceMode ? sourceCommands.captureView() : muyaCommands.captureView();
}
function applyView(view: RecoveryView | null | undefined, sourceMode: boolean) {
  try {
    if (sourceMode) sourceCommands.applyView(view); else muyaCommands.applyView(view);
  } catch { /* Stale view data must never prevent restoring text. */ }
}
function navigateHeading(target: OutlineHeading): boolean {
  if (!interactive()) return false;
  return props.sourceMode ? sourceCommands.navigateHeading(target) : muyaCommands.navigateHeading(target);
}
function selectAll() {
  if (!interactive()) return;
  if (props.sourceMode) sourceCommands.selectAll(); else muyaCommands.selectAll();
}
function clearUndoably() {
  if (!interactive()) return;
  if (props.sourceMode) sourceCommands.clear(); else muyaCommands.clear(props.modelValue);
}
async function paste() {
  if (!interactive()) return;
  if (document.execCommand("paste")) return;
  const doc = props.identity.documentId, mode = props.sourceMode, currentActivation = activation.value;
  const editor = muya.value, source = sourceRef.value;
  const data = await readClipboardData();
  if (!interactive() || props.identity.documentId !== doc || props.sourceMode !== mode || activation.value !== currentActivation) return;
  if (mode && source && source === sourceRef.value) sourceCommands.paste(data);
  else if (!mode && editor && editor === muya.value) await muyaCommands.paste(data);
}
function search(query: string) {
  if (!interactive()) return;
  if (props.sourceMode) sourceCommands.search(query); else muyaCommands.search(query);
}
function closeSearch() {
  if (!interactive()) return;
  sourceCommands.closeSearch();
  if (!props.sourceMode) muyaCommands.closeSearch();
}
function find(query: string, forward: boolean) {
  if (!interactive() || !query) return;
  if (props.sourceMode) sourceCommands.find(query, forward); else muyaCommands.find(query, forward);
}
function replace(query: string, replacement: string, all: boolean) {
  if (!interactive() || !query) return;
  if (props.sourceMode) sourceCommands.replace(query, replacement, all); else muyaCommands.replace(query, replacement, all);
}

// Disk/recovery actions can request source mode without a user mode toggle.
watch(() => props.sourceMode, value => { if (value && !suspended.value) sourceMounted.value = true; });
onMounted(() => { if (props.checkpoint) void resume(); });
onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(compositionTimer);
  for (const resolve of waiting) resolve(false);
  waiting.clear();
  for (const resolve of taskWaiting) resolve(false);
  taskWaiting.clear();
  muyaRef.value?.getHistoryAdapter()?.destroy();
  sourceRef.value?.getHistoryAdapter()?.destroy();
  muya.value = null;
});

defineExpose({
  flush, toggleMode, suspend, resume, focus, captureView, applyView, navigateHeading,
  selectAll, clearUndoably, paste, search, closeSearch, find, replace,
  capture: () => serialize(checkpoint, null),
  undo: () => {
    if (disposed || transitioning.value || composing.value || suspended.value) return false;
    return (props.sourceMode ? sourceRef.value?.getHistoryAdapter()?.undo() : muyaRef.value?.getHistoryAdapter()?.undo()) ?? false;
  },
  redo: () => {
    if (disposed || transitioning.value || composing.value || suspended.value) return false;
    return (props.sourceMode ? sourceRef.value?.getHistoryAdapter()?.redo() : muyaRef.value?.getHistoryAdapter()?.redo()) ?? false;
  },
});
</script>

<template>
  <div class="editor-session" @compositionstart.capture="compositionStart" @compositionend.capture="compositionEnd">
    <MuyaEditor v-if="muyaMounted" ref="muyaRef" :key="activation" :options="options" :identity="identity" :lease="lease"
      :checkpoint="muyaCheckpoint" :document-path="documentPath" :model-value="modelValue"
      :active="!sourceMode && !suspended" :aria-hidden="sourceMode || !!suspended" :inert="sourceMode || !!suspended"
      @update:model-value="emit('document-change', editorEvent($event))" @ready="onReady" @restore-error="failed"
      @selection-change="emit('selection-change', editorEvent(!!$event))" />
    <SourceEditor v-if="sourceMounted" v-show="sourceMode && !suspended" ref="sourceRef" :key="activation"
      :identity="identity" :lease="lease" :checkpoint="sourceCheckpoint" :model-value="modelValue"
      :active="sourceMode && !suspended" :aria-hidden="!sourceMode || !!suspended" :inert="!sourceMode || !!suspended"
      @update:model-value="emit('document-change', editorEvent($event))" @restore-error="failed" />
  </div>
</template>

<style>
.editor-session { display: contents; }
</style>
