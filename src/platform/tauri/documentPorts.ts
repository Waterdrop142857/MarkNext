import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { t } from "../../i18n";
import { askUnsavedChanges, askOverwrite, askExternalChange, informFileAlreadyOpen, showError } from "../../services/dialogs";
import type { DocumentErrorContext, DocumentPorts } from "../../document/ports";
import type { ReadDocument, RecoveryListing } from "../../document/types";

const filters = [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }];
const errorKeys = {
  open: "error.open", save: "error.save", saveAs: "error.saveAs", fileAction: "error.fileAction",
  closeWindow: "error.closeWindow", restore: "recovery.restoreError",
} as const satisfies Record<DocumentErrorContext, Parameters<typeof t>[0]>;

/** Native transport and presentation are composed once at the application edge. */
export function createTauriDocumentPorts(): DocumentPorts {
  return {
    files: {
      canonicalPath: path => invoke<string>("canonical_document_path", { path }),
      read: (path, defaultEncoding) => invoke<ReadDocument>("read_file", { path, defaultEncoding }),
      stamp: path => invoke<string>("file_status", { path }),
      version: path => invoke<string>("file_version", { path }),
      write: (path, content, format, expectedVersion) => invoke<string>("write_file", { path, content, ...format, expectedVersion }),
    },
    picker: {
      async openOne() {
        const selected = await open({ title: t("document.open"), multiple: false, filters });
        return typeof selected === "string" ? selected : null;
      },
      async openMany() {
        const selected = await open({ title: t("document.open"), multiple: true, filters });
        return typeof selected === "string" ? [selected] : selected;
      },
      async saveAs(defaultPath) {
        const selected = await save({ title: t("command.saveAs"), filters, defaultPath });
        return typeof selected === "string" ? selected : null;
      },
    },
    prompts: {
      unsaved: askUnsavedChanges, overwrite: askOverwrite, externalChange: askExternalChange,
      alreadyOpen: informFileAlreadyOpen,
      error: (context, error) => showError(t(errorKeys[context]), error),
    },
    recovery: {
      list: () => invoke<RecoveryListing>("recovery_list"),
      write: snapshot => invoke<void>("recovery_write", { snapshot }),
      remove: id => invoke<void>("recovery_remove", { id }),
    },
  };
}
