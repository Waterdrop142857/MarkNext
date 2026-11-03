<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { version } from "../../package.json";
import { t } from "../i18n";

const emit = defineEmits<{ (e: "close"): void }>();
const dialog = ref<HTMLDialogElement | null>(null);
const appIcon = `${import.meta.env.BASE_URL}icons/marknext.svg`;

onMounted(() => dialog.value?.showModal());
onBeforeUnmount(() => dialog.value?.close());
</script>

<template>
  <dialog
    ref="dialog"
    class="about-dialog ui-controls"
    aria-labelledby="about-title"
    aria-describedby="about-description"
    @cancel.prevent="emit('close')"
    @click.self="emit('close')"
    @contextmenu.stop
  >
    <div class="about-content">
      <header>
        <img :src="appIcon" width="80" height="80" alt="" aria-hidden="true" draggable="false" />
        <h1 id="about-title">MarkNext</h1>
        <p class="about-version">{{ t('about.version', { version }) }}</p>
      </header>
      <p id="about-description">{{ t('about.description') }}</p>
      <footer>
        <button type="button" autofocus @click="emit('close')">{{ t('common.ok') }}</button>
      </footer>
    </div>
  </dialog>
</template>

<style scoped>
.about-dialog {
  width: 400px;
  max-width: calc(var(--app-viewport-width, 100vw) - 48px);
  max-height: calc(var(--app-viewport-height, 100vh) - 48px);
  box-sizing: border-box;
  margin: auto;
  padding: 0;
  overflow: auto;
  border: 1px solid var(--fluent-menu-border);
  border-radius: var(--fluent-menu-radius);
  background: var(--fluent-menu-bg);
  color: var(--fluent-menu-fg);
  box-shadow: var(--fluent-menu-shadow);
  font-family: var(--app-ui-font-family);
  font-size: var(--app-ui-font-size);
  line-height: 1.5;
  user-select: none;
  -webkit-user-select: none;
}
.about-dialog::backdrop { background: #0006; }
.about-content { padding: 28px 24px 20px; text-align: center; }
header img { display: block; margin: 0 auto 12px; }
h1 { margin: 0; font-size: 24px; line-height: 1.4; }
p { margin: 16px 0 0; overflow-wrap: anywhere; }
.about-version { margin-top: 4px; color: var(--app-footer-fg); }
footer { display: flex; justify-content: flex-end; margin-top: 24px; }
button {
  padding-inline: 20px;
  border: 1px solid var(--fluent-menu-border);
  border-radius: 4px;
  background: var(--app-menubar-bg);
  color: inherit;
  cursor: pointer;
}
button:hover { background: var(--fluent-menu-item-hover); }
</style>
