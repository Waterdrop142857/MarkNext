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
watch(root, (list, _previous, onCleanup) => {
  if (!list) return;
  let previousHeight = -1;
  let frame = 0;
  const updateScrollbar = () => {
    // Classic scrollbars consume space below the flex row. Mirror that space
    // above it so the tabs stay centered in the whole strip on every platform.
    const height = Math.max(0, list.offsetHeight - list.clientHeight);
    if (height === previousHeight) return;
    previousHeight = height;
    list.style.setProperty("--document-tab-scrollbar-height", `${height}px`);
  };
  const observer = new ResizeObserver(() => {
    if (frame) return;
    // Padding affects the observed border box; update on the next frame to
    // avoid ResizeObserver loop errors while a scrollbar appears/disappears.
    frame = requestAnimationFrame(() => { frame = 0; updateScrollbar(); });
  });
  observer.observe(list, { box: "border-box" });
  updateScrollbar();
  onCleanup(() => { observer.disconnect(); cancelAnimationFrame(frame); });
}, { flush: "post" });
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
    <button type="button" class="document-tab-new" :disabled="busy" :aria-label="t('tabs.new')" :title="t('command.new')" @click="emit('new')">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 4v8M4 8h8" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>
    </button>
  </nav>
</template>

<style>
.document-tabs { display: flex; align-items: center; flex-shrink: 0; min-width: 0; padding-inline: 8px; gap: 4px; background: var(--app-menubar-bg); color: var(--app-menubar-fg); border-bottom: 1px solid var(--app-menubar-border); font-family: var(--app-ui-font-family); font-size: var(--app-ui-font-size); line-height: var(--app-ui-control-line-height); }
.document-tab-list { display: flex; flex: 1; align-items: center; min-width: 0; gap: 4px; overflow-x: auto; overflow-y: hidden; padding-block: 7px; padding-block-start: calc(7px + var(--document-tab-scrollbar-height, 0px)); scrollbar-width: thin; }
.document-tab { display: flex; align-items: center; flex-shrink: 0; min-width: 90px; max-width: 240px; height: 32px; border: 1px solid transparent; border-radius: var(--app-ui-control-radius); }
.document-tab.active { background: var(--app-footer-bg); border-color: var(--app-menubar-border); }
.document-tab:hover { background: var(--app-menubar-hover); }
.document-tab.active:hover { background: var(--app-footer-bg); }
.document-tabs button { --ui-control-height: 30px; border: 0; border-radius: var(--app-ui-control-radius); background: transparent; color: inherit; cursor: pointer; }
.document-tab-select { min-width: 0; flex: 1; gap: 6px; padding-inline: 10px 4px; }
/* Center the resolved font's own line box, including CJK fallback fonts.
   The button keeps its fixed height independently of these text metrics. */
.document-tab-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: normal; }
.tab-dirty { flex-shrink: 0; font-size: 9px; }
.tab-conflict { flex-shrink: 0; color: var(--app-ui-error-color); }
.document-tabs .document-tab-close { --ui-control-height: 24px; width: 24px; padding: 0; margin-inline: 2px 4px; flex-shrink: 0; }
.document-tab-close:hover, .document-tab-new:hover { background: var(--app-menubar-hover); }
.document-tabs .document-tab-new { --ui-control-height: 32px; width: 32px; padding: 0; margin: 0; flex-shrink: 0; }
.document-tabs button:focus-visible { outline: 1px solid var(--app-ui-focus-color); outline-offset: -1px; }
.document-tabs button:disabled { cursor: default; }
</style>
