import { afterEach, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import { useDocumentAnalysis } from "../useDocumentAnalysis";

afterEach(() => vi.useRealTimers());

it("coalesces typing and refreshes on demand without re-analyzing unchanged text", async () => {
  vi.useFakeTimers(); const markdown = ref("# Old"), generation = ref(0);
  const scope = effectScope(); const info = scope.run(() => useDocumentAnalysis(markdown, generation))!;
  expect(info.analysis.value.headings[0].text).toBe("Old");
  markdown.value = "# New"; await nextTick(); await vi.advanceTimersByTimeAsync(200);
  expect(info.analysis.value.headings[0].text).toBe("Old");
  expect(info.refresh().headings[0].text).toBe("New");
  const snapshot = info.analysis.value; expect(info.refresh()).toBe(snapshot);
  await vi.advanceTimersByTimeAsync(1000); expect(info.analysis.value).toBe(snapshot);
  scope.stop();
});

it("updates during continuous input and immediately clears another document's outline", async () => {
  vi.useFakeTimers(); const markdown = ref("# First"), generation = ref(0);
  const scope = effectScope(); const info = scope.run(() => useDocumentAnalysis(markdown, generation))!;
  for (let index = 0; index < 5; index++) {
    markdown.value = `# Edit ${index}`; await nextTick(); await vi.advanceTimersByTimeAsync(200);
  }
  expect(info.analysis.value.headings[0].text).toBe("Edit 4");
  markdown.value = "# Second"; generation.value++; await nextTick();
  expect(info.analysis.value.headings[0].text).toBe("Second");
  markdown.value = ""; generation.value++; await nextTick();
  expect(info.analysis.value.statistics.words).toBe(0); expect(info.analysis.value.headings).toEqual([]);
  scope.stop();
});

it("defers large document analysis and cancels pending work when disposed", async () => {
  vi.useFakeTimers(); const markdown = ref("# First"), generation = ref(0);
  const scope = effectScope(); const info = scope.run(() => useDocumentAnalysis(markdown, generation))!;
  markdown.value = `# Large\n\n${"text ".repeat(45_000)}`; generation.value++; await nextTick();
  expect(info.analysis.value.headings).toEqual([]);
  scope.stop(); await vi.advanceTimersByTimeAsync(1000);
  expect(info.analysis.value.headings).toEqual([]);
});
