<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import ShortcutPane from "./ShortcutPane.vue";
import { cloneBindings, type ShortcutBindings } from "../config/shortcuts";
import { codeFonts, defaultPreferences, editorFonts, fileEncodings, fontStack, type Preferences, type SettingsCategory } from "../config/preferences";
import { t, supportedLanguages, detectLocale, type MessageKey } from "../i18n";

const props = withDefaults(defineProps<{
  preferences: Preferences;
  bindings: ShortcutBindings;
  defaults: ShortcutBindings;
  initialCategory?: SettingsCategory;
  save: (preferences: Preferences, bindings: ShortcutBindings) => string | null;
}>(), { initialCategory: "appearance" });
const emit = defineEmits<{ (e: "close"): void }>();
const category = ref<SettingsCategory>(props.initialCategory);
const draft = ref({ ...props.preferences });
const bindings = ref(cloneBindings(props.bindings));
const recording = ref(false);
const error = ref("");
const dialog = ref<HTMLElement | null>(null);
const shortcutPane = ref<InstanceType<typeof ShortcutPane> | null>(null);
const previousFocus = document.activeElement as HTMLElement | null;
const categories: { id: SettingsCategory; label: MessageKey; icon: string }[] = [
  { id: "appearance", label: "settings.appearance", icon: "M12 3a9 9 0 1 0 0 18h1a3 3 0 0 0 0-6h-1a2 2 0 0 1 0-4h4a5 5 0 0 0 0-8h-4Z M7 8h.01 M7 13h.01 M12 6h.01" },
  { id: "editor", label: "settings.editor", icon: "m4 20 5-16 5 16 M6 14h6 M16 11h4 M20 11v9 M20 15c-6-3-6 7 0 3" },
  { id: "files", label: "settings.files", icon: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z M14 3v6h6 M8 13h8 M8 17h6" },
  { id: "shortcuts", label: "settings.shortcuts", icon: "M4 6h16a2 2 0 0 1 2 2v10H2V8a2 2 0 0 1 2-2Z M5 10h.01 M9 10h.01 M13 10h.01 M17 10h.01 M5 14h.01 M9 14h8" },
];
const heading = computed(() => t(categories.find(item => item.id === category.value)!.label));
const previewStyle = computed(() => ({ fontFamily: fontStack(draft.value.editorFont), fontSize: `${draft.value.editorFontSize}px` }));

function selectCategory(value: SettingsCategory) {
  category.value = value;
  recording.value = false;
  shortcutPane.value?.cancelRecording();
  error.value = "";
}
function navigateCategories(event: KeyboardEvent) {
  const current = categories.findIndex(item => item.id === category.value);
  const index = event.key === "ArrowDown" ? (current + 1) % categories.length
    : event.key === "ArrowUp" ? (current + categories.length - 1) % categories.length
      : event.key === "Home" ? 0 : event.key === "End" ? categories.length - 1 : -1;
  if (index < 0) return;
  event.preventDefault();
  selectCategory(categories[index].id);
  void nextTick(() => document.getElementById(`settings-tab-${categories[index].id}`)?.focus());
}
function restoreCategory() {
  switch (category.value) {
    case "appearance": draft.value.language = detectLocale(navigator.languages ?? [navigator.language]); draft.value.zoom = defaultPreferences.zoom; break;
    case "editor": draft.value.editorFont = defaultPreferences.editorFont; draft.value.editorFontSize = defaultPreferences.editorFontSize; draft.value.codeFont = defaultPreferences.codeFont; break;
    case "files": draft.value.defaultEncoding = defaultPreferences.defaultEncoding; break;
    case "shortcuts": shortcutPane.value?.restoreAll(); break;
  }
  error.value = "";
}
function chooseFont(event: Event, field: "editorFont" | "codeFont") {
  const value = (event.target as HTMLSelectElement).value;
  draft.value[field] = value === "custom" ? "" : value;
}
function apply() {
  error.value = props.save({ ...draft.value }, bindings.value) ?? "";
  if (!error.value) emit("close");
}
function handleKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Escape" && !recording.value) {
    event.preventDefault(); event.stopPropagation(); emit("close"); return;
  }
  if (event.key !== "Tab") return;
  const controls = [...(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? [])]
    .filter(element => element.getClientRects().length > 0);
  const first = controls[0], last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
