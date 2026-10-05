import { message } from "@tauri-apps/plugin-dialog";
import { t } from "../i18n";

export type UnsavedChangesChoice = "save" | "discard" | "cancel";

export async function askUnsavedChanges(): Promise<UnsavedChangesChoice> {
  // Capture labels for this dialog: changing language while it is open must
  // not change how its eventual response is interpreted.
  const buttons = { yes: t("command.save"), no: t("dialog.discard"), cancel: t("common.cancel") };
  const result = await message(t("dialog.unsaved"), {
    title: "MarkNext", kind: "warning", buttons,
  });
  if (result === buttons.yes || result === "Yes") return "save";
  if (result === buttons.no || result === "No") return "discard";
  return "cancel";
}

export async function showError(action: string, error: unknown): Promise<void> {
  const details = error instanceof Error ? error.message : String(error);
  console.error(`${action}:`, error);
  try {
    await message(t("error.details", { action, details }), {
      title: "MarkNext", kind: "error", buttons: { ok: t("common.ok") },
    });
  }
  catch (dialogError) {
    console.error("Could not show error dialog:", dialogError);
  }
}
