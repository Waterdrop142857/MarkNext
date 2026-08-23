<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import MuyaEditor from "./components/MuyaEditor.vue";
import SourceEditor from "./components/SourceEditor.vue";

const markdown = ref("");
const currentFilePath = ref<string | null>(null);
const savedMarkdown = ref("");
const isUntitled = ref(false);
const selection = ref<unknown>(null);
const isSourceMode = ref(false);
const isMaximized = ref(false);
const openMenuId = ref<string | null>(null);
let unlistenResize: (() => void) | null = null;

const dirty = computed(
  () => (isUntitled.value || currentFilePath.value !== null)
    && markdown.value !== savedMarkdown.value,
);

const menus = [
  {
    id: "file",
    label: "文件",
    items: [
      { id: "new", label: "新建" },
      { id: "open", label: "打开..." },
      { id: "save", label: "保存" },
      { id: "saveAs", label: "另存为..." },
      { id: "close", label: "关闭" },
      { id: "reset", label: "重置示例" },
      { id: "exit", label: "退出" },
    ],
  },
  {
    id: "edit",
    label: "编辑",
    items: [
      { id: "toggleMode", label: "源码模式" },
      { id: "clear", label: "清空" },
    ],
  },
  {
    id: "paragraph",
    label: "段落",
    items: [
      { id: "paragraph", label: "段落（开发中）" },
    ],
  },
  {
    id: "help",
    label: "帮助",
    items: [
      { id: "about", label: "关于 MarkNext" },
    ],
  },
] as const;

function getWindow() {
  try {
    return getCurrentWindow();
  }
  catch {
    return null;
  }
}

const currentFileName = computed(() => {
  if (currentFilePath.value) {
    const parts = currentFilePath.value.split(/[\\/]/);
    return parts[parts.length - 1] || currentFilePath.value;
  }
  return isUntitled.value ? "未命名" : "未打开文件";
});

async function openFile() {
  const selected = await open({
    multiple: false,
    filters: [
      { name: "Markdown", extensions: ["md", "markdown", "txt"] },
    ],
  });

  if (typeof selected !== "string") return;

  try {
    const content = await invoke<string>("read_file", { path: selected });
    currentFilePath.value = selected;
    markdown.value = content;
    savedMarkdown.value = content;
    isUntitled.value = false;
  }
  catch (error) {
    console.error("Failed to open file:", error);
  }
}

function newFile() {
  currentFilePath.value = null;
  markdown.value = "";
  savedMarkdown.value = "";
  isUntitled.value = true;
}

async function saveFileAs() {
  const selected = await save({
    filters: [
      { name: "Markdown", extensions: ["md", "markdown", "txt"] },
    ],
    defaultPath: currentFilePath.value ?? "untitled.md",
  });

  if (typeof selected !== "string") return;

  try {
    await invoke("write_file", { path: selected, content: markdown.value });
    currentFilePath.value = selected;
    savedMarkdown.value = markdown.value;
    isUntitled.value = false;
  }
  catch (error) {
    console.error("Failed to save file:", error);
  }
}

async function saveFile() {
  if (currentFilePath.value) {
    try {
      await invoke("write_file", {
        path: currentFilePath.value,
        content: markdown.value,
      });
      savedMarkdown.value = markdown.value;
    }
    catch (error) {
      console.error("Failed to save file:", error);
    }
  }
  else {
    await saveFileAs();
  }
}

function closeFile() {
  currentFilePath.value = null;
  markdown.value = "";
  savedMarkdown.value = "";
  isUntitled.value = false;
}

function resetExample() {
  currentFilePath.value = null;
  const content =
    "# Hello Muya\n\nStart typing **bold**, *italic*, `code`, or a list:\n\n- item 1\n- item 2\n\nLink: [Example](https://example.com)\n\nTodo:\n\n- [ ] Buy milk\n- [x] Write code\n";
  markdown.value = content;
  savedMarkdown.value = content;
  isUntitled.value = false;
}

function clearContent() {
  markdown.value = "";
}

function toggleMode() {
  isSourceMode.value = !isSourceMode.value;
}

function toggleMenu(menuId: string) {
  openMenuId.value = openMenuId.value === menuId ? null : menuId;
}

function runMenuCommand(itemId: string) {
  openMenuId.value = null;

  switch (itemId) {
    case "new":
      newFile();
      break;
    case "open":
      void openFile();
      break;
    case "save":
      void saveFile();
      break;
    case "saveAs":
      void saveFileAs();
      break;
    case "close":
      closeFile();
      break;
    case "reset":
      resetExample();
      break;
    case "exit":
      closeWindow();
      break;
    case "toggleMode":
      toggleMode();
      break;
    case "clear":
      clearContent();
      break;
    case "about":
      console.log("MarkNext - WYSIWYG Markdown editor built with Tauri 2 + Vue 3");
      break;
    default:
      break;
  }
}

