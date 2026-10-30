import type { ShortcutCommand } from "../config/shortcuts";

export type CommandId = ShortcutCommand | "settings" | "recovery" | "reload" | "overwrite" | "tabClose";
export type CommandRequest =
  | { readonly id: Exclude<CommandId, "tabClose"> }
  | { readonly id: "tabClose"; readonly tabId: string };
export type CommandHandlers = Record<Exclude<CommandId, "tabClose">, () => void> & { tabClose(request: { id: "tabClose"; tabId: string }): void };

/** Dispatch remains synchronous so clipboard handlers keep their user gesture. */
export function createCommandRegistry(handlers: CommandHandlers, enabled: (request: CommandRequest) => boolean) {
  function request(id: string, tabId?: string): CommandRequest | null {
    if (!Object.prototype.hasOwnProperty.call(handlers, id)) return null;
    if (id === "tabClose") return tabId ? { id, tabId } : null;
    return { id: id as Exclude<CommandId, "tabClose"> };
  }
  function canExecute(id: string, tabId?: string): boolean {
    const command = request(id, tabId);
    return !!command && enabled(command);
  }
  function execute(id: string, tabId?: string): boolean {
    const command = request(id, tabId);
    if (!command || !enabled(command)) return false;
    if (command.id === "tabClose") handlers.tabClose(command);
    else handlers[command.id]();
    return true;
  }
  return { canExecute, execute };
}
