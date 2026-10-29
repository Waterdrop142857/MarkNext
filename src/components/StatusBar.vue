<script setup lang="ts">
import { ref } from "vue";
import { t } from "../i18n";
import type { DocumentStatistics } from "../services/documentAnalysis";
withDefaults(
  defineProps<{
    isSourceMode?: boolean;
    currentFilePath: string | null;
    isUntitled?: boolean;
    selection?: unknown;
    statistics: DocumentStatistics;
    outlineOpen: boolean;
  }>(),
  {
    isSourceMode: false,
    isUntitled: false,
  },
);
defineEmits<{ (event: "toggle-outline"): void }>();
const countMode = ref<"words" | "characters">("words");
</script>

<template>
  <footer class="app-footer ui-controls">
    <button id="outline-toggle" type="button" class="outline-toggle" :aria-expanded="outlineOpen" aria-controls="document-outline" :aria-label="t(outlineOpen ? 'outline.hide' : 'outline.show')" :title="t(outlineOpen ? 'outline.hide' : 'outline.show')" @click="$emit('toggle-outline')">
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M1.5 2h11v10h-11zM5 2v10M7 5h3M7 8h3" fill="none" stroke="currentColor" stroke-width="1" /></svg>{{ t('outline.toggle') }}
    </button>
    <span v-if="isSourceMode" class="status-document">
      {{ t('status.source') }}
    </span>
    <span v-else-if="currentFilePath || isUntitled" class="status-document">
      {{ t('status.editing', { path: currentFilePath || t('document.untitled') }) }}
    </span>
    <span v-else class="status-document">
      {{ t('status.wysiwyg') }}
    </span>
    <span v-if="selection" class="status-selection">{{ t('status.selection') }}</span>
    <button type="button" class="document-statistics" :title="t('status.countDescription')"
      :aria-label="`${t(countMode === 'words' ? 'status.words' : 'status.characters', { count: statistics[countMode] })}; ${t(countMode === 'words' ? 'status.showCharacters' : 'status.showWords')}`"
      @click="countMode = countMode === 'words' ? 'characters' : 'words'">
      <span v-if="countMode === 'words'" class="word-count">{{ t('status.words', { count: statistics.words }) }}</span>
      <span v-else class="character-count">{{ t('status.characters', { count: statistics.characters }) }}</span>
    </button>
  </footer>
</template>
