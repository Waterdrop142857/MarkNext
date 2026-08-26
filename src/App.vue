<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import MuyaEditor from "./components/MuyaEditor.vue";
import SourceEditor from "./components/SourceEditor.vue";
import TitleBar from "./components/TitleBar.vue";
import MenuBar from "./components/MenuBar.vue";
import StatusBar from "./components/StatusBar.vue";
import FluentContextMenu from "./components/FluentContextMenu.vue";
import type { FluentMenuItem } from "./components/fluentMenu";
import type { Muya } from "./muya";
import { useWorkspace } from "./composables/useWorkspace";
import { useWindowChrome } from "./composables/useWindowChrome";
import { useTheme } from "./composables/useTheme";
import { appMenus } from "./config/menus";

const {
  markdown,
  currentFilePath,
  isUntitled,
  isSourceMode,
  selection,
  dirty,
  openFile,
  newFile,
  saveFileAs,
  saveFile,
  closeFile,
  resetExample,
  clearContent,
  toggleMode,
} = useWorkspace();

const {
  isMaximized,
  startDrag,
  startResize,
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow,
  initWindowState,
} = useWindowChrome();

const { themeMode, setThemeMode } = useTheme();

const openMenuId = ref<string | null>(null);
const contextMenu = ref<{ x: number; y: number; items: FluentMenuItem[] } | null>(null);
const muyaEditor = ref<Muya | null>(null);

const menus = computed(() => appMenus.map((menu) => {
  if (menu.id !== "theme") return menu;

  return {
    ...menu,
    items: menu.items.map((item) => ({
      ...item,
      checked: item.id === "theme-light"
        ? themeMode.value === "light"
        : item.id === "theme-dark"
          ? themeMode.value === "dark"
          : themeMode.value === "system",
    })),
  };
}));

const pathText = computed(() => {
  if (currentFilePath.value) {
    const parts = currentFilePath.value.split(/[\\/]/);
    return parts[parts.length - 1] || currentFilePath.value;
  }
  return isUntitled.value ? "未命名" : "未打开文件";
});

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
    case "theme-light":
      setThemeMode("light");
      break;
    case "theme-dark":
      setThemeMode("dark");
      break;
    case "theme-system":
      setThemeMode("system");
      break;
    case "devtools":
      void invoke("open_devtools").catch((error) => {
        console.error("Failed to open devtools:", error);
      });
      break;
    case "about":
      console.log("MarkNext - WYSIWYG Markdown editor built with Tauri 2 + Vue 3");
      break;
    default:
      break;
  }
}

function editorContextMenuItems(): FluentMenuItem[] {
  return [
    { id: "undo", label: "撤销", shortcut: "Ctrl+Z" },
    { id: "redo", label: "重做", shortcut: "Ctrl+Y" },
    { separator: true },
    { id: "cut", label: "剪切", shortcut: "Ctrl+X" },
    { id: "copy", label: "复制", shortcut: "Ctrl+C" },
    { id: "paste", label: "粘贴", shortcut: "Ctrl+V" },
    { separator: true },
    { id: "selectAll", label: "全选", shortcut: "Ctrl+A" },
  ];
}

function appContextMenuItems(): FluentMenuItem[] {
  return [
    { id: "new", label: "新建" },
    { id: "open", label: "打开..." },
    { id: "save", label: "保存", shortcut: "Ctrl+S" },
    { id: "saveAs", label: "另存为..." },
    { id: "close", label: "关闭" },
    { separator: true },
    { id: "toggleMode", label: isSourceMode.value ? "所见即所得" : "源码模式" },
    { separator: true },
    { id: "about", label: "关于 MarkNext" },
  ];
}

function handleContextMenu(event: MouseEvent) {
  event.preventDefault();
  const target = event.target as HTMLElement | null;
  const inEditor = !!target?.closest(".editor-area");
  contextMenu.value = {
    x: event.clientX,
    y: event.clientY,
    items: inEditor ? editorContextMenuItems() : appContextMenuItems(),
  };
}

function runContextCommand(itemId: string) {
  switch (itemId) {
    case "undo":
      document.execCommand("undo");
      break;
    case "redo":
      document.execCommand("redo");
      break;
    case "cut":
      document.execCommand("cut");
      break;
    case "copy":
      document.execCommand("copy");
      break;
    case "paste":
      document.execCommand("paste");
      break;
    case "selectAll":
      if (!isSourceMode.value && muyaEditor.value) {
        muyaEditor.value.selectAllDocument();
      }
      else {
        document.execCommand("selectAll");
      }
      break;
    default:
      runMenuCommand(itemId);
      break;
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
});
</script>

<template>
  <div class="app-shell" @contextmenu="handleContextMenu">
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

    <TitleBar
      :dirty="dirty"
      :path-text="pathText"
      :is-maximized="isMaximized"
      @drag="startDrag"
      @minimize="minimizeWindow"
      @toggle-maximize="toggleMaximizeWindow"
      @close="closeWindow"
    />

    <MenuBar
      :menus="menus"
      :open-menu-id="openMenuId"
      :is-source-mode="isSourceMode"
      @toggle="toggleMenu"
      @command="runMenuCommand"
    />

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
        @ready="muyaEditor = $event"
      />
      <SourceEditor v-else v-model="markdown" />
    </main>

    <StatusBar
      :is-source-mode="isSourceMode"
      :current-file-path="currentFilePath"
      :is-untitled="isUntitled"
      :selection="selection"
    />

    <FluentContextMenu
      v-if="contextMenu"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :items="contextMenu.items"
      @select="runContextCommand"
      @close="contextMenu = null"
    />
  </div>
</template>