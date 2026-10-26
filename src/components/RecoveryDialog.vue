<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { t, useI18n } from "../i18n";
import type { RecoverySnapshot } from "../services/documentSafety";

defineProps<{ records: RecoverySnapshot[]; unreadable: number; busy: boolean }>();
const emit = defineEmits<{
  (e: "restore", record: RecoverySnapshot): void;
  (e: "discard", record: RecoverySnapshot): void;
  (e: "close"): void;
}>();
const dialog = ref<HTMLElement | null>(null);
const previousFocus = document.activeElement as HTMLElement | null;
const { locale } = useI18n();
function date(value: number) { return new Date(value).toLocaleString(locale.value); }
function trapTab(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const buttons = [...(dialog.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
  const first = buttons[0], last = buttons[buttons.length - 1];
  if (!first) { event.preventDefault(); return; }
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
onMounted(async () => { await nextTick(); dialog.value?.querySelector<HTMLButtonElement>("button")?.focus(); });
onBeforeUnmount(() => { if (previousFocus?.isConnected) previousFocus.focus(); });
</script>

<template>
  <div class="recovery-backdrop" @click.self="!busy && emit('close')" @contextmenu.stop>
    <section ref="dialog" class="recovery-dialog ui-controls" role="dialog" aria-modal="true" aria-labelledby="recovery-title" @keydown.tab="trapTab" @keydown.esc.stop.prevent="!busy && emit('close')">
      <header>
        <h2 id="recovery-title">{{ t('recovery.title') }}</h2>
        <button type="button" :disabled="busy" :aria-label="t('common.cancel')" @click="emit('close')">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" /></svg>
        </button>
      </header>
      <div class="recovery-body ui-scroll-region">
        <p>{{ t('recovery.description') }}</p>
        <p v-if="unreadable" role="alert">{{ t('recovery.unreadable', { count: unreadable }) }}</p>
        <p v-if="!records.length">{{ t('recovery.empty') }}</p>
        <ul v-else>
          <li v-for="record in records" :key="record.id">
            <strong>{{ record.path ?? t('document.untitled') }}</strong>
            <time :datetime="new Date(record.updatedAt).toISOString()">{{ date(record.updatedAt) }}</time>
            <pre>{{ record.content.slice(0, 180) }}</pre>
            <div class="recovery-actions">
              <button type="button" :disabled="busy" @click="emit('restore', record)">{{ t('recovery.restore') }}</button>
              <button type="button" :disabled="busy" @click="emit('discard', record)">{{ t('recovery.discard') }}</button>
            </div>
          </li>
        </ul>
      </div>
      <footer><button type="button" :disabled="busy" @click="emit('close')">{{ t('common.cancel') }}</button></footer>
    </section>
  </div>
</template>

<style scoped>
.recovery-backdrop { position: fixed; inset: 0; width: var(--app-viewport-width); height: var(--app-viewport-height); z-index: 2000; display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); place-items: center; padding: 24px; background: #0006; user-select: none; -webkit-user-select: none; }
.recovery-dialog { width: 680px; max-width: 100%; max-height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--fluent-menu-border); border-radius: var(--fluent-menu-radius); box-shadow: var(--fluent-menu-shadow); background: var(--fluent-menu-bg); color: var(--fluent-menu-fg); font-family: var(--app-ui-font-family); font-size: var(--app-ui-font-size); line-height: var(--app-ui-control-line-height); }
header, footer { display: flex; flex-shrink: 0; align-items: center; gap: 12px; padding: 10px 16px; background: var(--app-menubar-bg); }
header { border-bottom: 1px solid var(--app-menubar-border); }
footer { justify-content: flex-end; border-top: 1px solid var(--app-menubar-border); }
h2 { flex: 1; margin: 0; font-size: inherit; font-weight: 600; }
button { padding-inline: 12px; border: 1px solid var(--fluent-menu-border); border-radius: 4px; background: var(--fluent-menu-bg); color: inherit; cursor: pointer; }
button:hover:enabled { background: var(--fluent-menu-item-hover); box-shadow: inset 0 0 0 1px var(--app-menubar-border); }
button:disabled { opacity: .5; cursor: default; }
.recovery-body { min-height: 0; padding-block: 12px; padding-left: 16px; }
.recovery-body > p { margin: 0 0 12px; color: var(--app-footer-fg); }
ul { list-style: none; margin: 0; padding: 0; }
li { padding-block: 12px; border-top: 1px solid var(--fluent-menu-separator); }
strong, time { display: block; overflow-wrap: anywhere; }
strong, pre { user-select: text; -webkit-user-select: text; }
time { font-size: 12px; color: var(--app-footer-fg); }
pre { margin: 8px 0; max-height: 80px; overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--app-code-font-family); font-size: 12px; }
.recovery-actions { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
