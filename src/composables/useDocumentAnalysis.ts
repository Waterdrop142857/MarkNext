import { onScopeDispose, shallowRef, watch, type Ref } from "vue";
import { analyzeDocument, type DocumentAnalysis } from "../services/documentAnalysis";

const empty = (): DocumentAnalysis => ({ statistics: { words: 0, characters: 0 }, headings: [] });

export function useDocumentAnalysis(markdown: Ref<string>, generation: Ref<number>) {
  const analysis = shallowRef<DocumentAnalysis>(empty());
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let analyzedText: string | undefined;
  function clear() { clearTimeout(debounce); clearTimeout(deadline); debounce = deadline = undefined; }
  function refresh() {
    clear();
    if (analyzedText !== markdown.value) {
      analysis.value = analyzeDocument(markdown.value);
      analyzedText = markdown.value;
    }
    return analysis.value;
  }
  watch([markdown, generation], ([text, current], previous) => {
    if (!previous || current !== previous[1]) {
      clear(); analyzedText = undefined;
      // Never display another document's outline while a large file loads.
      analysis.value = empty();
      if (text.length < 200_000) { refresh(); return; }
    }
    clearTimeout(debounce);
    debounce = setTimeout(refresh, 250);
    deadline ??= setTimeout(refresh, 1000);
  }, { immediate: true });
  onScopeDispose(clear);
  return { analysis, refresh };
}
