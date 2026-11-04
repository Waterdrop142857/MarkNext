<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { version } from "../../package.json";
import { openUrl } from "@tauri-apps/plugin-opener";
import { t } from "../i18n";

const emit = defineEmits<{ (e: "close"): void }>();
const dialog = ref<HTMLDialogElement | null>(null);
const appIcon = `${import.meta.env.BASE_URL}icons/marknext.svg`;
const repository = "https://github.com/Waterdrop142857/MarkNext";
const openFailed = ref(false);

async function openRepository() {
  openFailed.value = false;
  try { await openUrl(repository); }
  catch { openFailed.value = true; }
}

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
      <p class="about-license">{{ t('about.license') }}</p>
      <p class="about-repository">
        <a :href="repository" :aria-label="t('about.repository')" target="_blank" rel="noopener noreferrer"
          @click.prevent="openRepository" @auxclick.middle.prevent="openRepository">
          <!-- GitHub mark from Primer Octicons. Copyright (c) GitHub, Inc. MIT. -->
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656" />
          </svg>
          <span>{{ repository }}</span>
        </a>
      </p>
      <p v-if="openFailed" class="about-error" role="alert">{{ t('about.openError') }}</p>
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
.about-license { margin-top: 8px; color: var(--app-footer-fg); }
.about-repository { margin-top: 12px; }
.about-repository a { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; color: var(--link-color); text-align: left; text-decoration: none; user-select: text; -webkit-user-select: text; }
.about-repository svg { flex-shrink: 0; }
.about-repository span { min-width: 0; }
.about-repository a:hover { text-decoration: underline; }
.about-repository a:focus-visible { outline: 1px solid var(--app-ui-focus-color); outline-offset: 3px; border-radius: 2px; }
.about-error { color: var(--app-ui-error-color); }
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
