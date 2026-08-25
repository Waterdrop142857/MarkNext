<script setup lang="ts">
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
      源码模式：不渲染 Markdown，仅做语法高亮；切换回 WYSIWYG 后会重新解析。
    </span>
    <span v-else-if="currentFilePath || isUntitled">
      正在编辑：{{ currentFilePath || "未命名" }}
    </span>
    <span v-else>
      输入即所见即所得，Markdown 语法会在光标附近临时显示。
    </span>
    <span v-if="selection">有选区/光标事件</span>
  </footer>
</template>