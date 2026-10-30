<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type EditorSessionComponent from "./components/EditorSession.vue";
import TitleBar from "./components/TitleBar.vue";
import MenuBar from "./components/MenuBar.vue";
import StatusBar from "./components/StatusBar.vue";
import DocumentOutline from "./components/DocumentOutline.vue";
import FluentContextMenu from "./components/FluentContextMenu.vue";
import SettingsDialog from "./components/SettingsDialog.vue";
import RecoveryDialog from "./components/RecoveryDialog.vue";
import { fontStack, type Preferences, type SettingsCategory } from "./config/preferences";
import { cloneBindings, resolveShortcut, type ShortcutBindings } from "./config/shortcuts";
import { usePreferences } from "./composables/usePreferences";
import type { FluentMenuItem } from "./components/fluentMenu";
import type { Muya, IMuyaOptions } from "./muya";
import { useDocumentTabs } from "./composables/useDocumentTabs";
import { useNativeFileRequests } from "./composables/useNativeFileRequests";
import DocumentTabs from "./components/DocumentTabs.vue";
import { useDocumentAnalysis } from "./composables/useDocumentAnalysis";
import type { OutlineHeading } from "./services/documentAnalysis";
import type { RecoverySnapshot, RecoveryView } from "./document/types";
import { useWindowChrome } from "./composables/useWindowChrome";
import { useTheme } from "./composables/useTheme";
import { useShortcuts } from "./composables/useShortcuts";
import { createShortcutHandler } from "./services/shortcutHandler";
import { readClipboardData } from "./services/clipboard";
import { showError, askDiscardRecovery } from "./services/dialogs";
import { t, useI18n } from "./i18n";
import { appMenus } from "./config/menus";
import type { IHistorySelection } from "./muya/selection/types";

const { locale } = useI18n();
const { preferences, save: savePreferences } = usePreferences();
const EditorSession = shallowRef<typeof EditorSessionComponent | null>(null);
let editorLoading: Promise<void> | null = null;
function prepareEditor(): Promise<void> {
  if (EditorSession.value) return Promise.resolve();
  return editorLoading ??= import("./components/EditorSession.vue").then(module => {
    EditorSession.value = module.default;
  }).finally(() => { editorLoading = null; });
}
const documentTabs = useDocumentTabs(() => preferences.value.defaultEncoding, {
  editor: () => editorSessionRef.value,
  prepareEditor,
  getView: captureView,
  applyView,
  closeWindow: async () => {
    try {
      if (!(await recovery.prepareExit())) throw new Error(t("recovery.cleanupError"));
      await destroyWindow();
    }
    catch (error) { recovery.resume(); await recovery.flush(); throw error; }
  },
});
const workspace = documentTabs.workspace;
const {
  markdown,
  currentFilePath,
  isUntitled,
  isSourceMode,
  documentGeneration,
  selection,
  dirty,
} = workspace;
const { analysis, refresh: refreshAnalysis } = useDocumentAnalysis(markdown, documentGeneration);
const outlineOpen = ref(false);
const activeHeading = ref<string | null>(null);

watch(markdown, () => { activeHeading.value = null; });
watch(outlineOpen, () => { void nextTick(() => window.dispatchEvent(new Event("resize"))); });

function closeOutline() {
  outlineOpen.value = false;
  void nextTick(() => document.getElementById("outline-toggle")?.focus());
}

function navigateOutline(heading: OutlineHeading) {
  flushEditor();
  const target = refreshAnalysis().headings.find(item => item.id === heading.id && item.text === heading.text);
  if (!target) return;
  if (isSourceMode.value) sourceEditorRef.value?.goToLine(target.line);
  else {
    const muya = muyaEditor.value;
    if (!muya?.editor.scrollPage) return;
    let index = 0;
    for (const block of muya.editor.scrollPage.children.iterator()) {
      if (block.blockName !== "atx-heading" && block.blockName !== "setext-heading") continue;
      if (index++ !== target.index || !block.isParent()) continue;
      const content = block.firstContentInDescendant();
      if (!content) return;
      muya.focus();
      const offset = block.blockName === "atx-heading" ? Math.min(target.level + 1, content.text.length) : 0;
      content.setCursor(offset, offset, true);
      block.domNode?.scrollIntoView({ block: "center", inline: "nearest" });
      break;
    }
  }
  activeHeading.value = target.id;
}

