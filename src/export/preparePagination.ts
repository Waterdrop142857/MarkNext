const HEADING = /^H[1-6]$/;
const BLOCKS = "p,pre,blockquote,li,tr,.katex-display,.mermaid,.flowchart,.sequence,.vega-lite";

/** Apply only to the disposable PDF document after fonts and images settle. */
export function preparePdfPagination(article: HTMLElement, pageHeight: number): void {
  const fits = (element: HTMLElement) => {
    const height = element.getBoundingClientRect().height;
    return height > 0 && height < pageHeight - 1;
  };
  for (const block of article.querySelectorAll<HTMLElement>(BLOCKS)) {
    // A block taller than the printable page must remain fragmentable.
    block.dataset.pdfBreak = fits(block) ? "keep" : "split";
  }
  // Wrapping the actual nodes preserves IDs, links, math layout and text.
  // Limit the group to a heading chain and its first following block, never
  // an entire section that could run for many pages.
  for (const heading of article.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")) {
    if (heading.parentElement?.classList.contains("pdf-keep-together")) continue;
    const group: HTMLElement[] = [heading];
    let next = heading.nextElementSibling;
    while (next instanceof HTMLElement && HEADING.test(next.tagName)) {
      group.push(next);
      next = next.nextElementSibling;
    }
    if (!(next instanceof HTMLElement) || !fits(next)) continue;
    group.push(next);
    const height = next.getBoundingClientRect().bottom - heading.getBoundingClientRect().top;
    if (height <= 0 || height >= pageHeight - 1) continue;
    const wrapper = article.ownerDocument.createElement("div");
    wrapper.className = "pdf-keep-together";
    heading.before(wrapper);
    wrapper.append(...group);
  }
}
