import { isNativeClipboardShortcut, resolveShortcut, shortcutFromEvent, textEditingCommands } from "../config/shortcuts";
import type { ShortcutBindings, ShortcutCommand } from "../config/shortcuts";

export function createShortcutHandler(options: {
  bindings: () => ShortcutBindings;
  defaults: ShortcutBindings;
  blocked: () => boolean;
  execute: (command: ShortcutCommand) => void;
}) {
  return (event: KeyboardEvent) => {
    if (options.blocked() || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    const target = event.target as HTMLElement | null;
    const inEditor = !!target?.closest?.(".editor-area");
    const inTextInput = !inEditor && !!target?.closest?.('input, textarea, [contenteditable="true"]');
    const bindings = options.bindings();
    const command = resolveShortcut(event, bindings);
    if (command) {
      if (inTextInput && textEditingCommands.has(command)) return;
      if (inEditor && isNativeClipboardShortcut(command, event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!inEditor && ["cut", "copy", "paste", "selectAll", "clear"].includes(command)) return;
      if (!event.repeat || ["undo", "redo"].includes(command)) options.execute(command);
      return;
    }
    // Stop removed default bindings from leaking into Muya, CodeMirror or the WebView.
    const previous = resolveShortcut(event, options.defaults);
    if (previous && !(inTextInput && textEditingCommands.has(previous)) && shortcutFromEvent(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
}