const {
  isMaximized,
  startDrag,
  startResize,
  minimizeWindow,
  toggleMaximizeWindow,
  destroyWindow,
  initWindowState,
} = useWindowChrome();

const { themeMode, setThemeMode } = useTheme();
const { bindings: shortcutBindings, defaults: defaultBindings, label: commandShortcut } = useShortcuts();
const settingsOpen = ref(false);
const recoveryOpen = ref(false);
const recoveryBusy = ref(false);
const { externalChange, recoveredCopy } = workspace;
const settingsCategory = ref<SettingsCategory>("appearance");
const editorAppearance = computed<Partial<IMuyaOptions>>(previous => {
  const next = {
    fontSize: preferences.value.editorFontSize,
    editorFontFamily: fontStack(preferences.value.editorFont),
    codeFontFamily: fontStack(preferences.value.codeFont, true),
  };
  return previous?.fontSize === next.fontSize && previous.editorFontFamily === next.editorFontFamily
    && previous.codeFontFamily === next.codeFontFamily ? previous : next;
});

function applySettings(value: Preferences, bindings: ShortcutBindings): string | null {
  const error = savePreferences(value, bindings);
  if (!error) shortcutBindings.value = cloneBindings(bindings);
  return error;
}

function updateViewportSize() {
  const scale = preferences.value.zoom / 100;
  // Chromium and WebKit resolve viewport units differently under root zoom.
  // Give fixed overlays the same explicit logical viewport in both engines.
  document.documentElement.style.setProperty("--app-viewport-width", `${window.innerWidth / scale}px`);
  document.documentElement.style.setProperty("--app-viewport-height", `${window.innerHeight / scale}px`);
}

watch([
  () => preferences.value.editorFont, () => preferences.value.editorFontSize,
  () => preferences.value.codeFont, () => preferences.value.zoom,
], ([editorFont, editorFontSize, codeFont, zoom]) => {
  const root = document.documentElement;
  root.style.setProperty("--mu-font-family", fontStack(editorFont));
  root.style.setProperty("--mu-font-size", `${editorFontSize}px`);
  root.style.setProperty("--mu-code-font-family", fontStack(codeFont, true));
  root.style.setProperty("--app-code-font-family", fontStack(codeFont, true));
  root.style.setProperty("--app-ui-zoom", String(zoom / 100));
  updateViewportSize();
  void nextTick(() => window.dispatchEvent(new Event("resize")));
}, { immediate: true });

const openMenuId = ref<string | null>(null);
const contextMenu = ref<{ x: number; y: number; items: FluentMenuItem[]; tabId?: string } | null>(null);
const muyaEditor = shallowRef<Muya | null>(null);
const editorSessionRef = ref<InstanceType<typeof EditorSessionComponent> | null>(null);
const sourceEditorRef = computed(() => editorSessionRef.value?.getSource() ?? null);
const editorIdentity = documentTabs.identity;
const editorCheckpoint = documentTabs.checkpoint;

function flushEditor() { editorSessionRef.value?.flush(); }
const documentActions = documentTabs.actions;
const recovery = documentTabs.recovery;
const nativeFiles = useNativeFileRequests(async paths => {
  const done = await documentTabs.openPaths(paths);
  if (done && paths.length) { focusEditor(); await checkDisk(); }
  return done;
});

function focusEditor() {
  if (isSourceMode.value) sourceEditorRef.value?.focus(); else muyaEditor.value?.focus();
}
async function activateTab(id: string, focus = true) {
  if (await documentTabs.activate(id)) { if (focus) focusEditor(); await checkDisk(); }
}
async function closeTab(id: string) {
  if (await documentTabs.close(id)) { focusEditor(); await checkDisk(); }
}

function captureView(): RecoveryView {
  return isSourceMode.value
    ? { scrollTop: sourceEditorRef.value?.getScrollTop() ?? 0, sourceCursor: sourceEditorRef.value?.getCursorOffset() ?? undefined }
    : { scrollTop: muyaEditor.value?.domNode.parentElement?.scrollTop ?? 0, muyaSelection: captureMuyaSelection() ?? undefined };
}

