import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n, t } from "..";
import { askUnsavedChanges, showError } from "../../services/dialogs";

const native = vi.hoisted(() => ({ message: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: native.message }));
afterEach(() => { native.message.mockReset(); vi.restoreAllMocks(); });

describe("localized native dialogs", () => {
  for (const locale of ["en", "zh-CN"] as const) {
    it.each(["save", "discard", "cancel"] as const)(`${locale}: maps a displayed %s label to a stable choice`, async choice => {
      i18n.setLocale(locale);
      const labels = { save: t("command.save"), discard: t("dialog.discard"), cancel: t("common.cancel") };
      native.message.mockResolvedValue(labels[choice]);
      expect(await askUnsavedChanges()).toBe(choice);
      expect(native.message).toHaveBeenCalledWith(t("dialog.unsaved"), expect.objectContaining({
        buttons: { yes: labels.save, no: labels.discard, cancel: labels.cancel },
      }));
    });
  }
  it.each([["Yes", "save"], ["No", "discard"], ["Cancel", "cancel"], ["unexpected", "cancel"]])("handles native %s conservatively", async (result, expected) => {
    i18n.setLocale("en"); native.message.mockResolvedValue(result); expect(await askUnsavedChanges()).toBe(expected);
  });
  it("uses the displayed labels even if the language changes while the dialog is pending", async () => {
    i18n.setLocale("en"); let answer!: (choice: string) => void;
    native.message.mockImplementation(() => new Promise<string>(resolve => { answer = resolve; }));
    const pending = askUnsavedChanges(); i18n.setLocale("zh-CN"); answer("Don't Save");
    expect(await pending).toBe("discard");
  });
  it("localizes error text and OK while preserving the diagnostic verbatim", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {}); i18n.setLocale("en");
    native.message.mockResolvedValue("OK");
    await showError(t("error.save"), new Error("/中文/file.md: EACCES {details}"));
    expect(native.message).toHaveBeenCalledWith("Could Not Save File: /中文/file.md: EACCES {details}", expect.objectContaining({ buttons: { ok: "OK" } }));
  });
});
