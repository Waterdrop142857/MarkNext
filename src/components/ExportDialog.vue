<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { defaultPdfOptions, pageDimensions, paperSizes, validPdfOptions, type PdfOptions } from "../export/pdfOptions";
import type { ExportSnapshot } from "../export/types";
import { exportPdf } from "../platform/tauri/pdfExport";
import { exportHtml } from "../platform/tauri/htmlExport";
import { t } from "../i18n";

const props = defineProps<{ snapshot: ExportSnapshot; format: "pdf" | "html" }>();
const emit = defineEmits<{ (event: "close"): void }>();
const dialog = ref<HTMLDialogElement | null>(null);
const options = ref<PdfOptions>({ ...defaultPdfOptions, margins: { ...defaultPdfOptions.margins } });
const busy = ref(false);
const error = ref("");
const valid = computed(() => validPdfOptions(options.value));
const dimensions = computed(() => pageDimensions(options.value));
const previousFocus = document.activeElement;
const sides = ["top", "bottom", "left", "right"] as const;
function close() { if (!busy.value) emit("close"); }
async function submit() {
  if (!valid.value || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const done = props.format === "html" ? await exportHtml(props.snapshot)
      : await exportPdf({ ...props.snapshot, options: { ...options.value, margins: { ...options.value.margins } } });
    if (done) emit("close");
  }
  catch (cause) { error.value = `${t(props.format === "html" ? "html.failed" : "pdf.failed")} ${String(cause)}`; }
  finally { busy.value = false; }
}
onMounted(() => dialog.value?.showModal());
onBeforeUnmount(() => {
  dialog.value?.close();
  if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
});
</script>

<template>
  <dialog ref="dialog" class="export-dialog ui-controls" aria-labelledby="export-title" :aria-busy="busy" @cancel.prevent="close" @click.self="close" @contextmenu.stop>
    <form @submit.prevent="submit">
      <header><h1 id="export-title">{{ t(format === 'html' ? 'html.title' : 'pdf.title') }}</h1><p>{{ snapshot.title }}</p></header>
      <fieldset v-if="format === 'pdf'" :disabled="busy" class="pdf-fields">
        <legend>{{ t('pdf.pageSetup') }}</legend>
        <label>{{ t('pdf.paper') }}
          <select v-model="options.paper" autofocus>
            <option v-for="(_, paper) in paperSizes" :key="paper" :value="paper">{{ paper === 'b5' ? 'ISO B5' : paper === 'letter' ? 'Letter' : paper.toUpperCase() }}</option>
            <option value="custom">{{ t('pdf.custom') }}</option>
          </select>
        </label>
        <label>{{ t('pdf.orientation') }}
          <select v-model="options.orientation"><option value="portrait">{{ t('pdf.portrait') }}</option><option value="landscape">{{ t('pdf.landscape') }}</option></select>
        </label>
        <template v-if="options.paper === 'custom'">
          <label>{{ t('pdf.width') }} (mm)<input v-model.number="options.width" type="number" min="50" max="2000" step="0.1" required /></label>
          <label>{{ t('pdf.height') }} (mm)<input v-model.number="options.height" type="number" min="50" max="2000" step="0.1" required /></label>
        </template>
      </fieldset>
      <fieldset v-if="format === 'pdf'" :disabled="busy" class="pdf-fields">
        <legend>{{ t('pdf.margins') }} (mm)</legend>
        <label v-for="side in sides" :key="side">{{ t(`pdf.${side}`) }}<input v-model.number="options.margins[side]" type="number" min="0" max="2000" step="0.1" required /></label>
      </fieldset>
      <p v-if="format === 'html'">{{ t('html.description') }}</p>
      <p v-if="format === 'pdf'" class="pdf-summary">{{ dimensions[0] }} × {{ dimensions[1] }} mm</p>
      <p v-if="format === 'pdf' && !valid" class="pdf-error" role="alert">{{ t('pdf.invalid') }}</p>
      <p v-if="error" class="pdf-error" role="alert">{{ error }}</p>
      <p v-if="busy" role="status">{{ t(format === 'html' ? 'html.working' : 'pdf.working') }}</p>
      <footer><button type="button" :disabled="busy" @click="close">{{ t('common.cancel') }}</button><button type="submit" :disabled="busy || !valid">{{ t('pdf.export') }}</button></footer>
    </form>
  </dialog>
</template>

<style scoped>
.export-dialog { width: 460px; max-width: calc(var(--app-viewport-width, 100vw) - 32px); max-height: calc(var(--app-viewport-height, 100vh) - 32px); box-sizing: border-box; margin: auto; padding: 24px; overflow: auto; border: 1px solid var(--fluent-menu-border); border-radius: var(--fluent-menu-radius); background: var(--fluent-menu-bg); color: var(--fluent-menu-fg); box-shadow: var(--fluent-menu-shadow); font: var(--app-ui-font-size)/1.5 var(--app-ui-font-family); user-select: none; -webkit-user-select: none; }
.export-dialog::backdrop { background: #0006; }
h1 { margin: 0; font-size: 20px; }
header p { margin: 4px 0 16px; overflow-wrap: anywhere; color: var(--app-footer-fg); }
.pdf-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 12px 0; margin: 0; border: 0; }
legend { padding: 0; font-weight: 600; }
label { display: flex; flex-direction: column; gap: 6px; }
input, select, button { border: 1px solid var(--fluent-menu-border); border-radius: 4px; background-color: var(--app-menubar-bg); color: inherit; }
input, select { width: 100%; }
input { user-select: text; -webkit-user-select: text; }
button { padding-inline: 18px; cursor: pointer; }
button:disabled { opacity: .5; cursor: default; }
button:hover:not(:disabled) { background-color: var(--fluent-menu-item-hover); }
input:focus-visible, select:focus-visible, button:focus-visible { outline: 1px solid var(--app-ui-focus-color); outline-offset: 2px; }
.pdf-summary { margin: 8px 0; color: var(--app-footer-fg); }
.pdf-error { color: var(--app-ui-error-color); overflow-wrap: anywhere; user-select: text; -webkit-user-select: text; }
footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
</style>