function applyView(view: RecoveryView | null | undefined, sourceMode: boolean) {
  // View metadata is best-effort. Invalid/stale cursor paths must never prevent
  // recovering the document's text or reloading a changed disk file.
  try {
    if (sourceMode) {
      sourceEditorRef.value?.setCursorOffset(view?.sourceCursor ?? null);
      sourceEditorRef.value?.setScrollTop(view?.scrollTop ?? 0);
    }
    else if (muyaEditor.value) {
      const selection = view?.muyaSelection;
      if (selection) muyaEditor.value.setCursor({ anchor: selection.anchor, anchorPath: selection.anchor.path, focus: selection.focus, focusPath: selection.focus.path });
      const scrollHost = muyaEditor.value.domNode.parentElement;
      if (scrollHost) scrollHost.scrollTop = view?.scrollTop ?? 0;
    }
  }
  catch { /* Content has already been restored; use the editor's default view. */ }
}

async function reloadDocument(reviewExternal = false) {
  const sourceMode = isSourceMode.value;
  const view = captureView();
  const generation = documentGeneration.value;
  const done = reviewExternal ? await documentActions.reviewExternalChange() : await documentActions.run("reload");
  if (!done || documentGeneration.value !== generation + 1) return;
  if (sourceMode) isSourceMode.value = true;
  await nextTick();
  if (documentGeneration.value === generation + 1) applyView(view, sourceMode);
}

async function restoreDocument(record: RecoverySnapshot) {
  if (recoveryBusy.value) return;
  recoveryBusy.value = true;
  try {
    if (!(await documentActions.restore(record))) return;
    await nextTick();
    // Persist the new session before retiring the recovered record. A failed
    // backup keeps the original recovery record available on the next launch.
    if (await recovery.flush()) await recovery.remove(record.id);
    recoveryOpen.value = false;
    await nextTick();
    focusEditor();
  }
  finally { recoveryBusy.value = false; }
}

async function discardRecovery(record: RecoverySnapshot) {
  if (recoveryBusy.value) return;
  recoveryBusy.value = true;
  try { if (await askDiscardRecovery()) await recovery.remove(record.id); }
  finally { recoveryBusy.value = false; }
}

let safetyTimer: ReturnType<typeof setInterval> | undefined;
let checkingDisk = false;
async function checkDisk() {
  if (checkingDisk || document.hidden || documentActions.isPending()) return;
  checkingDisk = true;
  try {
    flushEditor();
    const changed = await workspace.checkExternalChange();
    if (changed && !settingsOpen.value && !recoveryOpen.value) await reloadDocument(true);
  }
  finally { checkingDisk = false; }
}
function handleVisibility() {
  if (document.hidden) void recovery.flush();
  else void checkDisk();
}

function captureMuyaSelection(): IHistorySelection | null {
  const selection = muyaEditor.value?.getSelection();
  if (!selection?.anchor || !selection.focus) return null;
  return {
    anchor: { offset: selection.anchor.offset, path: [...selection.anchor.path] },
    focus: { offset: selection.focus.offset, path: [...selection.focus.path] },
    isCollapsed: selection.isCollapsed,
    isSelectionInSameBlock: selection.isSelectionInSameBlock,
    direction: selection.direction,
    type: selection.type,
  };
}

watch(documentGeneration, () => {
  activeHeading.value = null;
  muyaEditor.value = null;
}, { flush: "sync" });

async function toggleEditorMode() {
  if (!isSourceMode.value && !isUntitled.value && !currentFilePath.value && !markdown.value) {
    if (!(await documentActions.run("new"))) return;
    await nextTick();
  }
  await editorSessionRef.value?.toggleMode();
}

const searchOpen = ref(false);
const replaceOpen = ref(false);
const searchQuery = ref("");
const replaceQuery = ref("");
const searchInputRef = ref<HTMLInputElement | null>(null);
const replaceInputRef = ref<HTMLInputElement | null>(null);

const menus = computed(() => appMenus.map((menu) => {
  return {
    ...menu,
    label: t(menu.label),
    items: menu.items.map((item) => ({
      ...item,
      label: t(item.label),
      shortcut: commandShortcut(item.id),
      disabled: item.disabled || documentTabs.busy.value || (!documentTabs.active.value && ["save", "saveAs", "saveAll", "close", "closeAll"].includes(item.id)),
      checked: menu.id !== "theme" ? item.checked : item.id === "theme-light"
        ? themeMode.value === "light"
        : item.id === "theme-dark"
          ? themeMode.value === "dark"
          : themeMode.value === "system",
    })),
  };
}));