onMounted(async () => {
  await nextTick();
  if (category.value !== "shortcuts") dialog.value?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
});
onBeforeUnmount(() => { if (previousFocus?.isConnected) previousFocus.focus(); });
</script>

<template>
  <div class="settings-backdrop" @click.self="emit('close')">
    <section ref="dialog" class="settings-dialog ui-controls" role="dialog" aria-modal="true" aria-labelledby="settings-title" @keydown.capture="handleKeydown">
      <header class="settings-header">
        <h2 id="settings-title">{{ t('settings.title') }}</h2>
        <button class="settings-close window-btn close" type="button" :aria-label="t('settings.close')" @click="emit('close')">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1" />
          </svg>
        </button>
      </header>
      <div class="settings-body">
        <nav class="settings-sidebar ui-scroll-region" role="tablist" aria-orientation="vertical" :aria-label="t('settings.categories')" @keydown="navigateCategories">
          <button v-for="item in categories" :id="`settings-tab-${item.id}`" :key="item.id" type="button" role="tab" :tabindex="category === item.id ? 0 : -1" :aria-selected="category === item.id" :aria-controls="`settings-panel-${item.id}`" :title="t(item.label)" @click="selectCategory(item.id)">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path :d="item.icon" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
            <span>{{ t(item.label) }}</span>
          </button>
        </nav>
        <div class="settings-main">
          <h3>{{ heading }}</h3>
          <section v-show="category === 'appearance'" id="settings-panel-appearance" role="tabpanel" aria-labelledby="settings-tab-appearance" class="settings-panel ui-scroll-region">
            <p class="settings-description">{{ t('settings.appearanceDescription') }}</p>
            <div class="settings-card">
              <div class="settings-row"><div><label for="settings-language">{{ t('settings.language') }}</label><p>{{ t('settings.languageDescription') }}</p></div><select id="settings-language" v-model="draft.language"><option v-for="language in supportedLanguages" :key="language.id" :value="language.id">{{ language.label }}</option></select></div>
              <div class="settings-row"><div><label for="settings-zoom">{{ t('settings.zoom') }}</label><p>{{ t('settings.zoomDescription') }}</p></div><div class="settings-number"><input id="settings-zoom" v-model.number="draft.zoom" type="number" min="75" max="200" step="5" /><span>%</span></div></div>
            </div>
          </section>
          <section v-show="category === 'editor'" id="settings-panel-editor" role="tabpanel" aria-labelledby="settings-tab-editor" class="settings-panel ui-scroll-region">
            <p class="settings-description">{{ t('settings.editorDescription') }}</p>
            <div class="settings-card">
              <div class="settings-row"><div><label for="settings-editor-font">{{ t('settings.editorFont') }}</label><p>{{ t('settings.editorFontDescription') }}</p></div><div class="settings-control"><select id="settings-editor-font" :value="editorFonts.includes(draft.editorFont) ? draft.editorFont : 'custom'" @change="chooseFont($event, 'editorFont')"><option v-for="font in editorFonts" :key="font" :value="font">{{ font === 'system' ? t('settings.systemFont') : font }}</option><option value="custom">{{ t('settings.customFont') }}</option></select><input v-if="!editorFonts.includes(draft.editorFont)" v-model="draft.editorFont" :aria-label="t('settings.customEditorFont')" type="text" maxlength="100" /></div></div>
              <div class="settings-row"><div><label for="settings-font-size">{{ t('settings.editorFontSize') }}</label></div><div class="settings-number"><input id="settings-font-size" v-model.number="draft.editorFontSize" type="number" min="12" max="40" /><span>px</span></div></div>
              <div class="settings-row"><div><label for="settings-code-font">{{ t('settings.codeFont') }}</label><p>{{ t('settings.codeFontDescription') }}</p></div><div class="settings-control"><select id="settings-code-font" :value="codeFonts.includes(draft.codeFont) ? draft.codeFont : 'custom'" @change="chooseFont($event, 'codeFont')"><option v-for="font in codeFonts" :key="font" :value="font">{{ font === 'monospace' ? t('settings.monospaceFont') : font }}</option><option value="custom">{{ t('settings.customFont') }}</option></select><input v-if="!codeFonts.includes(draft.codeFont)" v-model="draft.codeFont" :aria-label="t('settings.customCodeFont')" type="text" maxlength="100" /></div></div>
            </div>
            <div class="settings-preview" :style="previewStyle"><h4>{{ t('settings.fontPreview') }}</h4><p>{{ t('settings.previewText') }}</p><pre :style="{ fontFamily: fontStack(draft.codeFont, true) }"><span class="preview-keyword">const</span> editor = <span class="preview-string">"MarkNext"</span>;
