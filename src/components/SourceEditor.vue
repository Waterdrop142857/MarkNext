<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import CodeMirror from "codemirror";
import "codemirror/lib/codemirror.css";
import "codemirror/mode/markdown/markdown.js";

const props = withDefaults(defineProps<{ modelValue?: string }>(), {
  modelValue: "",
});

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();

const containerRef = ref<HTMLElement | null>(null);
let cm: CodeMirror.Editor | null = null;
let internalChange = false;

onMounted(() => {
  if (!containerRef.value) return;

  cm = CodeMirror(containerRef.value, {
    value: props.modelValue,
    mode: {
      name: "markdown",
      taskLists: true,
    },
    lineNumbers: true,
    lineWrapping: true,
    theme: "default",
    viewportMargin: Infinity,
  });

  cm.on("change", () => {
    if (!cm) return;
    internalChange = true;
    emit("update:modelValue", cm.getValue());
    void nextTick(() => {
      internalChange = false;
    });
  });
});

watch(
  () => props.modelValue,
  (value) => {
    if (!cm || internalChange) return;
    if (value !== cm.getValue()) cm.setValue(value ?? "");
  },
);

onBeforeUnmount(() => {
  cm?.getWrapperElement().remove();
  cm = null;
});

defineExpose({
  getValue: () => cm?.getValue() ?? "",
  setValue: (value: string) => {
    cm?.setValue(value);
    emit("update:modelValue", value);
  },
  focus: () => cm?.focus(),
});
</script>

<template>
  <div ref="containerRef" class="source-editor" />
</template>

<style scoped>
.source-editor {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

:deep(.CodeMirror) {
  height: 100%;
  font-family: "JetBrains Mono", "Fira Code", "Source Code Pro", Consolas, monospace;
  font-size: 14px;
  line-height: 1.6;
}

/* Task list markers: `[ ]` = meta/orange, `[x]` = property/green */
:deep(.cm-meta) {
  color: #b76e01;
}

:deep(.cm-property) {
  color: #2e7d32;
}
</style>