function startDrag(event: MouseEvent) {
  if (event.button !== 0) return;
  const win = getWindow();
  if (!win) return;
  event.preventDefault();
  void win.startDragging();
}

type ResizeDirection = "North" | "South" | "East" | "West" | "NorthEast" | "NorthWest" | "SouthEast" | "SouthWest";

function startResize(direction: ResizeDirection, event: MouseEvent) {
  if (event.button !== 0) return;
  const win = getWindow();
  if (!win) return;
  event.preventDefault();
  event.stopPropagation();
  void win.startResizeDragging(direction);
}

function minimizeWindow() {
  void getWindow()?.minimize();
}

function toggleMaximizeWindow() {
  void getWindow()?.toggleMaximize();
}

function closeWindow() {
  void getWindow()?.close();
}

async function refreshMaximized() {
  const win = getWindow();
  if (!win) return;
  try {
    isMaximized.value = await win.isMaximized();
  }
  catch {
    isMaximized.value = false;
  }
}

async function initWindowState() {
  const win = getWindow();
  if (!win) return;
  await refreshMaximized();
  try {
    unlistenResize = await win.onResized(() => {
      void refreshMaximized();
    });
  }
  catch {
    unlistenResize = null;
  }
}

function handleGlobalKeydown(event: KeyboardEvent) {
  const isModA = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a";
  if (!isModA) return;

  const target = event.target as HTMLElement | null;
  // Only allow Ctrl+A inside the editor area. Outside (titlebar/menu/body)
  // it would otherwise select all window chrome text.
  if (!target || !target.closest(".editor-area")) {
    event.preventDefault();
  }
}

onMounted(() => {
  window.addEventListener("keydown", handleGlobalKeydown);
  void initWindowState();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleGlobalKeydown);
  unlistenResize?.();
  unlistenResize = null;
});
</script>

<template>
  <div class="app-shell">
    <div v-if="!isMaximized" class="resize-handles">
      <div class="resize-handle n" @mousedown="startResize('North', $event)" />
      <div class="resize-handle s" @mousedown="startResize('South', $event)" />
      <div class="resize-handle e" @mousedown="startResize('East', $event)" />
      <div class="resize-handle w" @mousedown="startResize('West', $event)" />
      <div class="resize-handle ne" @mousedown="startResize('NorthEast', $event)" />
      <div class="resize-handle nw" @mousedown="startResize('NorthWest', $event)" />
      <div class="resize-handle se" @mousedown="startResize('SouthEast', $event)" />
      <div class="resize-handle sw" @mousedown="startResize('SouthWest', $event)" />
    </div>

    <header class="app-titlebar" @selectstart.prevent>
      <div class="titlebar-left" @mousedown="startDrag">
        <span class="app-logo">MarkNext</span>
      </div>

      <div class="titlebar-path" @mousedown="startDrag">
        <span v-if="dirty" class="dirty-dot" title="有未保存的更改" />
        <span class="file-path">{{ currentFilePath || (isUntitled ? "未命名" : "未打开文件") }}</span>
      </div>

      <div class="titlebar-window-controls">
        <button type="button" class="window-btn" aria-label="最小化" @click="minimizeWindow">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" stroke-width="1" />
          </svg>
        </button>
        <button type="button" class="window-btn" aria-label="最大化/还原" @click="toggleMaximizeWindow">
          <svg v-if="!isMaximized" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0.5" y="0.5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1" />
          </svg>
          <svg v-else width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0.5" y="2.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1" />
            <path d="M2.5 2.5V1.5h6v6h-1" fill="none" stroke="currentColor" stroke-width="1" />
          </svg>
        </button>
        <button type="button" class="window-btn close" aria-label="关闭" @click="closeWindow">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1" />
          </svg>
        </button>
      </div>
    </header>

    <nav class="menu-bar" @selectstart.prevent>
      <div
        v-for="menu in menus"
        :key="menu.id"
        class="menu-item"
        @click.stop="toggleMenu(menu.id)"
      >
        <button
          type="button"
          class="menu-trigger"
          :class="{ active: openMenuId === menu.id }"
        >
          {{ menu.label }}
        </button>
        <div v-if="openMenuId === menu.id" class="menu-dropdown">
          <button
            v-for="item in menu.items"
            :key="item.id"
            type="button"
            class="menu-command"
            :disabled="item.id === 'paragraph'"
            @click.stop="runMenuCommand(item.id)"
          >
            {{
              item.id === "toggleMode"
                ? isSourceMode
                  ? "所见即所得"
                  : "源码模式"
                : item.label
            }}
          </button>
        </div>
      </div>
    </nav>

    <div v-if="openMenuId" class="menu-overlay" @click="openMenuId = null" />

    <main class="editor-area" :class="{ 'source-mode': isSourceMode }">
      <div v-if="!isUntitled && !currentFilePath && !markdown" class="empty-state">
        <p>打开一个 Markdown 文件开始编辑</p>
        <button type="button" class="primary-btn" @click="openFile">打开文件</button>
      </div>
      <MuyaEditor
        v-else-if="!isSourceMode"
        v-model="markdown"
        @selection-change="selection = $event"
      />
      <SourceEditor v-else v-model="markdown" />
    </main>

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
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--app-bg, #f5f5f5);
  overflow: hidden;
  position: relative;
}