<span class="preview-comment">// Markdown · 0123456789</span></pre></div>
          </section>
          <section v-show="category === 'files'" id="settings-panel-files" role="tabpanel" aria-labelledby="settings-tab-files" class="settings-panel ui-scroll-region">
            <p class="settings-description">{{ t('settings.filesDescription') }}</p>
            <div class="settings-card"><div class="settings-row"><div><label for="settings-encoding">{{ t('settings.defaultEncoding') }}</label></div><select id="settings-encoding" v-model="draft.defaultEncoding"><option v-for="encoding in fileEncodings" :key="encoding" :value="encoding">{{ t(`settings.encoding.${encoding}`) }}</option></select></div></div>
            <p class="settings-note">{{ t('settings.encodingDescription') }}</p>
          </section>
          <section v-show="category === 'shortcuts'" id="settings-panel-shortcuts" role="tabpanel" aria-labelledby="settings-tab-shortcuts" class="settings-panel settings-shortcuts ui-scroll-region">
            <ShortcutPane ref="shortcutPane" v-model:bindings="bindings" :defaults="defaults" :active="category === 'shortcuts'" @recording="recording = $event" />
          </section>
        </div>
      </div>
      <footer class="settings-footer">
        <div><p v-if="error" class="settings-error" role="alert">{{ error }}</p><p v-else class="settings-description">{{ t('settings.applyHint') }}</p><button type="button" class="settings-restore" :title="t('settings.restoreCategory')" @click="restoreCategory"><span>{{ t('settings.restoreCategory') }}</span></button></div>
        <button type="button" @click="emit('close')">{{ t('settings.cancel') }}</button><button type="button" class="settings-apply" :disabled="recording" @click="apply">{{ t('settings.apply') }}</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.settings-backdrop {
  position: fixed;
  left: 0;
  top: 0;
  width: var(--app-viewport-width, 100vw);
  height: var(--app-viewport-height, 100vh);
  z-index: 2000;
  display: grid;
  grid-template: minmax(0, 1fr) / minmax(0, 1fr);
  place-items: center;
  padding: 24px;
  background: #0006;
  user-select: none;
  -webkit-user-select: none;
}

.settings-dialog {
  width: 920px;
  max-width: 100%;
  height: min(620px, 100%);
  min-height: 0;
  container-type: inline-size;
  display: grid;
  grid-template-rows: 48px minmax(0, 1fr) auto;
  color: var(--fluent-menu-fg);
  background: var(--fluent-menu-bg);
  border: 1px solid var(--fluent-menu-border);
  border-radius: var(--fluent-menu-radius);
  box-shadow: var(--fluent-menu-shadow);
  overflow: hidden;
  font-family: var(--app-ui-font-family);
  font-size: var(--app-ui-font-size);
  line-height: var(--app-ui-control-line-height);
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  padding-left: 16px;
  color: var(--app-titlebar-fg);
  background: var(--app-titlebar-bg);
  border-bottom: 1px solid var(--app-menubar-border);
}

h2, h3, h4, p { margin: 0; }
h2 { font-size: inherit; font-weight: 600; }
h3 { font-size: 14px; font-weight: 600; margin-bottom: 12px; }

.settings-description, .settings-row p, .settings-note {
  color: var(--app-footer-fg);
  font-size: 12px;
  line-height: 1.6;
}

.settings-body {
  display: grid;
  grid-template-columns: 164px minmax(0, 1fr);
  min-height: 0;
}

.settings-sidebar {
  padding: 8px 4px;
  color: var(--app-menubar-fg);
  background: var(--app-menubar-bg);
  border-right: 1px solid var(--app-menubar-border);
}

.settings-sidebar button {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  width: 100%;
  padding-inline: 10px;
  margin-bottom: 2px;
  border: 0;
  background: transparent;
  text-align: left;
}

