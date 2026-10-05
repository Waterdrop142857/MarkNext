import { t } from "../i18n";
// Programmatic paste is rejected by some WebViews. Read clipboard content for
// custom shortcuts while keeping the default paste key on the native path.
export async function readClipboardData(): Promise<DataTransfer> {
  const clipboard = navigator.clipboard;
  if (!clipboard) throw new Error(t("clipboard.unavailable"));
  const data = new DataTransfer();
  if (clipboard.read) {
    try {
      const items = await clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          if (type === "text/plain" || type === "text/html") {
            data.setData(type, await (await item.getType(type)).text());
          }
          else if (type.startsWith("image/")) {
            data.items.add(new File([await item.getType(type)], "clipboard-image", { type }));
          }
        }
      }
      return data;
    }
    catch (error) {
      if (!clipboard.readText) throw error;
    }
  }
  if (!clipboard.readText) throw new Error(t("clipboard.unsupported"));
  data.setData("text/plain", await clipboard.readText());
  return data;
}
