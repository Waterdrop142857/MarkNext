import { onBeforeUnmount, onMounted } from "vue";

/** Schedules existing disk conflict and recovery checks for the active window. */
export function useDocumentMonitoring(host: {
  busy(): boolean;
  flushEditor(): void;
  checkExternalChange(): Promise<boolean>;
  canReview(): boolean;
  reviewExternalChange(): Promise<void>;
  flushRecovery(): Promise<boolean>;
}) {
  let checking = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function checkDisk() {
    if (checking || document.hidden || host.busy()) return;
    checking = true;
    try {
      host.flushEditor();
      const changed = await host.checkExternalChange();
      if (changed && host.canReview()) await host.reviewExternalChange();
    } finally { checking = false; }
  }
  function handleVisibility() {
    if (document.hidden) void host.flushRecovery();
    else void checkDisk();
  }
  function handleBlur() { void host.flushRecovery(); }

  onMounted(() => {
    window.addEventListener("focus", checkDisk);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", handleVisibility);
    timer = setInterval(() => { void checkDisk(); }, 5000);
  });
  onBeforeUnmount(() => {
    window.removeEventListener("focus", checkDisk);
    window.removeEventListener("blur", handleBlur);
    document.removeEventListener("visibilitychange", handleVisibility);
    clearInterval(timer);
  });
  return { checkDisk };
}
