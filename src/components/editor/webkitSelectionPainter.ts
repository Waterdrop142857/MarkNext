export function isNonChromiumWebKit(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /AppleWebKit|WebKit/i.test(ua) && !/Chrome|CriOS|Edg/i.test(ua);
}

export interface WebKitSelectionPainter {
  schedule(): void;
  start(): void;
  stop(): void;
}

function mergeSelectionRects(
  rects: DOMRect[],
  padX: number,
): Array<{ left: number; top: number; width: number; height: number }> {
  const items = rects
    .map((r) => ({
      left: r.left - padX,
      right: r.right + padX,
      top: r.top,
      bottom: r.bottom,
    }))
    .sort((a, b) => a.top - b.top || a.left - b.left);

  const merged: typeof items = [];
  for (const item of items) {
    const last = merged[merged.length - 1];
    const sameLine = last !== undefined
      && item.top < last.bottom - 1
      && last.top < item.bottom - 1;
    const gap = sameLine ? item.left - last.right : Number.POSITIVE_INFINITY;

    // Merge rects that belong to the same visual line and touch/almost touch.
    // This prevents adjacent inline elements (bold/em/code) from stacking two
    // semi-transparent selection layers and looking darker at the seams.
    if (sameLine && gap <= 4) {
      last.left = Math.min(last.left, item.left);
      last.right = Math.max(last.right, item.right);
      last.top = Math.min(last.top, item.top);
      last.bottom = Math.max(last.bottom, item.bottom);
    }
    else {
      merged.push({ ...item });
    }
  }

  return merged.map((m) => ({
    left: m.left,
    top: m.top,
    width: m.right - m.left,
    height: m.bottom - m.top,
  }));
}

export function createWebKitSelectionPainter(
  domNode: HTMLElement,
  scrollTarget: HTMLElement | null,
): WebKitSelectionPainter | null {
  if (!isNonChromiumWebKit()) return null;

  let selectionOverlay: HTMLDivElement | null = null;
  let selectionRaf = 0;
  let selectionObserver: MutationObserver | null = null;

  function ensureSelectionOverlay() {
    if (!selectionOverlay) {
      selectionOverlay = document.createElement("div");
      selectionOverlay.className = "mu-webkit-selection-overlay";
    }
    if (!selectionOverlay.isConnected) {
      domNode.appendChild(selectionOverlay);
    }
    // Keep `display: block` and the full-width editable area intact; the overlay
    // is a positioned layer behind the text so it never affects layout or input.
    domNode.style.position = "relative";
    domNode.style.zIndex = "0";
    selectionOverlay.style.height = `${domNode.scrollHeight || domNode.clientHeight}px`;
  }

  function schedulePaint() {
    if (selectionRaf) cancelAnimationFrame(selectionRaf);
    selectionRaf = requestAnimationFrame(() => {
      selectionRaf = 0;
      paintSelection();
    });
  }

  function paintSelection() {
    ensureSelectionOverlay();
    if (!selectionOverlay) return;

    selectionOverlay.textContent = "";
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (!domNode.contains(range.commonAncestorContainer)) return;

    const editorRect = domNode.getBoundingClientRect();
    const padX = 2; // small horizontal breathing room, matches the old CSS padding
    const rects = mergeSelectionRects(Array.from(range.getClientRects()), padX);
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (r.width === 0 || r.height === 0) continue;
      const rect = document.createElement("div");
      rect.className = "mu-webkit-selection-rect";
      rect.style.left = `${r.left - editorRect.left}px`;
      rect.style.top = `${r.top - editorRect.top}px`;
      rect.style.width = `${r.width}px`;
      rect.style.height = `${r.height}px`;
      selectionOverlay.appendChild(rect);
    }
  }

  function start() {
    ensureSelectionOverlay();
    document.addEventListener("selectionchange", schedulePaint);
    window.addEventListener("resize", schedulePaint);
    scrollTarget?.addEventListener("scroll", schedulePaint, true);
    selectionObserver = new MutationObserver((mutations) => {
      // Our own overlay repaints mutate the same subtree; ignore those mutations
      // to avoid paint → observe → paint feedback loop (which froze drag-select).
      if (!selectionOverlay) {
        schedulePaint();
        return;
      }
      for (const mutation of mutations) {
        const target = mutation.target as Node | null;
        if (target && (target === selectionOverlay || selectionOverlay.contains(target))) {
          continue;
        }
        schedulePaint();
        return;
      }
    });
    selectionObserver.observe(domNode, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    schedulePaint();
  }

  function stop() {
    if (selectionRaf) cancelAnimationFrame(selectionRaf);
    document.removeEventListener("selectionchange", schedulePaint);
    window.removeEventListener("resize", schedulePaint);
    scrollTarget?.removeEventListener("scroll", schedulePaint, true);
    selectionObserver?.disconnect();
    selectionObserver = null;
    selectionOverlay?.remove();
    selectionOverlay = null;
    domNode.style.position = "";
    domNode.style.zIndex = "";
  }

  return { schedule: schedulePaint, start, stop };
}