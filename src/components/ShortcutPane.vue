<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { cloneBindings, shortcutCommands, shortcutFromEvent, shortcutLabel, validateBindings } from "../config/shortcuts";
import { t } from "../i18n";
import type { ShortcutBindings, ShortcutCommand } from "../config/shortcuts";

const props = defineProps<{
  bindings: ShortcutBindings;
  defaults: ShortcutBindings;
  active: boolean;
}>();
const emit = defineEmits<{
  (e: "update:bindings", value: ShortcutBindings): void;
  (e: "recording", value: boolean): void;
}>();
const draft = computed({ get: () => props.bindings, set: value => emit("update:bindings", value) });
const query = ref("");
const errorResolver = ref<(() => string) | null>(null);
const error = computed(() => errorResolver.value?.() ?? "");
const recording = ref<ShortcutCommand | null>(null);
const searchRef = ref<HTMLInputElement | null>(null);
const recordRef = ref<HTMLInputElement | null>(null);
const commands = computed(() => shortcutCommands.filter(command =>
  `${t(command.label)} ${t(command.group)} ${draft.value[command.id].map(shortcutLabel).join(" ")}`.toLowerCase().includes(query.value.toLowerCase()),
));

const recordingLabel = computed(() => {
  const command = shortcutCommands.find(command => command.id === recording.value);
  return command ? t(command.label) : "";
});

async function record(id: ShortcutCommand) {
  recording.value = id;
  errorResolver.value = null;
  await nextTick();
  recordRef.value?.focus();
}

function setDraft(value: ShortcutBindings) {
  const issue = validateBindings(value);
  errorResolver.value = issue ? () => validateBindings(value) ?? "" : null;
  if (!issue) draft.value = value;
}

function unbind(id: ShortcutCommand, index: number) {
  const value = cloneBindings(draft.value);
  value[id].splice(index, 1);
  setDraft(value);
}

function restore(id?: ShortcutCommand) {
  const value = id ? cloneBindings(draft.value) : cloneBindings(props.defaults);
  if (id) value[id] = [...props.defaults[id]];
  setDraft(value);
  recording.value = null;
}

function handleKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    if (recording.value) recording.value = null;

    return;
  }
  if (recording.value && (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey)) {
    event.preventDefault();
    event.stopPropagation();
    if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return;
    const chord = shortcutFromEvent(event);
    if (!chord) {
      errorResolver.value = () => t("shortcut.modifiers");
      return;
    }
    const owner = shortcutCommands.find(command => draft.value[command.id].includes(chord));
    if (owner) {
      errorResolver.value = () => t("shortcut.conflict", { chord: shortcutLabel(chord), command: t(owner.label) });
      return;
    }
    const value = cloneBindings(draft.value);
    value[recording.value].push(chord);
    setDraft(value);
    if (!error.value) recording.value = null;
    return;
  }
  if (event.key === "Tab") recording.value = null;
}

watch(recording, value => emit("recording", value !== null), { flush: "sync" });
watch(() => props.active, active => {
  if (!active) recording.value = null;
});

onMounted(() => { if (props.active) searchRef.value?.focus(); });
defineExpose({ restoreAll: () => restore(), cancelRecording: () => { recording.value = null; } });
</script>

<template>
  <div class="shortcut-pane" @keydown.capture="handleKeydown">
      <p class="shortcut-help">{{ t('shortcut.help') }}</p>
      <input ref="searchRef" v-model="query" class="shortcut-search" type="search" :placeholder="t('shortcut.search')" :aria-label="t('shortcut.search')" />
      <div class="shortcut-list">
        <div v-for="command in commands" :key="command.id" class="shortcut-row">
          <div class="shortcut-command"><span>{{ t(command.label) }}</span><small>{{ t(command.group) }}</small></div>
          <div class="shortcut-bindings">
            <span v-for="(chord, index) in draft[command.id]" :key="chord" class="shortcut-chip">
              <kbd>{{ shortcutLabel(chord) }}</kbd>
              <button type="button" :aria-label="t('shortcut.unbind', { command: t(command.label), chord: shortcutLabel(chord) })" @click="unbind(command.id, index)"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1l8 8M9 1l-8 8" fill="none" stroke="currentColor" stroke-width="1" /></svg></button>
            </span>
            <span v-if="!draft[command.id].length" class="shortcut-unbound">{{ t('shortcut.unbound') }}</span>
          </div>
          <div class="shortcut-row-actions">
            <button type="button" @click="record(command.id)">{{ t('shortcut.add') }}</button>
            <button type="button" :aria-label="t('shortcut.restoreCommand', { command: t(command.label) })" @click="restore(command.id)">{{ t('shortcut.restore') }}</button>
          </div>
        </div>
        <p v-if="!commands.length">{{ t('shortcut.noResults') }}</p>
      </div>
      <div v-if="recording" class="shortcut-recording">
        <label for="shortcut-record">{{ t('shortcut.record', { command: recordingLabel }) }}</label>
        <input id="shortcut-record" ref="recordRef" readonly :placeholder="t('shortcut.press')" />
        <button type="button" @click="recording = null">{{ t('shortcut.cancelRecording') }}</button>
      </div>
      <p class="shortcut-error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.shortcut-pane { display: flex; flex-direction: column; gap: 12px; min-height: 0; }
.shortcut-help, .shortcut-error { margin: 0; font-size: 12px; line-height: 1.6; }
.shortcut-help, small, .shortcut-unbound { color: var(--app-footer-fg); }
button, input { color: inherit; }
button { cursor: pointer; padding-inline: 10px; border-radius: var(--app-ui-control-radius); border: 1px solid var(--fluent-menu-border, #ddd); background: transparent; }
button:hover:not(:disabled) { background: var(--fluent-menu-item-hover, #8882); }
button:active:not(:disabled) { background: var(--fluent-menu-item-active); }
button:disabled { color: var(--fluent-menu-disabled); cursor: default; }
button:focus-visible, input:focus-visible { outline: 1px solid var(--app-ui-focus-color); outline-offset: -1px; }
input { -webkit-user-select: text; user-select: text; border: 1px solid var(--fluent-menu-border, #ddd); background: var(--fluent-menu-bg); border-radius: var(--app-ui-control-radius); }
.shortcut-list { min-height: 0; }
.shortcut-row { display: flex; align-items: center; gap: 12px; min-height: 54px; border-bottom: 1px solid var(--fluent-menu-border, #ddd); }
.shortcut-command { width: 150px; flex-shrink: 0; display: flex; flex-direction: column; gap: 3px; font-size: var(--app-ui-font-size); }
.shortcut-bindings { flex: 1; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.shortcut-chip { --ui-control-height: calc(var(--app-ui-chip-height) - 2px); --ui-control-font-size: 12px; display: inline-flex; align-items: center; height: var(--app-ui-chip-height); gap: 3px; border: 1px solid var(--fluent-menu-border, #ddd); border-radius: var(--app-ui-control-radius); padding-left: 7px; }
.shortcut-chip button { width: 28px; border: 0; padding-inline: 6px; }
.shortcut-row-actions { display: flex; gap: 5px; }
.shortcut-unbound { font-size: 12px; }
.shortcut-recording { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; }
.shortcut-recording input { flex: 1; min-width: 180px; }
.shortcut-error { color: var(--app-ui-error-color); min-height: 18px; }
@container (max-width: 600px) { .shortcut-row { flex-wrap: wrap; padding: 8px 0; } .shortcut-command { width: 100px; } .shortcut-row-actions { margin-left: auto; } }
</style>
