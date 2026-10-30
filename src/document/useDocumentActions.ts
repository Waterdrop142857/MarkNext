import type { RecoverySnapshot } from "./types";
import type { DocumentActionsSource } from "./consumers";
import type { DocumentPrompts } from "./ports";

export type DocumentAction = "new" | "open" | "save" | "saveAs" | "close" | "reload" | "overwrite";

export function useDocumentActions(
  workspace: DocumentActionsSource,
  prompts: DocumentPrompts,
  options: { flushEditor: () => void; documentName?: () => string },
) {
  let pending = false;
  let lastExternalPrompt: { generation: number; version: string } | null = null;

  async function confirmReplacement(): Promise<boolean> {
    options.flushEditor();
    while (workspace.dirty.value) {
      const generation = workspace.documentGeneration.value;
      const promptedContent = workspace.markdown.value;
      const choice = await prompts.unsaved(options.documentName?.());
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
      if (action === "reload") return await workspace.reloadFile(confirmReplacement, options.flushEditor);
      if (action === "overwrite") {
        const generation = workspace.documentGeneration.value;
        const version = workspace.externalChange.value?.version;
        if (!version || !(await prompts.overwrite()) || workspace.documentGeneration.value !== generation) return false;
        options.flushEditor();
        return await workspace.overwriteFile(version);
      }
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
      }
      return true;
    }
    catch (error) {
      await prompts.error("fileAction", error);
      return false;
    }
    finally {
      pending = false;
    }
  }

  /** Run a caller-owned operation under the same confirmation and busy guard. */
  async function confirmAndRun(operation: () => Promise<boolean> = async () => true): Promise<boolean> {
    if (pending) return false;
    pending = true;
    try { return await confirmReplacement() && await operation(); }
    catch (error) { await prompts.error("fileAction", error); return false; }
    finally { pending = false; }
  }

  async function restore(record: RecoverySnapshot): Promise<boolean> {
    if (pending) return false;
    pending = true;
    try { return await workspace.restoreRecovery(record, confirmReplacement, options.flushEditor); }
    catch (error) { await prompts.error("restore", error); return false; }
    finally { pending = false; }
  }

  async function reviewExternalChange(): Promise<boolean> {
    const change = workspace.externalChange.value;
    const generation = workspace.documentGeneration.value;
    if (pending || change?.kind !== "changed" || !change.version) return false;
    if (lastExternalPrompt?.generation === generation && lastExternalPrompt.version === change.version) return false;
    pending = true;
    lastExternalPrompt = { generation, version: change.version };
    try {
      options.flushEditor();
      const promptedContent = workspace.markdown.value;
      if (await prompts.externalChange(workspace.dirty.value) !== "reload") return false;
      return await workspace.reloadFile(async () => {
        options.flushEditor();
        if (workspace.documentGeneration.value !== generation) return false;
        // The reload choice discards only the text shown when asking. Edits
        // arriving during the dialog or disk read need a fresh confirmation.
        return workspace.markdown.value === promptedContent || await confirmReplacement();
      }, options.flushEditor);
    }
    catch (error) {
      lastExternalPrompt = null;
      await prompts.error("fileAction", error);
      return false;
    }
    finally { pending = false; }
  }

  return { run, restore, reviewExternalChange, confirmAndRun, isPending: () => pending };
}
