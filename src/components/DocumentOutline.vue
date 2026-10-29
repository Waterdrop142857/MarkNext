<script setup lang="ts">
import { t } from "../i18n";
import type { OutlineHeading } from "../services/documentAnalysis";

defineProps<{ headings: OutlineHeading[]; activeId: string | null }>();
const emit = defineEmits<{ (event: "navigate", heading: OutlineHeading): void; (event: "close"): void }>();

function navigateKeys(event: KeyboardEvent) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const buttons = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>(".outline-heading")];
  if (!buttons.length) return;
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
    : Math.max(0, Math.min(buttons.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
  event.preventDefault(); buttons[next].focus();
}
</script>

<template>
  <aside id="document-outline" class="document-outline ui-controls" :aria-label="t('outline.title')">
    <header class="outline-header">
      <h2>{{ t('outline.title') }}</h2>
      <button type="button" :aria-label="t('outline.hide')" @click="emit('close')"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6M9 3 3 9" fill="none" stroke="currentColor" stroke-width="1.2" /></svg></button>
    </header>
    <nav class="outline-content ui-scroll-region" :aria-label="t('outline.title')" @keydown="navigateKeys">
      <p v-if="!headings.length" class="outline-empty">{{ t('outline.empty') }}</p>
      <ol v-else>
        <li v-for="heading in headings" :key="heading.id">
          <button
            type="button" class="outline-heading" :class="{ active: heading.id === activeId }"
            :style="{ paddingInlineStart: `${8 + (heading.level - 1) * 14}px` }"
            :aria-label="t('outline.heading', { level: heading.level, text: heading.text || t('outline.untitled') })"
            :aria-current="heading.id === activeId ? 'location' : undefined"
            :title="heading.text || t('outline.untitled')"
            @click="emit('navigate', heading)"
          ><span class="outline-level" aria-hidden="true">H{{ heading.level }}</span><span class="outline-label">{{ heading.text || t('outline.untitled') }}</span></button>
        </li>
      </ol>
    </nav>
  </aside>
</template>

<style scoped>
.document-outline { flex: 0 0 clamp(120px, 26%, 240px); max-width: 45%; min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--app-menubar-bg); color: var(--app-menubar-fg); border-right: 1px solid var(--app-menubar-border); user-select: none; -webkit-user-select: none; }
.outline-header { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 4px; padding: 8px; border-bottom: 1px solid var(--app-menubar-border); }
h2 { margin: 0; font-size: 13px; font-weight: 600; }
button { --ui-control-height: var(--app-ui-control-compact-height); border: 0; border-radius: var(--app-ui-control-radius); color: inherit; background: transparent; cursor: pointer; }
.outline-header button { flex-shrink: 0; width: 32px; padding: 0; }
button:hover, button.active { background: var(--app-menubar-hover); }
button:focus-visible { outline: 1px solid var(--app-ui-focus-color); outline-offset: -1px; }
.outline-content { flex: 1; min-height: 0; padding: 4px; }
ol { list-style: none; padding: 0; margin: 0; }
.outline-heading { width: 100%; justify-content: flex-start; gap: 6px; padding-inline-end: 8px; text-align: left; }
.outline-level { flex-shrink: 0; opacity: .65; font-size: 10px; }
.outline-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.outline-empty { padding: 8px; margin: 0; font-size: 12px; opacity: .75; }
</style>
