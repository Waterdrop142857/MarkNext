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

export function mergeSelectionRects(
  rects: DOMRect[],
  padX: number,
): Array<{ left: number; top: number; width: number; height: number }> {
  const items = rects
    // Filtering after padding turns a zero-width caret into a painted strip.
    .filter(r => r.width > 0 && r.height > 0
      && [r.left, r.right, r.top, r.bottom].every(Number.isFinite))
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

export function collectVisibleSelectionRects(
  domNode: HTMLElement,
  range: Range,
  selectedPreviewBlocks?: Set<Element>,
): DOMRect[] {
  const doc = domNode.ownerDocument;
  const view = doc.defaultView;
  if (!view) return [];
  const atomicSelector = "img, svg, canvas, video, .katex-html";
  const walker = doc.createTreeWalker(domNode, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
      // Visible formulas are atomic. Never walk their invisible MathML copy,
      // layout struts or accessibility annotation text.
      if (node.parentElement?.closest(atomicSelector)) return NodeFilter.FILTER_REJECT;
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        if (element.matches(".katex-mathml, .mu-webkit-selection-overlay, [hidden], script, style")) return NodeFilter.FILTER_REJECT;
        const style = view.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse"
          || style.opacity === "0") return NodeFilter.FILTER_REJECT;
        // Muya keeps inactive formula/HTML/diagram source in a transparent,
        // zero-size container. Range geometry still includes that source:
        // its characters wrap into separate rows despite being clipped.
        const clipsX = /^(hidden|clip)$/.test(style.overflowX || style.overflow);
        const clipsY = /^(hidden|clip)$/.test(style.overflowY || style.overflow);
        if ((clipsX && Number.parseFloat(style.width) === 0)
          || (clipsY && Number.parseFloat(style.height) === 0)) return NodeFilter.FILTER_REJECT;
        return element.matches(atomicSelector) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
      // Hidden Markdown delimiters can have normal line height and zero font
      // size. Their geometry must not acquire a visible horizontal padding.
      if (node.parentElement && Number.parseFloat(view.getComputedStyle(node.parentElement).fontSize) === 0) return NodeFilter.FILTER_REJECT;
      return node.textContent?.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").length
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const rects: DOMRect[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    let nodeRects: DOMRect[];
    if (node.nodeType === Node.ELEMENT_NODE) {
      nodeRects = [(node as Element).getBoundingClientRect()];
    }
    else {
      const textRange = doc.createRange();
      textRange.setStart(node, node === range.startContainer ? range.startOffset : 0);
      textRange.setEnd(node, node === range.endContainer ? range.endOffset : node.textContent!.length);
      nodeRects = Array.from(textRange.getClientRects());
    }
    rects.push(...nodeRects);
    if (selectedPreviewBlocks && nodeRects.some(rect => rect.width > 0 && rect.height > 0)) {
      const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
      const preview = element?.closest(".mu-math-preview, .mu-html-preview");
      const block = preview?.closest("figure.mu-math-block, figure.mu-html-block");
      if (block) selectedPreviewBlocks.add(block);
    }
  }
  return rects;
}

export function createWebKitSelectionPainter(
  domNode: HTMLElement,
  scrollTarget: HTMLElement | null,
): WebKitSelectionPainter | null {
  if (!isNonChromiumWebKit()) return null;

  let selectionOverlay: HTMLDivElement | null = null;
  let selectionRaf = 0;
  let selectionObserver: MutationObserver | null = null;
  let active = false;
  let selectedPreviewBlocks = new Set<Element>();

  function syncSelectedPreviewBlocks(next: Set<Element>) {
    for (const block of selectedPreviewBlocks) {
      if (!next.has(block)) block.classList.remove("mu-webkit-selected-preview");
    }
    for (const block of next) {
      if (!selectedPreviewBlocks.has(block)) block.classList.add("mu-webkit-selected-preview");
    }
    selectedPreviewBlocks = next;
  }

  function ensureSelectionOverlay() {
    if (!selectionOverlay) {
      selectionOverlay = document.createElement("div");
      selectionOverlay.className = "mu-webkit-selection-overlay";
      selectionOverlay.contentEditable = "false";
      selectionOverlay.setAttribute("aria-hidden", "true");
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
    if (!active || selectionRaf) return;
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
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      syncSelectedPreviewBlocks(new Set());
      return;
    }
    const range = selection.getRangeAt(0);
    if (!domNode.contains(range.commonAncestorContainer)) {
      syncSelectedPreviewBlocks(new Set());
      return;
    }

    const editorRect = domNode.getBoundingClientRect();
    const scaleX = domNode.offsetWidth ? editorRect.width / domNode.offsetWidth : 1;
    const scaleY = domNode.offsetHeight ? editorRect.height / domNode.offsetHeight : 1;
    const padX = 2; // small horizontal breathing room, matches the old CSS padding
    const nextSelectedPreviewBlocks = new Set<Element>();
    const rects = mergeSelectionRects(collectVisibleSelectionRects(domNode, range, nextSelectedPreviewBlocks), padX);
    syncSelectedPreviewBlocks(nextSelectedPreviewBlocks);
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (r.width === 0 || r.height === 0) continue;
      const rect = document.createElement("div");
      rect.className = "mu-webkit-selection-rect";
      rect.style.left = `${(r.left - editorRect.left) / (scaleX || 1)}px`;
      rect.style.top = `${(r.top - editorRect.top) / (scaleY || 1)}px`;
      rect.style.width = `${r.width / (scaleX || 1)}px`;
      rect.style.height = `${r.height / (scaleY || 1)}px`;
      selectionOverlay.appendChild(rect);
    }
  }

  function start() {
    if (active) return;
    active = true;
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
    active = false;
    syncSelectedPreviewBlocks(new Set());
    if (selectionRaf) cancelAnimationFrame(selectionRaf);
    selectionRaf = 0;
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
