<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Muya, type IMuyaOptions } from "../muya";
import { LINK_SELECTOR } from "../muya/editor/linkMouseEvents";
import { getLinkInfo } from "../muya/utils/getLinkInfo";
import {
  createWebKitSelectionPainter,
  isNonChromiumWebKit,
  type WebKitSelectionPainter,
} from "./editor/webkitSelectionPainter";

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    options?: Partial<IMuyaOptions>;
  }>(),
  {
    modelValue: "",
    options: () => ({}),
  },
);

const emit = defineEmits<{
  (e: "update:modelValue", markdown: string): void;
  (e: "ready", editor: Muya): void;
  (e: "selection-change", selection: unknown): void;
}>();

const wrapperRef = ref<HTMLElement | null>(null);
let editor: Muya | null = null;
let domNode: HTMLElement | null = null;
let internalChange = false;
let webkitPainter: WebKitSelectionPainter | null = null;

function handleKeydown(event: KeyboardEvent) {
  const isModA = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a";
  if (!isModA || !editor) return;

  // Always select the whole document on the first Ctrl+A, rather than Muya's
  // block-first escalation (first selects current paragraph).
  event.preventDefault();
  event.stopPropagation();
  editor.selectAllDocument();
  webkitPainter?.schedule();
}

async function openExternal(href: string) {
  try {
    await openUrl(href);
  }
  catch {
    // Fallback for plain-browser (Vite dev) usage outside Tauri.
    window.open(href, "_blank", "noopener,noreferrer");
  }
}

function handleDblClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  if (!target) return;

  // Standard rendered links (markdown / reference / HTML / autolink).
  const wrapper = target.closest<HTMLElement>(LINK_SELECTOR);
  if (wrapper) {
    const linkInfo = getLinkInfo(wrapper);
    if (linkInfo?.href) {
      event.preventDefault();
      event.stopPropagation();
      void openExternal(linkInfo.href);
    }
    return;
  }

  // Links inside raw HTML block previews are plain <a> tags.
  const previewAnchor = target.closest<HTMLAnchorElement>(".mu-html-preview a[href]");
  const previewHref = previewAnchor?.getAttribute("href");
  if (previewAnchor && previewHref) {
    event.preventDefault();
    event.stopPropagation();
    void openExternal(previewHref);
  }
}

onMounted(() => {
  if (!wrapperRef.value) return;

  // Gate the WebKit selection-paint workaround to non-Chromium WebKit runtimes.
  if (isNonChromiumWebKit()) {
    wrapperRef.value.classList.add("mu-webkit-selection-fix");
  }

  // Muya's constructor replaces the passed node with its own contenteditable
  // root. Use an imperative placeholder so Vue never tries to patch/unmount a
  // DOM node that Muya has already replaced.
  const placeholder = document.createElement("div");
  wrapperRef.value.appendChild(placeholder);

  // Start with the actual document content. New files pass an empty string and
  // must NOT be seeded with sample content (it made WYSIWYG and source mode
  // disagree on first-new-file state).
  const initialMarkdown = props.modelValue;

  editor = new Muya(placeholder, {
    markdown: initialMarkdown,
    ...props.options,
  });
  domNode = editor.domNode;
  domNode.addEventListener("keydown", handleKeydown);
  domNode.addEventListener("dblclick", handleDblClick);

  editor.on("json-change", () => {
    if (!editor) return;
    const markdown = editor.getMarkdown();
    internalChange = true;
    emit("update:modelValue", markdown);
    void nextTick(() => {
      internalChange = false;
      webkitPainter?.schedule();
    });
  });

  editor.on("selection-change", (selection: unknown) => {
    emit("selection-change", selection);
  });

  editor.init();
  webkitPainter = createWebKitSelectionPainter(domNode, wrapperRef.value);
  webkitPainter?.start();
  emit("ready", editor);
});

watch(
  () => props.modelValue,
  (value) => {
    if (!editor || internalChange) return;
    const current = editor.getMarkdown();
    if (value !== current) editor.setContent(value ?? "");
  },
);

onBeforeUnmount(() => {
  webkitPainter?.stop();
  webkitPainter = null;
  domNode?.removeEventListener("keydown", handleKeydown);
  domNode?.removeEventListener("dblclick", handleDblClick);
  editor?.destroy();
  editor = null;
  domNode = null;
});

defineExpose({
  getMarkdown: () => editor?.getMarkdown() ?? "",
  setContent: (content: string) => editor?.setContent(content),
  editor,
});
</script>

<template>
  <div ref="wrapperRef" class="muya-editor" />
</template>