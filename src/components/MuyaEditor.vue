<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useI18n } from "../i18n";
import { en } from "../muya/locales/en";
import { zhCN } from "../muya/locales/zh-CN";
import { Muya, type IMuyaOptions } from "../muya";
import { LINK_SELECTOR } from "../muya/editor/linkMouseEvents";
import { getLinkInfo } from "../muya/utils/getLinkInfo";
import { createDocumentImageResolver } from "../services/documentImages";
import { BLOCK_DOM_PROPERTY } from "../muya/config";
import { createMuyaHistoryAdapter } from "../editor/muyaHistoryAdapter";
import { cloneData, decodeMuyaCheckpoint } from "../editor/checkpointCodec";
import type { TState } from "../muya/state/types";
import type { DocumentRevision, MuyaCheckpoint, MuyaHistoryAdapter, RendererLease } from "../editor/sessionTypes";
import type HTMLPreview from "../muya/block/commonMark/html/htmlPreview";
import {
  createWebKitSelectionPainter,
  isNonChromiumWebKit,
  type WebKitSelectionPainter,
} from "./editor/webkitSelectionPainter";

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    active?: boolean;
    options?: Partial<IMuyaOptions>;
    documentPath?: string | null;
    identity?: DocumentRevision;
    lease?: RendererLease;
    checkpoint?: MuyaCheckpoint | null;
  }>(),
  {
    modelValue: "",
    active: true,
    options: () => ({}),
    documentPath: null,
  },
);

const emit = defineEmits<{
  (e: "update:modelValue", markdown: string): void;
  (e: "ready", editor: Muya): void;
  (e: "selection-change", selection: unknown): void;
  (e: "restore-error", error: unknown): void;
}>();

const wrapperRef = ref<HTMLElement | null>(null);
let editor: Muya | null = null;
let domNode: HTMLElement | null = null;
let internalChange = false;
let webkitPainter: WebKitSelectionPainter | null = null;
let history: MuyaHistoryAdapter | null = null;
let restoring = false;
let disposed = false;
const standalone = { documentId: "standalone", revision: 0 };
const { locale } = useI18n();
const editorLocale = () => locale.value === "zh-CN" ? zhCN : en;
const images = createDocumentImageResolver(() => props.documentPath);

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

function cleanup() {
  disposed = true;
  webkitPainter?.stop();
  webkitPainter = null;
  domNode?.removeEventListener("dblclick", handleDblClick);
  editor?.destroy();
  editor = null;
  domNode = null;
  images.reset();
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

  let checkpoint: MuyaCheckpoint | null;
  try { checkpoint = props.checkpoint ? decodeMuyaCheckpoint(props.checkpoint) : null; }
  catch (error) { cleanup(); emit("restore-error", error); return; }
  editor = new Muya(placeholder, {
    ...props.options,
    markdown: initialMarkdown,
    json: checkpoint ? cloneData<TState[]>(checkpoint.state) : undefined,
    locale: editorLocale(),
    resolveImageSrc: images.resolve,
    prepareImageSrc: images.prepare,
  });
  domNode = editor.domNode;
  domNode.addEventListener("dblclick", handleDblClick);

  editor.on("json-change", () => {
    if (!editor || !props.active || restoring || disposed) return;
    const markdown = editor.getMarkdown();
    if (markdown === props.modelValue) return;
    internalChange = true;
    emit("update:modelValue", markdown);
    void nextTick(() => {
      internalChange = false;
      webkitPainter?.schedule();
    });
  });

  editor.on("selection-change", (selection: unknown) => {
    if (!props.active || restoring || disposed) return;
    emit("selection-change", selection);
    webkitPainter?.schedule();
  });

  editor.init();
  const lease = props.lease ?? { documentId: (props.identity ?? standalone).documentId, activation: 0 };
  history = createMuyaHistoryAdapter(editor, {
    lease,
    scrollHost: wrapperRef.value,
    identity: () => props.identity ?? standalone,
    isCurrent: () => !disposed && (props.identity ?? standalone).documentId === lease.documentId
      && (!props.lease || props.lease.activation === lease.activation),
    silently(action) { restoring = true; try { action(); } finally { restoring = false; } },
    cleanup,
  }, checkpoint);
  if (checkpoint) {
    try {
      const result = history.restore(checkpoint, checkpoint);
      if (!result.ok) throw new Error(`Cannot restore Muya history: ${result.reason}`);
    }
    catch (error) { history.destroy(); emit("restore-error", error); return; }
  }
  webkitPainter = createWebKitSelectionPainter(domNode, wrapperRef.value);
  if (props.active) webkitPainter?.start();
  emit("ready", editor);
});

watch(
  () => props.modelValue,
  (value) => {
    if (!editor || !props.active || internalChange) return;
    const current = editor.getMarkdown();
    if (value !== current) editor.setContent(value ?? "");
  },
);

watch(locale, () => {
  if (!editor) return;
  editor.flush();
  editor.locale(editorLocale());
  webkitPainter?.schedule();
});

// Appearance changes update CSS variables on the existing editor root. Muya's
// default setOptions path preserves the document tree and undo/redo history.
watch(() => props.options, value => { editor?.setOptions(value); }, { deep: true });

watch(() => props.documentPath, () => {
  images.reset();
  if (!editor) return;
  editor.invalidateImageCache();
  for (const element of editor.domNode.querySelectorAll<HTMLElement>(".mu-html-preview")) {
    (element[BLOCK_DOM_PROPERTY] as HTMLPreview | undefined)?.update();
  }
});

watch(
  () => props.active,
  (active) => {
    if (!active) {
      webkitPainter?.stop();
      return;
    }
    webkitPainter?.start();
    webkitPainter?.schedule();
  },
);

onBeforeUnmount(() => {
  if (history) history.destroy(); else cleanup();
  history = null;
});

defineExpose({
  getMarkdown: () => editor?.getMarkdown() ?? "",
  setContent: (content: string) => editor?.setContent(content),
  flush: () => editor?.flush(),
  focus: () => editor?.focus(),
  undo: () => editor?.undo(),
  redo: () => editor?.redo(),
  editor,
  getHistoryAdapter: () => history,
});
</script>

<template>
  <div ref="wrapperRef" class="muya-editor ui-scroll-region" />
</template>
