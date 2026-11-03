import type CodeMirror from "codemirror";

/** Replace the browser's full-editor drag snapshot, without owning text edits. */
export function attachSourceDragPreview(editor: CodeMirror.Editor): () => void {
  const wrapper = editor.getWrapperElement();
  const doc = wrapper.ownerDocument;
  const view = doc.defaultView;
  let image: HTMLCanvasElement | null = null;
  let timer: number | undefined;

  function clear() {
    if (timer !== undefined) view?.clearTimeout(timer);
    timer = undefined;
    image?.remove();
    image = null;
  }
  function start(event: DragEvent) {
    clear();
    if (event.defaultPrevented || !event.dataTransfer?.setDragImage || !editor.somethingSelected()) return;
    // A canvas already has transparent pixels: no image decoding race. Keep it
    // attached until the browser captures the drag image after dragstart.
    image = doc.createElement("canvas");
    image.width = image.height = 1;
    image.className = "source-drag-image";
    image.setAttribute("aria-hidden", "true");
    image.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;";
    doc.body.appendChild(image);
    event.dataTransfer.setDragImage(image, 0, 0);
    timer = view?.setTimeout(clear, 0);
  }

  // Bubble after CodeMirror's scroller listener so its default drag image
  // cannot replace ours. Its payload, copy/move handling and history stay intact.
  wrapper.addEventListener("dragstart", start);
  wrapper.addEventListener("dragend", clear);
  wrapper.addEventListener("drop", clear);
  return () => {
    clear();
    wrapper.removeEventListener("dragstart", start);
    wrapper.removeEventListener("dragend", clear);
    wrapper.removeEventListener("drop", clear);
  };
}
