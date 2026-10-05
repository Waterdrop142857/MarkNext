import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import type {} from "./app";

const diagrams = [
  { name: "flowchart", code: "flowchart LR\nA[Start] -->|next| B[Middle]\nB --> C[End]\nlinkStyle 1 stroke:#ffcc00", lines: ".flowchart-link", filled: 'marker[id*="-point"] path' },
  { name: "sequence", code: "sequenceDiagram\nAlice->>Bob: Hello\nBob-->>Alice: Reply", lines: ".messageLine0, .messageLine1, .actor-line", filled: 'marker[id$="-arrowhead"] path' },
  { name: "class", code: "classDiagram\nParent <|-- Child\nParent *-- Part\nParent o-- Other\nChild ..> Other", lines: ".relation", filled: "marker.composition path, marker.dependency path" },
  { name: "state", code: "stateDiagram-v2\n[*] --> Idle\nIdle --> Running: start\nRunning --> [*]", lines: ".transition", filled: 'marker[id*="-barb"] path' },
  { name: "ER", code: 'erDiagram\nCUSTOMER ||--o{ ORDER : places', lines: ".relationshipLine", filled: "" },
];

function contrast(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const components = color.match(/[\d.]+/g)?.map(Number);
    if (!components || components.length < 3 || (components[3] !== undefined && components[3] !== 1))
      throw new Error(`Expected an opaque RGB color, got ${color}`);
    const rgb = components.slice(0, 3).map(value => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
  };
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function setTheme(page: Page, name: string) {
  await page.getByRole("button", { name: "主题", exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
}

for (const diagram of diagrams) {
  test(`${diagram.name} connectors stay visible when switching themes without replacing the SVG`, async ({ page }) => {
    await page.goto("/tests/e2e/app.html");
    await expect(page.locator(".empty-state")).toBeVisible();
    await page.evaluate(code => { window.nativeFixture.disk["/old.md"] = `\`\`\`mermaid\n${code}\n\`\`\`\n\nAfter diagram`; }, diagram.code);
    await page.keyboard.press("Control+O");
    const svg = page.locator(".mu-diagram-preview > svg");
    await expect(svg).toBeVisible();
    await expect(svg.locator(diagram.lines).first()).toBeAttached();
    const originalSvg = await svg.elementHandle();
    const originalEditor = await page.locator(".mu-editor").elementHandle();
    const lightStrokes = await svg.locator(diagram.lines).evaluateAll(nodes => nodes.map(node => getComputedStyle(node).stroke));
    if (diagram.name === "flowchart") expect(lightStrokes.at(-1)).toBe("rgb(255, 204, 0)");
    const hollowFills = await svg.locator("marker.extension path, marker.aggregation path, marker.lollipop circle").evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fill));

    for (const theme of ["暗色", "亮色", "跟随系统"]) {
      if (theme === "跟随系统") await page.emulateMedia({ colorScheme: "dark" });
      await setTheme(page, theme);
      const dark = theme !== "亮色";
      await expect(page.locator("html")).toHaveAttribute("data-theme", dark ? "dark" : "light");
      expect(await originalSvg!.evaluate(node => node === document.querySelector(".mu-diagram-preview > svg"))).toBe(true);
      expect(await originalEditor!.evaluate(node => node === document.querySelector(".mu-editor"))).toBe(true);
      const strokes = await svg.locator(diagram.lines).evaluateAll(nodes => nodes.map(node => getComputedStyle(node).stroke));
      if (diagram.name === "flowchart") expect(strokes.at(-1)).toBe("rgb(255, 204, 0)");
      if (!dark) { expect(strokes).toEqual(lightStrokes); continue; }

      const backgrounds = await page.locator(".mu-editor").evaluate(node => {
        const style = getComputedStyle(node);
        return [style.getPropertyValue("--editor-bg-color").trim(), style.getPropertyValue("--float-bg-color").trim()];
      });
      // Resolve hex theme tokens through the browser's color parser.
      const rgbBackgrounds = await page.evaluate(colors => colors.map(color => {
        const probe = document.createElement("span");
        probe.style.color = color; document.body.appendChild(probe);
        const rgb = getComputedStyle(probe).color; probe.remove(); return rgb;
      }), backgrounds);
      const markerStrokes = await svg.locator("marker path, marker circle, marker polygon, marker line").evaluateAll(nodes => nodes.map(node => getComputedStyle(node).stroke));
      expect(markerStrokes.length).toBeGreaterThan(0);
      const filledMarkers = diagram.filled ? await svg.locator(diagram.filled).evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fill)) : [];
      if (diagram.filled) expect(filledMarkers.length).toBeGreaterThan(0);
      for (const color of [...strokes, ...markerStrokes, ...filledMarkers])
        for (const background of rgbBackgrounds) expect(contrast(color, background), `${color} against ${background}`).toBeGreaterThanOrEqual(3);
      expect(await svg.locator("marker.extension path, marker.aggregation path, marker.lollipop circle").evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fill))).toEqual(hollowFills);
      if (diagram.name === "sequence") {
        const labels = await svg.locator(".messageText").evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fill));
        expect(labels.length).toBeGreaterThan(0);
        for (const color of labels) expect(contrast(color, rgbBackgrounds[0]!)).toBeGreaterThanOrEqual(4.5);
      }
    }
    // A system appearance change updates existing SVGs too.
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await svg.locator(diagram.lines).evaluateAll(nodes => nodes.map(node => getComputedStyle(node).stroke))).toEqual(lightStrokes);
    expect(await originalSvg!.evaluate(node => node === document.querySelector(".mu-diagram-preview > svg"))).toBe(true);
    expect(await page.evaluate(() => ({ reads: window.nativeFixture.reads, writes: window.nativeFixture.writes, prompts: window.nativeFixture.prompts }))).toEqual({ reads: ["/old.md"], writes: [], prompts: [] });
  });
}
