import { t } from "../i18n";
import { askUnsavedChanges, showError } from "../services/dialogs";
import type { useWorkspace } from "./useWorkspace";

export type DocumentAction = "new" | "open" | "save" | "saveAs" | "close" | "exit";

export function useDocumentActions(
  workspace: ReturnType<typeof useWorkspace>,
  options: { flushEditor: () => void; closeWindow: () => Promise<void> },
) {
  let pending = false;

  async function confirmReplacement(): Promise<boolean> {
    options.flushEditor();
    while (workspace.dirty.value) {
      const generation = workspace.documentGeneration.value;
      const promptedContent = workspace.markdown.value;
      const choice = await askUnsavedChanges();
      if (choice === "cancel") return false;
      options.flushEditor();
      if (workspace.documentGeneration.value !== generation) return false;
      if (choice === "discard") {
        // The answer approves this version, not edits queued while prompting.
        if (workspace.markdown.value === promptedContent) return true;
        continue;
      }
      if (!(await workspace.saveFile())) return false;
      // A save only covers its snapshot. Confirm again if new edits arrived.
      options.flushEditor();
    }
    return true;
  }

  async function run(action: DocumentAction): Promise<boolean> {
    if (pending) return false;
    pending = true;
    try {
      if (action === "save" || action === "saveAs") {
        options.flushEditor();
        return await (action === "save" ? workspace.saveFile() : workspace.saveFileAs());
      }
      if (action === "open") {
        // The workspace selects a path first and checks again if edits arrive while reading.
        return await workspace.openFile(confirmReplacement, options.flushEditor);
      }
      if (!(await confirmReplacement())) return false;
      switch (action) {
        case "new": workspace.newFile(); break;
        case "close": workspace.closeFile(); break;
        case "exit": await options.closeWindow(); break;
      }
      return true;
    }
    catch (error) {
      await showError(action === "exit" ? t("error.closeWindow") : t("error.fileAction"), error);
      return false;
    }
    finally {
      pending = false;
    }
  }

  return { run };
}
