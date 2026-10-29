import type { MessageKey } from "../i18n";

export interface MenuItem {
  id: string;
  label: string;
  checked?: boolean;
  disabled?: boolean;
  shortcut?: string;
}

export interface AppMenu {
  id: string;
  label: string;
  command?: string;
  items: MenuItem[];
}

interface MenuDefinition {
  id: string;
  label: MessageKey;
  command?: string;
  items: (Omit<MenuItem, "label"> & { label: MessageKey })[];
}

export const appMenus: MenuDefinition[] = [
  {
    id: "file",
    label: "menu.file",
    items: [
      { id: "new", label: "command.new" },
      { id: "open", label: "command.open" },
      { id: "save", label: "command.save" },
      { id: "saveAs", label: "command.saveAs" },
      { id: "saveAll", label: "command.saveAll" },
      { id: "recovery", label: "recovery.title" },
      { id: "close", label: "command.close" },
      { id: "closeAll", label: "command.closeAll" },
      { id: "exit", label: "command.exit" },
    ],
  },
  {
    id: "edit",
    label: "menu.edit",
    items: [
      { id: "undo", label: "command.undo" },
      { id: "redo", label: "command.redo" },
      { id: "cut", label: "command.cut" },
      { id: "copy", label: "command.copy" },
      { id: "paste", label: "command.paste" },
      { id: "find", label: "command.find" },
      { id: "replace", label: "command.replace" },
      { id: "findNext", label: "command.findNext" },
      { id: "findPrevious", label: "command.findPrevious" },
      { id: "selectAll", label: "command.selectAll" },
      { id: "toggleMode", label: "command.toggleMode" },
      { id: "clear", label: "command.clear" },
    ],
  },
  {
    id: "theme",
    label: "menu.theme",
    items: [
      { id: "theme-system", label: "command.theme-system" },
      { id: "theme-light", label: "command.theme-light" },
      { id: "theme-dark", label: "command.theme-dark" },
    ],
  },
  {
    id: "settings",
    label: "menu.settings",
    command: "settings",
    items: [],
  },
  {
    id: "paragraph",
    label: "menu.paragraph",
    items: [
      { id: "paragraph", label: "command.paragraph", disabled: true },
    ],
  },
  {
    id: "help",
    label: "menu.help",
    items: [
      ...(import.meta.env.DEV ? [{ id: "devtools", label: "command.devtools" as const }] : []),
      { id: "about", label: "command.about" },
    ],
  },
];