.resize-handles {
  position: fixed;
  inset: 0;
  z-index: 100;
  pointer-events: none;
}

.resize-handle {
  position: fixed;
  pointer-events: auto;
  user-select: none;
}

.resize-handle.n {
  top: 0;
  left: 6px;
  right: 6px;
  height: 5px;
  cursor: ns-resize;
}

.resize-handle.s {
  bottom: 0;
  left: 6px;
  right: 6px;
  height: 5px;
  cursor: ns-resize;
}

.resize-handle.e {
  right: 0;
  top: 6px;
  bottom: 6px;
  width: 5px;
  cursor: ew-resize;
}

.resize-handle.w {
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 5px;
  cursor: ew-resize;
}

.resize-handle.ne {
  top: 0;
  right: 0;
  width: 10px;
  height: 10px;
  cursor: nesw-resize;
}

.resize-handle.nw {
  top: 0;
  left: 0;
  width: 10px;
  height: 10px;
  cursor: nwse-resize;
}

.resize-handle.se {
  bottom: 0;
  right: 0;
  width: 10px;
  height: 10px;
  cursor: nwse-resize;
}

.resize-handle.sw {
  bottom: 0;
  left: 0;
  width: 10px;
  height: 10px;
  cursor: nesw-resize;
}

.app-titlebar {
  display: flex;
  align-items: center;
  height: 48px;
  background: #2b2d31;
  color: #eee;
  user-select: none;
}

.titlebar-left {
  display: flex;
  align-items: center;
  height: 100%;
  padding: 0 16px;
  flex: 0 0 auto;
}

.app-logo {
  font-weight: 700;
  color: #fff;
}

.titlebar-path {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  height: 100%;
  min-width: 0;
  padding: 0 12px;
}

.dirty-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #e81123;
  flex: 0 0 auto;
}

.file-path {
  color: #bbb;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.titlebar-window-controls {
  display: flex;
  align-items: stretch;
  height: 100%;
  margin-left: 8px;
  flex: 0 0 auto;
}

.window-btn {
  width: 46px;
  height: 48px;
  border: none;
  border-radius: 0;
  background: transparent;
  color: #ddd;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.window-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.window-btn:active {
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
}

.window-btn.close:hover {
  background: #c42b1c;
  color: #fff;
}

.window-btn.close:active {
  background: #a0261a;
  color: #fff;
}

.menu-bar {
  display: flex;
  align-items: center;
  height: 32px;
  background: #25272b;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding: 0 4px;
  position: relative;
  z-index: 20;
  user-select: none;
}

.menu-item {
  position: relative;
  user-select: none;
}

.menu-trigger {
  border: none;
  background: transparent;
  color: #ddd;
  font-size: 13px;
  padding: 5px 10px;
  border-radius: 4px;
  cursor: pointer;
  user-select: none;
}

.menu-trigger:hover,
.menu-trigger.active {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.menu-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 180px;
  padding: 4px;
  background: #2b2d31;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  user-select: none;
}

.menu-command {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  color: #eee;
  font-size: 13px;
  padding: 6px 10px;
  border-radius: 4px;
  cursor: pointer;
  user-select: none;
}

.menu-command:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
}

.menu-command:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 10;
}

.editor-area {
  flex: 1;
  min-height: 0;
  padding: 24px;
  display: flex;
  justify-content: center;
  overflow: hidden;
}

.editor-area :deep(.muya-editor) {
  width: 100%;
  max-width: 860px;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

.editor-area.source-mode {
  padding: 0;
}

.editor-area.source-mode :deep(.source-editor) {
  background: #fff;
  box-shadow: none;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: #888;
}

.empty-state p {
  margin: 0;
}

.primary-btn {
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 6px 14px;
  background: rgba(0, 0, 0, 0.05);
  color: #333;
  cursor: pointer;
  font-size: 13px;
}

.primary-btn:hover {
  background: rgba(0, 0, 0, 0.08);
}

/* Prevent selecting window chrome UI */
.app-titlebar,
.titlebar-left,
.titlebar-path,
.titlebar-window-controls,
.window-btn,
.menu-bar,
.menu-item,
.menu-trigger,
.menu-dropdown,
.menu-command,
.resize-handle {
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
}



.app-footer {
  display: flex;
  justify-content: space-between;
  padding: 0 16px;
  height: 30px;
  align-items: center;
  border-top: 1px solid #ddd;
  background: #fff;
  color: #666;
  font-size: 12px;
}
</style>