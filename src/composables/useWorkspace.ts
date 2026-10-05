import { t } from "../i18n";
import { computed, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { defaultPreferences, defaultFileFormat, type FileEncoding, type FileFormat } from "../config/preferences";
import { showError } from "../services/dialogs";

export function useWorkspace(getDefaultEncoding: () => FileEncoding = () => defaultPreferences.defaultEncoding) {
  const markdown = ref("");
  const currentFilePath = ref<string | null>(null);
  const savedMarkdown = ref("");
  const isUntitled = ref(false);
  const isSourceMode = ref(false);
  const selection = ref<unknown>(null);
  const documentGeneration = ref(0);
  const fileFormat = ref<FileFormat | null>(null);
  let writeQueue: Promise<unknown> = Promise.resolve();
  let saveAsPending: Promise<boolean> | null = null;

  // Content changes need protection regardless of path or document label.
  const dirty = computed(() => markdown.value !== savedMarkdown.value);

  async function openFile(
    beforeReplace?: () => Promise<boolean>,
    flushEditor?: () => void,
  ): Promise<boolean> {
    try {
      const selected = await open({
        title: t("document.open"),
        multiple: false,
        filters: [
          { name: "Markdown", extensions: ["md", "markdown", "txt"] },
        ],
      });
      if (typeof selected !== "string") return false;
      if (beforeReplace && !(await beforeReplace())) return false;
      const generation = documentGeneration.value;
      let approvedContent = markdown.value;
      const incoming = await invoke<FileFormat & { content: string }>("read_file", { path: selected, defaultEncoding: getDefaultEncoding() });
      const content = incoming.content;
      for (;;) {
        // Muya's RAF queue can contain edits not yet reflected in Vue's model.
        // Keep the incoming file buffered until the current version is approved.
        flushEditor?.();
        if (documentGeneration.value !== generation) return false;
        if (beforeReplace && markdown.value !== approvedContent) {
          if (!(await beforeReplace())) return false;
          approvedContent = markdown.value;
          continue;
        }
        fileFormat.value = { encoding: incoming.encoding, bom: incoming.bom };
        currentFilePath.value = selected;
        markdown.value = content;
        savedMarkdown.value = content;
        isUntitled.value = false;
        documentGeneration.value += 1;
        return true;
      }
    }
    catch (error) {
      await showError(t("error.open"), error);
      return false;
    }
  }

  function newFile() {
    fileFormat.value = defaultFileFormat(getDefaultEncoding());
    currentFilePath.value = null;
    markdown.value = "";
    savedMarkdown.value = "";
    isUntitled.value = true;
    documentGeneration.value += 1;
  }

  async function writeSnapshot(path: string, content: string, attachPath = false): Promise<boolean> {
    const generation = documentGeneration.value;
    const format = fileFormat.value ?? defaultFileFormat(getDefaultEncoding());
    const write = writeQueue.catch(() => undefined).then(() =>
      invoke("write_file", { path, content, ...format }),
    );
    writeQueue = write;
    try {
      await write;
      if (documentGeneration.value === generation
        && (attachPath || currentFilePath.value === path)) {
        if (attachPath) { currentFilePath.value = path; fileFormat.value = format; }
        savedMarkdown.value = content;
        isUntitled.value = false;
      }
      return true;
    }
    catch (error) {
      await showError(t("error.save"), error);
      return false;
    }
  }

  function saveFileAs(): Promise<boolean> {
    if (saveAsPending) return saveAsPending;
    const task = (async () => {
      const generation = documentGeneration.value;
      try {
        const selected = await save({
          title: t("command.saveAs"),
          filters: [
            { name: "Markdown", extensions: ["md", "markdown", "txt"] },
          ],
          defaultPath: currentFilePath.value ?? "untitled.md",
        });
        if (typeof selected !== "string" || documentGeneration.value !== generation) return false;
        return await writeSnapshot(selected, markdown.value, true);
      }
      catch (error) {
        await showError(t("error.saveAs"), error);
        return false;
      }
    })();
    saveAsPending = task;
    void task.finally(() => {
      if (saveAsPending === task) saveAsPending = null;
    });
    return task;
  }

  async function saveFile(): Promise<boolean> {
    if (saveAsPending && !(await saveAsPending)) return false;
    const path = currentFilePath.value;
    return path ? writeSnapshot(path, markdown.value) : saveFileAs();
  }

  function closeFile() {
    fileFormat.value = null;
    currentFilePath.value = null;
    markdown.value = "";
    savedMarkdown.value = "";
    isUntitled.value = false;
    documentGeneration.value += 1;
  }

  function clearContent() {
    markdown.value = "";
  }

  function toggleMode() {
    isSourceMode.value = !isSourceMode.value;
  }

  return {
    markdown,
    currentFilePath,
    savedMarkdown,
    isUntitled,
    isSourceMode,
    documentGeneration,
    fileFormat,
    selection,
    dirty,
    openFile,
    newFile,
    saveFileAs,
    saveFile,
    closeFile,
    clearContent,
    toggleMode,
  };
}
