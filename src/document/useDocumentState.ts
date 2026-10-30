import { computed, ref } from "vue";
import { newDocumentId } from "../services/documentSafety";
import type { ExternalChange, FileFormat } from "./types";

/** Mutable refs have one owner per document; callers must not copy the state. */
export function useDocumentState() {
  const markdown = ref("");
  const currentFilePath = ref<string | null>(null);
  const savedMarkdown = ref("");
  const isUntitled = ref(false);
  const isSourceMode = ref(false);
  const selection = ref<unknown>(null);
  const documentGeneration = ref(0);
  const fileFormat = ref<FileFormat | null>(null);
  const documentId = ref(newDocumentId());
  const diskVersion = ref("missing");
  const externalChange = ref<ExternalChange | null>(null);
  const recoveredCopy = ref(false);
  const recoveryNeedsSave = ref(false);
  const dirty = computed(() => recoveryNeedsSave.value || markdown.value !== savedMarkdown.value);

  function resetIdentity() {
    documentId.value = newDocumentId();
    diskVersion.value = "missing";
    externalChange.value = null;
    recoveredCopy.value = recoveryNeedsSave.value = false;
  }

  return { markdown, currentFilePath, savedMarkdown, isUntitled, isSourceMode, selection,
    documentGeneration, fileFormat, documentId, diskVersion, externalChange, recoveredCopy,
    recoveryNeedsSave, dirty, resetIdentity };
}
