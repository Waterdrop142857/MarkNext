<script setup lang="ts">
withDefaults(
  defineProps<{
    dirty?: boolean;
    pathText: string;
    isMaximized?: boolean;
  }>(),
  {
    dirty: false,
    isMaximized: false,
  },
);

defineEmits<{
  (e: "drag", event: MouseEvent): void;
  (e: "minimize"): void;
  (e: "toggle-maximize"): void;
  (e: "close"): void;
}>();
</script>

<template>
  <header class="app-titlebar" @selectstart.prevent>
    <div class="titlebar-left" @mousedown="$emit('drag', $event)">
      <span class="app-logo">MarkNext</span>
    </div>

    <div class="titlebar-path" @mousedown="$emit('drag', $event)">
      <span v-if="dirty" class="dirty-dot" title="有未保存的更改" />
      <span class="file-path">{{ pathText }}</span>
    </div>

    <div class="titlebar-window-controls">
      <button type="button" class="window-btn" aria-label="最小化" @click="$emit('minimize')">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>
      <button type="button" class="window-btn" aria-label="最大化/还原" @click="$emit('toggle-maximize')">
        <svg v-if="!isMaximized" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="0.5" y="0.5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1" />
        </svg>
        <svg v-else width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="0.5" y="2.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1" />
          <path d="M2.5 2.5V1.5h6v6h-1" fill="none" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>
      <button type="button" class="window-btn close" aria-label="关闭" @click="$emit('close')">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>
    </div>
  </header>
</template>