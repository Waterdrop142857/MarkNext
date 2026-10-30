import { expect, it, vi } from "vitest";
import { shortcutCommands } from "../../config/shortcuts";
import { createCommandRegistry, type CommandHandlers } from "../commands";

it("rechecks availability, preserves explicit tab targets, and rejects unknown commands", () => {
  const save = vi.fn();
  const tabClose = vi.fn();
  const noop = () => {};
  const handlers = Object.fromEntries([...shortcutCommands.map(command => [command.id, noop]),
    ["settings", noop], ["recovery", noop], ["reload", noop], ["overwrite", noop], ["tabClose", tabClose], ["save", save]]) as CommandHandlers;
  let busy = false;
  const openTabs = new Set(["tab-a"]);
  const registry = createCommandRegistry(handlers, request => !busy && (request.id !== "tabClose" || openTabs.has(request.tabId)));
  expect(registry.canExecute("save")).toBe(true);
  busy = true;
  expect(registry.execute("save")).toBe(false);
  expect(save).not.toHaveBeenCalled();
  busy = false;
  expect(registry.execute("save")).toBe(true);
  expect(save).toHaveBeenCalledOnce();
  expect(registry.execute("tabClose")).toBe(false);
  expect(registry.execute("tabClose", "tab-a")).toBe(true);
  expect(tabClose).toHaveBeenCalledWith({ id: "tabClose", tabId: "tab-a" });
  openTabs.clear();
  expect(registry.execute("tabClose", "tab-a")).toBe(false);
  expect(registry.execute("toString")).toBe(false);
});
