<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { t } from "../i18n";

const props = defineProps<{
  tabs: readonly { id: string; title: string; path: string | null; dirty: boolean; external: boolean }[];
  activeId: string | null;
  busy: boolean;
}>();
const emit = defineEmits<{
  (event: "activate", id: string, focusEditor?: boolean): void;
  (event: "close", id: string): void;
  (event: "new"): void;
}>();
const root = ref<HTMLElement | null>(null);
let keyboardFocus = false;
function navigate(event: KeyboardEvent, index: number) {
  if (props.busy) return;
  const target = event.key === "Home" ? 0 : event.key === "End" ? props.tabs.length - 1
    : event.key === "ArrowLeft" ? (index - 1 + props.tabs.length) % props.tabs.length
      : event.key === "ArrowRight" ? (index + 1) % props.tabs.length : null;
  if (target === null) return;
  event.preventDefault(); keyboardFocus = true; emit("activate", props.tabs[target].id, false);
}
watch([() => props.activeId, () => props.busy], async () => {
  if (props.busy) return;
  await nextTick();
  const selected = root.value?.querySelector<HTMLElement>('[aria-selected="true"]');
  selected?.scrollIntoView({ block: "nearest", inline: "nearest" });
  if (keyboardFocus) { selected?.focus(); keyboardFocus = false; }
});
</script>

<template>
  <nav v-if="tabs.length" class="document-tabs ui-controls" :aria-label="t('tabs.label')" :aria-busy="busy">
    <div ref="root" class="document-tab-list" role="tablist" :aria-label="t('tabs.label')">
      <div v-for="(tab, index) in tabs" :key="tab.id" class="document-tab" :class="{ active: tab.id === activeId }"
        :data-tab-id="tab.id"
        @auxclick.middle.prevent="!busy && emit('close', tab.id)">
        <button :id="`document-tab-${tab.id}`" type="button" role="tab" :aria-selected="tab.id === activeId" aria-controls="document-panel"
          :tabindex="tab.id === activeId ? 0 : -1" :disabled="busy" :title="tab.path ?? tab.title" class="document-tab-select"
          @click="emit('activate', tab.id)" @keydown="navigate($event, index)">
          <span class="document-tab-name">{{ tab.title }}</span>
          <span v-if="tab.dirty" class="tab-dirty" :aria-label="t('tabs.unsaved')">●</span>
          <span v-if="tab.external" class="tab-conflict" :aria-label="t('tabs.external')">!</span>
        </button>
        <button type="button" class="document-tab-close" :disabled="busy" :aria-label="t('tabs.close', { name: tab.title })"
          :title="t('tabs.close', { name: tab.title })" @click="emit('close', tab.id)">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="m1 1 8 8M9 1l-8 8" fill="none" stroke="currentColor" /></svg>
        </button>
      </div>
    </div>
    <button type="button" class="document-tab-new" :disabled="busy" :aria-label="t('tabs.new')" :title="t('command.new')" @click="emit('new')">+</button>
  </nav>
</template>

<style>
.document-tabs { display: flex; flex-shrink: 0; min-width: 0; padding-inline: 8px; gap: 4px; background: var(--app-menubar-bg); color: var(--app-menubar-fg); border-bottom: 1px solid var(--app-menubar-border); }
.document-tab-list { display: flex; flex: 1; min-width: 0; gap: 4px; overflow-x: auto; overflow-y: hidden; padding-block: 4px 10px; scrollbar-width: thin; }
.document-tab { display: flex; align-items: center; flex-shrink: 0; min-width: 90px; max-width: 240px; height: 32px; border: 1px solid transparent; border-radius: var(--app-ui-control-radius); }
.document-tab.active { background: var(--app-footer-bg); border-color: var(--app-menubar-border); }
.document-tab:hover { background: var(--app-menubar-hover); }
.document-tab.active:hover { background: var(--app-footer-bg); }
.document-tabs button { --ui-control-height: 30px; border: 0; border-radius: var(--app-ui-control-radius); background: transparent; color: inherit; cursor: pointer; }
.document-tab-select { min-width: 0; flex: 1; gap: 6px; padding-inline: 10px 4px; }
.document-tab-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tab-dirty { flex-shrink: 0; font-size: 9px; }
.tab-conflict { flex-shrink: 0; color: var(--app-ui-error-color); }
.document-tabs .document-tab-close { --ui-control-height: 24px; width: 24px; padding: 0; margin-inline: 2px 4px; flex-shrink: 0; }
.document-tab-close:hover, .document-tab-new:hover { background: var(--app-menubar-hover); }
.document-tabs .document-tab-new { --ui-control-height: 32px; width: 32px; padding: 0; margin-block: 4px 10px; flex-shrink: 0; font-size: 20px; }
.document-tabs button:focus-visible { outline: 1px solid var(--app-ui-focus-color); outline-offset: -1px; }
.document-tabs button:disabled { cursor: default; }
</style>
