import type { MessageKey } from "../i18n";

/** Shared command metadata; importing it never loads an editor engine. */
export const paragraphCommands = [
  { id: "paragraph", label: "command.paragraph", group: "paragraph.headings" },
  { id: "heading1", label: "command.heading1", group: "paragraph.headings" },
  { id: "heading2", label: "command.heading2", group: "paragraph.headings" },
  { id: "heading3", label: "command.heading3", group: "paragraph.headings" },
  { id: "heading4", label: "command.heading4", group: "paragraph.headings" },
  { id: "heading5", label: "command.heading5", group: "paragraph.headings" },
  { id: "heading6", label: "command.heading6", group: "paragraph.headings" },
  { id: "bold", label: "command.bold", group: "paragraph.format" },
  { id: "italic", label: "command.italic", group: "paragraph.format" },
  { id: "strikethrough", label: "command.strikethrough", group: "paragraph.format" },
  { id: "insertTable", label: "command.insertTable", group: "paragraph.insert" },
  { id: "insertImage", label: "command.insertImage", group: "paragraph.insert" },
  { id: "insertLink", label: "command.insertLink", group: "paragraph.insert" },
] as const satisfies readonly { id: string; label: MessageKey; group: MessageKey }[];

export type ParagraphCommand = typeof paragraphCommands[number]["id"];
export const paragraphCommandIds: ReadonlySet<string> = new Set(paragraphCommands.map(command => command.id));
export const headingLevels = { paragraph: 0, heading1: 1, heading2: 2, heading3: 3, heading4: 4, heading5: 5, heading6: 6 } as const;
export function isHeadingCommand(command: ParagraphCommand): command is keyof typeof headingLevels {
  return Object.prototype.hasOwnProperty.call(headingLevels, command);
}

export function createParagraphHandlers(format: (command: ParagraphCommand) => void): Record<ParagraphCommand, () => void> {
  // Every key in the union is produced exactly once by the metadata above.
  return Object.fromEntries(paragraphCommands.map(({ id }) => [id, () => format(id)])) as Record<ParagraphCommand, () => void>;
}