const pathText = documentTabs.title;

function toggleMenu(menuId: string) {
  openMenuId.value = openMenuId.value === menuId ? null : menuId;
}

function runMenuCommand(itemId: string) {
  if (documentTabs.busy.value) return;
  openMenuId.value = null;

  switch (itemId) {
    case "new":
    case "open":
    case "save":
    case "saveAs":
    case "saveAll":
    case "closeAll":
    case "nextTab":
    case "previousTab":
    case "close":
    case "exit":
    case "overwrite":
      void documentActions.run(itemId).then((done) => {
        if (done) { void nextTick(focusEditor); void checkDisk(); }
      });
      break;
    case "reload":
      void reloadDocument();
      break;
    case "recovery":
      recoveryOpen.value = true;
      break;
    case "settings":
    case "shortcuts":
      contextMenu.value = null;
      settingsCategory.value = itemId === "shortcuts" ? "shortcuts" : "appearance";
      settingsOpen.value = true;
      break;
    case "undo":
      editorUndo();
      break;
    case "redo":
      editorRedo();
      break;
    case "cut":
      document.execCommand("cut");
      break;
    case "copy":
      document.execCommand("copy");
      break;
    case "paste":
      void pasteClipboard();
      break;
    case "find":
      openSearch(false);
      break;
    case "replace":
      openSearch(true);
      break;
    case "findNext":
      findInDocument(true);
      break;
    case "findPrevious":
      findInDocument(false);
      break;
    case "selectAll":
      selectAllDocument();
      break;
    case "toggleMode":
      void toggleEditorMode();
      break;
    case "clear":
      clearEditorContent();
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
      if (!import.meta.env.DEV) return;
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

function editorUndo() {
  try { editorSessionRef.value?.undo(); }
  catch (error) { console.error("Native undo failed:", error); }
}

async function pasteClipboard() {
  if (document.execCommand("paste")) return;
  const generation = documentGeneration.value;
  const sourceMode = isSourceMode.value;
  const muya = muyaEditor.value;
  try {
    const data = await readClipboardData();
    if (generation !== documentGeneration.value || sourceMode !== isSourceMode.value) return;
    if (sourceMode) sourceEditorRef.value?.pasteText(data.getData("text/plain"));
    else if (muya && muya === muyaEditor.value) {
      await muya.editor.clipboard.pasteHandler(new ClipboardEvent("paste", { clipboardData: data }));
    }
  }
  catch (error) {
    await showError(t("error.paste"), error);
  }
}

function editorRedo() {
  try { editorSessionRef.value?.redo(); }
  catch (error) { console.error("Native redo failed:", error); }
}

function selectAllDocument() {
  if (!isSourceMode.value && muyaEditor.value) {
    muyaEditor.value.selectAllDocument();
  }
  else if (isSourceMode.value) {
    sourceEditorRef.value?.selectAll();
  }
  else {
    document.execCommand("selectAll");
  }
}

function clearEditorContent() {
  if (isSourceMode.value) {
    sourceEditorRef.value?.clearUndoably();
    return;
  }
  const muya = muyaEditor.value;
  if (!muya || !markdown.value) return;
  muya.replaceContent("", captureMuyaSelection() ?? undefined);
}

function openSearch(isReplace = false) {
  searchOpen.value = true;
  replaceOpen.value = isReplace;
  void nextTick(() => {
    runSearch();
    if (isReplace) {
      replaceInputRef.value?.focus();
    }
    else {
      searchInputRef.value?.focus();
    }
  });
}

function closeSearch() {
  searchOpen.value = false;
  replaceOpen.value = false;
  sourceEditorRef.value?.search("");
  // Drop Muya's search highlights and restore caret to the active match.
  if (muyaEditor.value && !isSourceMode.value) {
    muyaEditor.value.search("", { selectHighlight: true });
  }
}

function runSearch() {
  const query = searchQuery.value;
  if (!isSourceMode.value && muyaEditor.value) {
    muyaEditor.value.flush();
    muyaEditor.value.search(query);
  }
  else sourceEditorRef.value?.search(query);
}

function findInDocument(forward = true) {
  const query = searchQuery.value;
  if (!query) return;
  if (!isSourceMode.value && muyaEditor.value) {
    muyaEditor.value.flush();
    if (muyaEditor.value.editor.searchModule.value !== query) {
      muyaEditor.value.search(query);
      if (!forward) muyaEditor.value.find("previous");
      return;
    }
    muyaEditor.value.find(forward ? "next" : "previous");
  }
  else {
    if (forward) sourceEditorRef.value?.findNext(query);
    else sourceEditorRef.value?.findPrev(query);
  }
}

function runReplace() {
  if (!searchQuery.value) return;
  if (isSourceMode.value) {
    sourceEditorRef.value?.replaceCurrent(searchQuery.value, replaceQuery.value);
  }
  else if (muyaEditor.value) {
    muyaEditor.value.flush();
    if (muyaEditor.value.editor.searchModule.value !== searchQuery.value) muyaEditor.value.search(searchQuery.value);
    muyaEditor.value.replace(replaceQuery.value, { isSingle: true, isRegexp: false });
  }
}

function runReplaceAll() {
  if (!searchQuery.value) return;
  if (isSourceMode.value) {
    sourceEditorRef.value?.replaceAll(searchQuery.value, replaceQuery.value);
  }
  else if (muyaEditor.value) {
    muyaEditor.value.flush();
    if (muyaEditor.value.editor.searchModule.value !== searchQuery.value) muyaEditor.value.search(searchQuery.value);
    muyaEditor.value.replace(replaceQuery.value, { isSingle: false, isRegexp: false });
  }
}

watch([documentGeneration, isSourceMode, muyaEditor], async () => {
  await nextTick();
  if (searchOpen.value) runSearch();
});

function editorContextMenuItems(): FluentMenuItem[] {
  return [
    { id: "undo", label: t("command.undo"), shortcut: commandShortcut("undo") },
    { id: "redo", label: t("command.redo"), shortcut: commandShortcut("redo") },
    { separator: true },
    { id: "cut", label: t("command.cut"), shortcut: commandShortcut("cut") },
    { id: "copy", label: t("command.copy"), shortcut: commandShortcut("copy") },
    { id: "paste", label: t("command.paste"), shortcut: commandShortcut("paste") },
    { separator: true },
    { id: "selectAll", label: t("command.selectAll"), shortcut: commandShortcut("selectAll") },
  ];
}

function appContextMenuItems(): FluentMenuItem[] {
  return [
    { id: "new", label: t("command.new"), shortcut: commandShortcut("new") },
    { id: "open", label: t("command.open"), shortcut: commandShortcut("open") },
    { id: "save", label: t("command.save"), shortcut: commandShortcut("save") },
    { id: "saveAs", label: t("command.saveAs"), shortcut: commandShortcut("saveAs") },
    { id: "close", label: t("command.close"), shortcut: commandShortcut("close") },
    { separator: true },
    { id: "toggleMode", label: t(isSourceMode.value ? "command.wysiwyg" : "command.toggleMode"), shortcut: commandShortcut("toggleMode") },
    { id: "settings", label: t("command.settings"), shortcut: commandShortcut("settings") },
    { id: "shortcuts", label: t("command.shortcuts"), shortcut: commandShortcut("shortcuts") },
    { separator: true },
    { id: "about", label: t("command.about") },
  ];
}

function tabContextMenuItems(): FluentMenuItem[] {
  return [
    { id: "tabClose", label: t("command.close"), shortcut: commandShortcut("close") },
    { id: "closeAll", label: t("command.closeAll"), shortcut: commandShortcut("closeAll") },
  ];
}

watch(locale, () => {
  if (contextMenu.value) {
    const editorMenu = contextMenu.value.items.some(item => item.id === "undo");
    contextMenu.value.items = contextMenu.value.tabId ? tabContextMenuItems() : editorMenu ? editorContextMenuItems() : appContextMenuItems();
  }
});

function handleContextMenu(event: MouseEvent) {
  event.preventDefault();
  if (documentTabs.busy.value) return;
  const target = event.target as HTMLElement | null;
  const tabId = target?.closest<HTMLElement>(".document-tab")?.dataset.tabId;
  const inEditor = !!target?.closest(".editor-area");
  contextMenu.value = {
    x: event.clientX / (preferences.value.zoom / 100),
    y: event.clientY / (preferences.value.zoom / 100),
    items: tabId ? tabContextMenuItems() : inEditor ? editorContextMenuItems() : appContextMenuItems(),
    tabId,
  };
}

function runContextCommand(itemId: string) {
  if (documentTabs.busy.value) return;
  if (itemId === "tabClose") {
    const id = contextMenu.value?.tabId;
    if (id) void closeTab(id);
    return;
  }
  switch (itemId) {
    case "undo":
      editorUndo();
      break;
    case "redo":
      editorRedo();
      break;
    case "cut":
      document.execCommand("cut");
      break;
    case "copy":
      document.execCommand("copy");
      break;
    case "paste":
      void pasteClipboard();
      break;
    case "selectAll":
      selectAllDocument();
      break;
    default:
      runMenuCommand(itemId);
      break;
  }
}

const handleShortcut = createShortcutHandler({
  bindings: () => shortcutBindings.value,
  defaults: defaultBindings,
  blocked: () => settingsOpen.value || recoveryOpen.value,
  execute: runMenuCommand,
});
function handleGlobalKeydown(event: KeyboardEvent) {
  if (documentTabs.busy.value) {
    if (resolveShortcut(event, shortcutBindings.value)) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
    return;
  }
  handleShortcut(event);
}

onMounted(() => {
  window.addEventListener("resize", updateViewportSize);
  window.addEventListener("keydown", handleGlobalKeydown, true);
  void initWindowState(() => documentActions.run("exit"));
  void recovery.start();
  window.addEventListener("focus", checkDisk);
  window.addEventListener("blur", recovery.flush);
  document.addEventListener("visibilitychange", handleVisibility);
  safetyTimer = setInterval(() => { void checkDisk(); }, 5000);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", updateViewportSize);
  window.removeEventListener("keydown", handleGlobalKeydown, true);
  window.removeEventListener("focus", checkDisk);
  window.removeEventListener("blur", recovery.flush);
  document.removeEventListener("visibilitychange", handleVisibility);
  clearInterval(safetyTimer);
  void recovery.flush();
  recovery.stop();
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
      @close="runMenuCommand('exit')"
    />

    <MenuBar
      :menus="menus"
      :open-menu-id="openMenuId"
      :is-source-mode="isSourceMode"
      @toggle="toggleMenu"
      @command="runMenuCommand"
    />

    <DocumentTabs :tabs="documentTabs.tabs.value" :active-id="documentTabs.active.value?.id ?? null"
      :busy="documentTabs.busy.value" @activate="activateTab" @close="closeTab" @new="runMenuCommand('new')" />

    <div v-if="openMenuId" class="menu-overlay" @click="openMenuId = null" />

    <div v-if="externalChange || recoveredCopy || recovery.failed.value || recovery.records.value.length || recovery.unreadable.value || nativeFiles.failed.value" class="document-notices ui-scroll-region">
      <div v-if="nativeFiles.failed.value" class="document-notice ui-controls" role="alert">
        <span>{{ t('tabs.nativeOpenError') }}</span>
        <button type="button" @click="nativeFiles.retry()">{{ t('recovery.retry') }}</button>
      </div>
      <div v-if="externalChange" class="document-notice ui-controls" role="status">
        <span>{{ t(`safety.${externalChange.kind}`) }}</span>
        <button v-if="externalChange.kind === 'changed'" type="button" @click="runMenuCommand('reload')">{{ t('safety.reload') }}</button>
        <button type="button" @click="runMenuCommand('saveAs')">{{ t('command.saveAs') }}</button>
        <button v-if="externalChange.version" type="button" @click="runMenuCommand('overwrite')">{{ t('safety.overwrite') }}</button>
      </div>
      <div v-if="recoveredCopy" class="document-notice ui-controls" role="status">
        <span>{{ t('recovery.copyNotice') }}</span>
      </div>
      <div v-if="recovery.failed.value" class="document-notice ui-controls" role="alert">
        <span>{{ t('recovery.storageError') }}</span>
        <button type="button" @click="recovery.start().then(() => recovery.flush())">{{ t('recovery.retry') }}</button>
      </div>
      <div v-if="recovery.records.value.length || recovery.unreadable.value" class="document-notice ui-controls" role="status">
        <span>{{ t('recovery.available', { count: recovery.records.value.length }) }}</span>
        <button type="button" @click="recoveryOpen = true">{{ t('recovery.review') }}</button>
      </div>
    </div>

    <div v-if="searchOpen" class="search-panel ui-controls" @keydown.esc="closeSearch">
      <div class="search-row">
        <input
          ref="searchInputRef"
          v-model="searchQuery"
          type="text"
          :placeholder="t('search.find')"
          spellcheck="false"
          @input="runSearch"
          @keydown.enter="findInDocument(true)"
        />
        <button type="button" :title="t('search.previous')" :aria-label="t('search.previous')" @click="findInDocument(false)"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 10V2M2.5 5.5 6 2l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
        <button type="button" :title="t('search.next')" :aria-label="t('search.next')" @click="findInDocument(true)"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2v8M2.5 6.5 6 10l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
        <button type="button" class="search-close" :aria-label="t('search.close')" @click="closeSearch"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1l8 8M9 1l-8 8" fill="none" stroke="currentColor" stroke-width="1" /></svg></button>
      </div>
      <div v-if="replaceOpen" class="search-row">
        <input
          ref="replaceInputRef"
          v-model="replaceQuery"
          type="text"
          :placeholder="t('search.replaceWith')"
          spellcheck="false"
          @keydown.enter="runReplace"
        />
        <button type="button" :disabled="!searchQuery || !muyaEditor" @click="runReplace">{{ t('search.replace') }}</button>
        <button type="button" :disabled="!searchQuery || !muyaEditor" @click="runReplaceAll">{{ t('search.replaceAll') }}</button>
      </div>
    </div>

    <div class="workspace-body">
      <DocumentOutline v-if="outlineOpen" :headings="analysis.headings" :active-id="activeHeading" @navigate="navigateOutline" @close="closeOutline" />
      <main id="document-panel" class="editor-area" :class="{ 'source-mode': isSourceMode }"
        :inert="documentTabs.locked.value"
        :role="documentTabs.active.value ? 'tabpanel' : undefined" :aria-labelledby="documentTabs.active.value ? `document-tab-${documentTabs.active.value.id}` : undefined">
        <div v-if="!isUntitled && !currentFilePath && !markdown" class="empty-state">
          <p>{{ t('document.empty') }}</p>
          <button type="button" class="primary-btn ui-control" @click="runMenuCommand('open')">{{ t('document.open') }}</button>
        </div>
        <component
          :is="EditorSession"
          v-else
          :key="documentGeneration"
          ref="editorSessionRef"
          :options="editorAppearance"
          :identity="editorIdentity"
          :checkpoint="editorCheckpoint"
          :document-path="currentFilePath"
          v-model="markdown"
          v-model:source-mode="isSourceMode"
          @selection-change="selection = $event"
          @ready="muyaEditor = $event"
          @error="showError(t('error.fileAction'), $event)"
        />
      </main>
    </div>

    <StatusBar
      :is-source-mode="isSourceMode"
      :current-file-path="currentFilePath"
      :is-untitled="isUntitled"
      :selection="selection"
      :statistics="analysis.statistics"
      :outline-open="outlineOpen"
      @toggle-outline="outlineOpen = !outlineOpen"
    />

    <FluentContextMenu
      v-if="contextMenu"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :items="contextMenu.items"
      @select="runContextCommand"
      @close="contextMenu = null"
    />
    <SettingsDialog
      v-if="settingsOpen"
      :preferences="preferences"
      :initial-category="settingsCategory"
      :bindings="shortcutBindings"
      :defaults="defaultBindings"
      :save="applySettings"
      @close="settingsOpen = false"
    />
    <RecoveryDialog
      v-if="recoveryOpen"
      :records="recovery.records.value"
      :unreadable="recovery.unreadable.value"
      :busy="recoveryBusy"
      @restore="restoreDocument"
      @discard="discardRecovery"
      @close="recoveryOpen = false"
    />
  </div>
</template>
