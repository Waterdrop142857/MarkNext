import { createApp } from "vue";
import { initializeI18n } from "./i18n";
import App from "./App.vue";
import "./styles.css";
import "./styles/app.css";
import "./styles/muya-editor.css";
import "./styles/source-editor.css";
import "./styles/fluent-context-menu.css";
import "./styles/ui-controls.css";

initializeI18n();
createApp(App).mount("#app");
