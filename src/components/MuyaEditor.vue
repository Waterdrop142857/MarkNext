<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Muya, type IMuyaOptions } from "../muya";
import { LINK_SELECTOR } from "../muya/editor/linkMouseEvents";
import { getLinkInfo } from "../muya/utils/getLinkInfo";

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

// WebKitGTK/WKWebView paint text selection at the full block width when
// `.mu-content` is `display: block`. For those runtimes we hide the native
// selection background and draw our own overlay from `Range.getClientRects()`.
const isNonChromiumWebKit = (() => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /AppleWebKit|WebKit/i.test(ua) && !/Chrome|CriOS|Edg/i.test(ua);
})();

let selectionOverlay: HTMLDivElement | null = null;
let selectionRaf = 0;
let selectionObserver: MutationObserver | null = null;

function ensureSelectionOverlay() {
  if (!isNonChromiumWebKit || !domNode) return;
  if (!selectionOverlay) {
    selectionOverlay = document.createElement("div");
    selectionOverlay.className = "mu-webkit-selection-overlay";
  }
  if (!selectionOverlay.isConnected) {
    domNode.appendChild(selectionOverlay);
  }
  // Keep `display: block` and the full-width editable area intact; the overlay
  // is a positioned layer behind the text so it never affects layout or input.
  domNode.style.position = "relative";
  domNode.style.zIndex = "0";
  selectionOverlay.style.height = `${domNode.scrollHeight || domNode.clientHeight}px`;
}

function scheduleSelectionPaint() {
  if (!isNonChromiumWebKit || !domNode) return;
  if (selectionRaf) cancelAnimationFrame(selectionRaf);
  selectionRaf = requestAnimationFrame(() => {
    selectionRaf = 0;
    paintSelection();
  });
}

function mergeSelectionRects(
  rects: DOMRect[],
  padX: number,
): Array<{ left: number; top: number; width: number; height: number }> {
  const items = rects
    .map((r) => ({
      left: r.left - padX,
      right: r.right + padX,
      top: r.top,
      bottom: r.bottom,
    }))
    .sort((a, b) => a.top - b.top || a.left - b.left);

  const merged: typeof items = [];
  for (const item of items) {
    const last = merged[merged.length - 1];
    const sameLine = last !== undefined
      && item.top < last.bottom - 1
      && last.top < item.bottom - 1;
    const gap = sameLine ? item.left - last.right : Number.POSITIVE_INFINITY;

    // Merge rects that belong to the same visual line and touch/almost touch.
    // This prevents adjacent inline elements (bold/em/code) from stacking two
    // semi-transparent selection layers and looking darker at the seams.
    if (sameLine && gap <= 4) {
      last.left = Math.min(last.left, item.left);
      last.right = Math.max(last.right, item.right);
      last.top = Math.min(last.top, item.top);
      last.bottom = Math.max(last.bottom, item.bottom);
    }
    else {
      merged.push({ ...item });
    }
  }

  return merged.map((m) => ({
    left: m.left,
    top: m.top,
    width: m.right - m.left,
    height: m.bottom - m.top,
  }));
}

function paintSelection() {
  if (!isNonChromiumWebKit || !domNode) return;
  ensureSelectionOverlay();
  if (!selectionOverlay) return;

  selectionOverlay.textContent = "";
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  if (!domNode.contains(range.commonAncestorContainer)) return;

  const editorRect = domNode.getBoundingClientRect();
  const padX = 2; // small horizontal breathing room, matches the old CSS padding
  const rects = mergeSelectionRects(Array.from(range.getClientRects()), padX);
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (r.width === 0 || r.height === 0) continue;
    const rect = document.createElement("div");
    rect.className = "mu-webkit-selection-rect";
    rect.style.left = `${r.left - editorRect.left}px`;
    rect.style.top = `${r.top - editorRect.top}px`;
    rect.style.width = `${r.width}px`;
    rect.style.height = `${r.height}px`;
    selectionOverlay.appendChild(rect);
  }
}

function startWebKitSelectionPainter() {
  if (!isNonChromiumWebKit || !domNode) return;
  ensureSelectionOverlay();
  document.addEventListener("selectionchange", scheduleSelectionPaint);
  window.addEventListener("resize", scheduleSelectionPaint);
  wrapperRef.value?.addEventListener("scroll", scheduleSelectionPaint, true);
  selectionObserver = new MutationObserver((mutations) => {
    // Our own overlay repaints mutate the same subtree; ignore those mutations
    // to avoid paint → observe → paint feedback loop (which froze drag-select).
    if (!selectionOverlay) {
      scheduleSelectionPaint();
      return;
    }
    for (const mutation of mutations) {
      const target = mutation.target as Node | null;
      if (target && (target === selectionOverlay || selectionOverlay.contains(target))) {
        continue;
      }
      scheduleSelectionPaint();
      return;
    }
  });
  selectionObserver.observe(domNode, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  scheduleSelectionPaint();
}

function stopWebKitSelectionPainter() {
  if (selectionRaf) cancelAnimationFrame(selectionRaf);
  document.removeEventListener("selectionchange", scheduleSelectionPaint);
  window.removeEventListener("resize", scheduleSelectionPaint);
  wrapperRef.value?.removeEventListener("scroll", scheduleSelectionPaint, true);
  selectionObserver?.disconnect();
  selectionObserver = null;
  selectionOverlay?.remove();
  selectionOverlay = null;
  if (domNode) {
    domNode.style.position = "";
    domNode.style.zIndex = "";
  }
}

function handleKeydown(event: KeyboardEvent) {
  const isModA = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a";
  if (!isModA || !editor) return;

  // Always select the whole document on the first Ctrl+A, rather than Muya's
  // block-first escalation (first selects current paragraph).
  event.preventDefault();
  event.stopPropagation();
  editor.selectAllDocument();
  scheduleSelectionPaint();
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
  if (isNonChromiumWebKit) {
    wrapperRef.value.classList.add("mu-webkit-selection-fix");
  }

  // Muya's constructor replaces the passed node with its own contenteditable
  // root. Use an imperative placeholder so Vue never tries to patch/unmount a
  // DOM node that Muya has already replaced.
  const placeholder = document.createElement("div");
  wrapperRef.value.appendChild(placeholder);

  const initialMarkdown =
    props.modelValue ||
    "# Hello Muya\n\nStart typing **bold**, *italic*, `code`, or a list:\n\n- item 1\n- item 2\n";

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
      scheduleSelectionPaint();
    });
  });

  editor.on("selection-change", (selection: unknown) => {
    emit("selection-change", selection);
  });

  editor.init();
  if (isNonChromiumWebKit) {
    startWebKitSelectionPainter();
  }
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
  stopWebKitSelectionPainter();
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

<style scoped>
.muya-editor {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  background: var(--editor-bg, #ffffff);
  color: var(--editor-color, #1f1f1f);
}
</style>

<style>
/* WebKitGTK only: remove the native block-width selection paint and replace it
   with our own `Range.getClientRects()` overlay (drawn in JS). */
.mu-webkit-selection-fix .mu-editor ::selection,
.mu-webkit-selection-fix .mu-editor *::selection {
  background: transparent !important;
}

.mu-webkit-selection-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  pointer-events: none;
  z-index: -1;
}

.mu-webkit-selection-overlay .mu-webkit-selection-rect {
  position: absolute;
  background: var(--selection-color);
  border-radius: 2px;
}
</style>