.settings-sidebar svg { flex-shrink: 0; }
.settings-sidebar span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.settings-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 16px 20px;
  overflow: hidden;
}

.settings-panel { min-height: 0; }
.settings-description { margin-bottom: 12px; }
.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
}

.settings-row + .settings-row { border-top: 1px solid var(--fluent-menu-separator); }
.settings-row > div:first-child { flex: 1; min-width: 0; }
label { display: block; }
.settings-row p { margin-top: 2px; }
.settings-control { display: flex; flex-direction: column; gap: 6px; width: 210px; }
button, input, select { color: inherit; }
button {
  padding-inline: 12px;
  border: 1px solid var(--fluent-menu-border);
  border-radius: var(--app-ui-control-radius);
  background: transparent;
  cursor: pointer;
}

button:where(:not(.window-btn)):hover:not(:disabled) { background: var(--fluent-menu-item-hover); }
button:where(:not(.window-btn)):active:not(:disabled) { background: var(--fluent-menu-item-active); }
button:disabled { color: var(--fluent-menu-disabled); cursor: default; }
.settings-sidebar button[aria-selected="true"] {
  color: var(--fluent-menu-fg);
  background: var(--fluent-menu-item-active);
  font-weight: 600;
}

button:focus-visible, input:focus-visible, select:focus-visible {
  outline: 1px solid var(--app-ui-focus-color);
  outline-offset: -1px;
}

.settings-close {
  --ui-control-height: 48px;
  width: 46px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  flex-shrink: 0;
}

input, select {
  border: 1px solid var(--fluent-menu-border);
  border-radius: var(--app-ui-control-radius);
  background: var(--fluent-menu-bg);
  user-select: text;
  -webkit-user-select: text;
}

select { width: 210px; flex-shrink: 0; max-width: 100%; }
.settings-control input { width: 100%; }
.settings-number { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.settings-number input { width: 84px; }
.settings-preview {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--fluent-menu-border);
  border-radius: var(--app-ui-control-radius);
  background: var(--editor-bg);
  color: var(--editor-color);
}

.settings-preview h4 {
  margin-bottom: 8px;
  color: var(--app-footer-fg);
  font: 400 12px/1.6 var(--app-ui-font-family);
}

.settings-preview pre {
  font-size: .9em;
  white-space: pre-wrap;
  margin: 8px 0 0;
  padding-top: 8px;
  border-top: 1px solid var(--fluent-menu-separator);
}

.preview-keyword { color: var(--editor-color); font-weight: 600; }
.preview-string { color: var(--editor-color); }
.preview-comment { color: var(--app-footer-fg); }
.settings-note { margin-top: 12px; }
.settings-shortcuts { flex: 1; }
.settings-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  color: var(--app-menubar-fg);
  background: var(--app-menubar-bg);
  border-top: 1px solid var(--app-menubar-border);
}

.settings-footer > div { flex: 1; min-width: 0; }
.settings-footer .settings-description { margin: 0 0 2px; }
.settings-footer > button { min-width: 64px; }
.settings-restore { --ui-control-height: var(--app-ui-control-compact-height); --ui-control-font-size: 12px; max-width: 100%; padding-inline: 4px; margin-left: -4px; border: 0; justify-content: flex-start; text-align: left; }
.settings-restore span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.settings-apply { background: var(--fluent-menu-item-active); font-weight: 600; }
.settings-error { color: var(--app-ui-error-color); font-size: 12px; }

@media (max-width: 700px) { .settings-backdrop { padding: 12px; } }
@container (max-width: 700px) {
  .settings-body { grid-template-columns: 104px minmax(0, 1fr); }
  .settings-main { padding: 12px; }
  .settings-row { flex-wrap: wrap; gap: 8px; }
  .settings-control, .settings-row > select { width: 100%; }
  .settings-footer { padding: 8px 12px; flex-wrap: wrap; }
  .settings-sidebar button { padding-inline: 6px; gap: 6px; }
  .settings-footer > div { flex-basis: 100%; }
}

@media (max-height: 600px) {
  .settings-footer > div > .settings-description { display: none; }
  .settings-main { padding: 8px 12px; }
  h3 { margin-bottom: 8px; }
  .settings-footer { padding: 8px 12px; }
  .settings-footer > div { flex-basis: auto; }
  .settings-description { margin-bottom: 8px; }
}
</style>
