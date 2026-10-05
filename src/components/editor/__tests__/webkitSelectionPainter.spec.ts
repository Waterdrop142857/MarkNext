// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "katex";
import { Muya } from "../../../muya/muya";
import { readFileSync } from "node:fs";
import { collectVisibleSelectionRects, createWebKitSelectionPainter, mergeSelectionRects } from "../webkitSelectionPainter";

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function editor(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

function selectContents(root: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(root);
  return range;
}

function mockTextRects() {
  // DOM emulation has no layout: provide geometry while exercising real DOM
  // traversal and Range boundaries. Hidden MathML would produce ghost strips.
  return vi.spyOn(Range.prototype, "getClientRects").mockImplementation(function (this: Range) {
    expect(this.startContainer.nodeType).toBe(Node.TEXT_NODE);
    expect(this.endContainer).toBe(this.startContainer);
    const inactiveSource = this.startContainer.parentElement?.closest(".mu-math-container")
      && !this.startContainer.parentElement?.closest(".mu-active");
    if (inactiveSource) {
      return Array.from(this.toString(), (_, index) => new DOMRect(20, 500 + index * 20, 8, 18)) as unknown as DOMRectList;
    }
    const hiddenFormula = this.startContainer.parentElement?.closest(".katex-mathml");
    return [new DOMRect(hiddenFormula ? 20 : 10 + this.startOffset * 8,
      hiddenFormula ? 600 : 20, (this.endOffset - this.startOffset) * 8, 18)] as unknown as DOMRectList;
  });
}

describe("WebKit selection geometry", () => {
  it("excludes KaTeX's hidden MathML but selects its visible aria-hidden HTML once", () => {
    const root = editor(`<p>Hello Muya</p><div>${renderToString("C^{C^C} C_s S")}</div><p>\u200B</p>`);
    const html = root.querySelector<HTMLElement>(".katex-html")!;
    expect(html.getAttribute("aria-hidden")).toBe("true");
    vi.spyOn(html, "getBoundingClientRect").mockReturnValue(new DOMRect(50, 100, 120, 32));
    const textRects = mockTextRects();

    expect(collectVisibleSelectionRects(root, selectContents(root)))
      .toEqual([new DOMRect(10, 20, 80, 18), new DOMRect(50, 100, 120, 32)]);
    expect(textRects).toHaveBeenCalledTimes(1);
  });

  it("respects partial text boundaries across inline nodes", () => {
    const root = editor("<p>abc<b>def</b>ghi</p>");
    const paragraph = root.firstChild!;
    const first = paragraph.firstChild!;
    const last = paragraph.lastChild!;
    const range = document.createRange();
    range.setStart(first, 1);
    range.setEnd(last, 2);
    const textRects = mockTextRects();

    expect(collectVisibleSelectionRects(root, range)).toHaveLength(3);
    const ranges = textRects.mock.instances as unknown as Range[];
    expect(ranges.map(value => [value.startContainer.textContent, value.startOffset, value.endOffset]))
      .toEqual([["abc", 1, 3], ["def", 0, 3], ["ghi", 0, 2]]);
  });

  it("does not include text before or after a selection", () => {
    const root = editor("<p>before</p><p>selected</p><p>after</p>");
    const range = selectContents(root.children[1] as HTMLElement);
    const textRects = mockTextRects();
    expect(collectVisibleSelectionRects(root, range)).toHaveLength(1);
    expect(textRects).toHaveBeenCalledTimes(1);
    expect((textRects.mock.instances[0] as unknown as Range).startContainer.textContent).toBe("selected");
  });

  it("skips hidden subtrees, placeholders and the painter's overlay", () => {
    const root = editor('<p>visible</p><div hidden>hidden</div><div style="display:none">none</div>'
      + '<div style="visibility:hidden">invisible</div><script>script</script><style>style</style>'
      + '<p>\u200B\uFEFF</p><p><br></p><div class="mu-webkit-selection-overlay">overlay</div>');
    const textRects = mockTextRects();
    expect(collectVisibleSelectionRects(root, selectContents(root))).toEqual([new DOMRect(10, 20, 56, 18)]);
    expect(textRects).toHaveBeenCalledTimes(1);
  });

  it("collects media as a single box without walking its descendants", () => {
    const root = editor('<img><svg><text>svg text</text></svg><canvas>fallback</canvas><video>fallback</video>');
    const boxes = Array.from(root.children).map((element, index) => {
      const box = new DOMRect(10, index * 50, 40, 40);
      vi.spyOn(element, "getBoundingClientRect").mockReturnValue(box);
      return box;
    });
    const textRects = mockTextRects();
    expect(collectVisibleSelectionRects(root, selectContents(root))).toEqual(boxes);
    expect(textRects).not.toHaveBeenCalled();
  });

  it("excludes transparent source ancestors and zero-size clipped inline syntax", () => {
    const root = editor('<p>visible</p><pre style="opacity:0"><code><span>LaTeX source</span></code></pre>'
      + '<span style="width:0;height:0;overflow:hidden"><span>inline source</span></span>'
      + '<span style="font-size:0">$</span>');
    const textRects = mockTextRects();
    expect(collectVisibleSelectionRects(root, selectContents(root))).toEqual([new DOMRect(10, 20, 56, 18)]);
    expect(textRects).toHaveBeenCalledTimes(1);
  });

  it.each(["C", "C^{C^C}C_sS"])("ignores inactive Muya formula source for %s, and restores its selection when active", (latex) => {
    const style = document.createElement("style");
    // Use production styles and Muya's real DOM, including the hidden source
    // container missing from the original KaTeX-only regression fixture.
    style.textContent = readFileSync("src/muya/assets/styles/blockSyntax.css", "utf8");
    document.head.appendChild(style);
    const previousVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = "test";
    const host = editor("");
    let muya: Muya | undefined;
    try {
      muya = new Muya(host, { markdown: `before\n\n$$\n${latex}\n$$\n\nafter` });
      muya.init();
      const root = muya.domNode;
      const formula = root.querySelector<HTMLElement>(".mu-math-block")!;
      formula.classList.remove("mu-active");
      const source = formula.querySelector<HTMLElement>(".mu-math-container")!;
      const html = formula.querySelector<HTMLElement>(".katex-html")!;
      expect(source.textContent).toBe(latex);
      expect(window.getComputedStyle(source).opacity).toBe("0");
      vi.spyOn(html, "getBoundingClientRect").mockReturnValue(new DOMRect(50, 100, 120, 32));
      const textRects = mockTextRects();
      const range = selectContents(root);
      expect(collectVisibleSelectionRects(root, range)).toHaveLength(3);
      const selectedTexts = () => (textRects.mock.instances as unknown as Range[])
        .map(value => value.startContainer.textContent);
      expect(selectedTexts()).toEqual(["before", "after"]);

      formula.classList.add("mu-active");
      expect(window.getComputedStyle(source).opacity).toBe("1");
      textRects.mockClear();
      collectVisibleSelectionRects(root, range);
      expect(selectedTexts().join("")).toBe(`before${latex}after`);
      expect(muya.getMarkdown()).toContain(latex);
    }
    finally {
      muya?.destroy();
      style.remove();
      if (previousVersion === undefined) delete (window as Partial<Window>).MUYA_VERSION;
      else window.MUYA_VERSION = previousVersion;
    }
  });

  it("filters empty and invalid geometry before adding selection padding", () => {
    expect(mergeSelectionRects([
      new DOMRect(10, 600, 0, 18), new DOMRect(10, 620, 10, 0),
      new DOMRect(Number.NaN, 640, 10, 18), new DOMRect(10, 20, 20, 18),
    ], 2)).toEqual([{ left: 8, top: 20, width: 24, height: 18 }]);
  });

  it("merges adjacent inline highlights without filling space on other lines", () => {
    expect(mergeSelectionRects([
      new DOMRect(10, 20, 20, 18), new DOMRect(32, 20, 30, 18), new DOMRect(10, 60, 15, 18),
    ], 2)).toEqual([
      { left: 8, top: 20, width: 56, height: 18 },
      { left: 8, top: 60, width: 19, height: 18 },
    ]);
  });
});

describe("WebKit painter lifecycle", () => {
  it.each(["math", "html"])("preserves selection over hovered %s previews and restores hover on deselection", (kind) => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("AppleWebKit/605.1.15");
    const style = document.createElement("style");
    // DOM emulation has no pointer hover. Substitute a class for that pseudo
    // class to exercise the actual production cascade and its selection state.
    style.textContent = ["src/muya/assets/styles/blockSyntax.css", "src/styles/muya-editor.css"]
      .map(path => readFileSync(path, "utf8").replace(/:hover/g, ".test-hover"))
      .join("\n");
    document.head.appendChild(style);
    const wrapper = editor("");
    wrapper.className = "mu-webkit-selection-fix";
    wrapper.style.setProperty("--editor-color-04", "rgb(42, 42, 42)");
    const root = document.createElement("div");
    root.className = "mu-editor";
    const preview = kind === "math" ? renderToString("x+y") : "<p>HTML preview</p>";
    const figure = `<figure class="mu-${kind}-block test-hover"><div class="mu-${kind}-preview">${preview}</div>`
      + `<pre class="mu-${kind}-container">source</pre></figure>`;
    root.innerHTML = `<p>outside preview</p>${figure}${figure}`;
    wrapper.appendChild(root);
    root.querySelectorAll(".katex-html").forEach(element => {
      vi.spyOn(element, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 60, 80, 18));
    });
    mockTextRects();
    const blocks = Array.from(root.querySelectorAll("figure"));
    const addClass = vi.spyOn(blocks[0]!.classList, "add");
    let pendingFrame: FrameRequestCallback | undefined;
    let nextId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      pendingFrame = callback;
      return ++nextId;
    });
    vi.stubGlobal("cancelAnimationFrame", () => { pendingFrame = undefined; });
    const painter = createWebKitSelectionPainter(root, null)!;
    function paint() {
      const callback = pendingFrame!;
      pendingFrame = undefined;
      callback(0);
    }
    function select(range: Range) {
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      painter.schedule();
    }
    try {
      // Select one preview: the other hovered preview keeps its normal color.
      select(selectContents(blocks[0] as HTMLElement));
      painter.start();
      paint();
      expect(blocks[0]!.classList.contains("mu-webkit-selected-preview")).toBe(true);
      expect(root.querySelectorAll(".mu-webkit-selection-rect").length).toBeGreaterThan(0);
      expect(window.getComputedStyle(blocks[0]!).backgroundColor).toBe("transparent");
      expect(blocks[1]!.classList.contains("mu-webkit-selected-preview")).toBe(false);
      expect(window.getComputedStyle(blocks[1]!).backgroundColor).toBe("rgb(42, 42, 42)");
      expect(addClass).toHaveBeenCalledTimes(1);
      painter.schedule();
      paint();
      expect(addClass).toHaveBeenCalledTimes(1);

      // Moving selection away restores hover without changing document text.
      select(selectContents(root.firstElementChild as HTMLElement));
      paint();
      expect(blocks[0]!.classList.contains("mu-webkit-selected-preview")).toBe(false);
      expect(window.getComputedStyle(blocks[0]!).backgroundColor).toBe("rgb(42, 42, 42)");
      select(selectContents(root));
      paint();
      expect(blocks.every(block => block.classList.contains("mu-webkit-selected-preview"))).toBe(true);
      const content = root.textContent;
      window.getSelection()!.removeAllRanges();
      painter.schedule();
      paint();
      expect(blocks.every(block => !block.classList.contains("mu-webkit-selected-preview"))).toBe(true);
      select(selectContents(root));
      paint();
      painter.stop();
      expect(blocks.every(block => !block.classList.contains("mu-webkit-selected-preview"))).toBe(true);
      expect(root.textContent).toBe(content);
    }
    finally {
      painter.stop();
      style.remove();
    }
  });

  it("coalesces repeated updates and never recreates the overlay after stopping", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("AppleWebKit/605.1.15");
    const frames = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    const request = vi.fn((callback: FrameRequestCallback) => {
      frames.set(++nextId, callback);
      return nextId;
    });
    vi.stubGlobal("requestAnimationFrame", request);
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    const root = editor("<p>selected</p>");
    mockTextRects();
    window.getSelection()!.addRange(selectContents(root));
    const painter = createWebKitSelectionPainter(root, null)!;
    painter.start();
    painter.start();
    painter.schedule();
    document.dispatchEvent(new Event("selectionchange"));
    expect(request).toHaveBeenCalledTimes(1);
    const callback = frames.get(1)!;
    frames.delete(1);
    callback(0);
    expect(root.querySelectorAll(".mu-webkit-selection-rect")).toHaveLength(1);
    expect(root.querySelector(".mu-webkit-selection-overlay")?.getAttribute("contenteditable")).toBe("false");
    painter.schedule();
    expect(frames.size).toBe(1);
    painter.stop();
    painter.schedule();
    document.dispatchEvent(new Event("selectionchange"));
    expect(frames.size).toBe(0);
    expect(root.querySelector(".mu-webkit-selection-overlay")).toBeNull();
    expect(root.textContent).toBe("selected");
  });
});
