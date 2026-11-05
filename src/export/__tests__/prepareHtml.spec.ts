// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import katex from "katex";
import { prepareExportHtml } from "../prepareHtml";

describe("PDF HTML preparation", () => {
  it("preserves the positioning needed by fractions and superscripts", () => {
    const math = katex.renderToString("x^2 + \\frac{1}{2} + \\sqrt{x}");
    const prepared = prepareExportHtml(math);
    expect(prepared.content.querySelector(".katex")).not.toBeNull();
    expect(Array.from(prepared.content.querySelectorAll<HTMLElement>("[style]")).some(node => node.style.top)).toBe(true);
    expect(prepared.content.querySelector<HTMLElement>(".frac-line")?.style.borderBottomWidth).toBeTruthy();
  });
  it("removes scripts, global CSS, navigation overrides and active presentation", () => {
    const prepared = prepareExportHtml('<style>body{display:none}</style><base href="https://example.test"><script>alert(1)</script><p style="position:fixed;top:0;background-image:url(&quot;https://example.test/a&quot;);color:red" onclick="alert(1)">Safe</p>');
    expect(prepared.content.querySelector("style,base,script")).toBeNull();
    const paragraph = prepared.content.querySelector("p")!;
    expect(paragraph.getAttribute("onclick")).toBeNull();
    expect(paragraph.style.position).toBe("");
    expect(paragraph.style.backgroundImage).toBe("");
    expect(paragraph.style.color).toBe("red");
  });
});
