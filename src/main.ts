import { createApp, nextTick } from "vue";
import { initializeI18n } from "./i18n";
import { failStartup, finishStartup, prepareStartup, revealStartup } from "./services/startup";
import "./styles.css";
import "./styles/app.css";
import "./styles/fluent-context-menu.css";
import "./styles/ui-controls.css";

async function start() {
  let generation: number | null = null;
  try {
    generation = await prepareStartup();
    initializeI18n();
    const { default: App } = await import("./App.vue");
    createApp(App).mount("#app");
    await nextTick();
    await revealStartup(generation);
    finishStartup();
  }
  catch (error) {
    console.error("MarkNext startup failed", error);
    failStartup();
    // A rendered error page is also ready to show; never strand a hidden app.
    try { await revealStartup(generation, true); } catch { /* Native watchdog retries. */ }
  }
}
void start();
