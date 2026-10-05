<script setup lang="ts">
import { t } from "../i18n";
withDefaults(
  defineProps<{
    isSourceMode?: boolean;
    currentFilePath: string | null;
    isUntitled?: boolean;
    selection?: unknown;
  }>(),
  {
    isSourceMode: false,
    isUntitled: false,
  },
);
</script>

<template>
  <footer class="app-footer">
    <span v-if="isSourceMode">
      {{ t('status.source') }}
    </span>
    <span v-else-if="currentFilePath || isUntitled">
      {{ t('status.editing', { path: currentFilePath || t('document.untitled') }) }}
    </span>
    <span v-else>
      {{ t('status.wysiwyg') }}
    </span>
    <span v-if="selection">{{ t('status.selection') }}</span>
  </footer>
</template>