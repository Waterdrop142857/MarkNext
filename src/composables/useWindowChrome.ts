import { onBeforeUnmount, ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";

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

  function closeWindow() {
    void getWindow()?.close();
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

  async function initWindowState() {
    const win = getWindow();
    if (!win) return;
    await refreshMaximized();
    try {
      unlistenResize = await win.onResized(() => {
        void refreshMaximized();
      });
    }
    catch {
      unlistenResize = null;
    }
  }

  onBeforeUnmount(() => {
    unlistenResize?.();
    unlistenResize = null;
  });

  return {
    isMaximized,
    startDrag,
    startResize,
    minimizeWindow,
    toggleMaximizeWindow,
    closeWindow,
    initWindowState,
  };
}