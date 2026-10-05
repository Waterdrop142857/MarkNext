import { t } from "../i18n";
import { onBeforeUnmount, ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { showError } from "../services/dialogs";

export type ResizeDirection =
  | "North"
  | "South"
  | "East"
  | "West"
  | "NorthEast"
  | "NorthWest"
  | "SouthEast"
  | "SouthWest";

export function useWindowChrome() {
  const isMaximized = ref(false);
  let unlistenResize: (() => void) | null = null;
  let unlistenClose: (() => void) | null = null;
  let disposed = false;

  function getWindow() {
    try {
      return getCurrentWindow();
    }
    catch {
      return null;
    }
  }

  function startDrag(event: MouseEvent) {
    if (event.button !== 0) return;
    const win = getWindow();
    if (!win) return;
    event.preventDefault();
    void win.startDragging();
  }

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

  async function destroyWindow() {
    const win = getWindow();
    if (!win) throw new Error(t("error.windowUnavailable"));
    // Called only after the shared document action has approved closing.
    await win.destroy();
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

  async function initWindowState(requestClose: () => Promise<unknown>) {
    const win = getWindow();
    if (!win || disposed) return;
    try {
      const unlisten = await win.onCloseRequested(async (event) => {
        event.preventDefault();
        await requestClose();
      });
      if (disposed) {
        unlisten();
        return;
      }
      unlistenClose = unlisten;
    }
    catch (error) {
      await showError(t("error.closeProtection"), error);
    }
    await refreshMaximized();
    if (disposed) return;
    try {
      const unlisten = await win.onResized(() => {
        void refreshMaximized();
      });
      if (disposed) unlisten();
      else unlistenResize = unlisten;
    }
    catch {
      unlistenResize = null;
    }
  }

  onBeforeUnmount(() => {
    disposed = true;
    unlistenClose?.();
    unlistenClose = null;
    unlistenResize?.();
    unlistenResize = null;
  });

  return {
    isMaximized,
    startDrag,
    startResize,
    minimizeWindow,
    toggleMaximizeWindow,
    destroyWindow,
    initWindowState,
  };
}
