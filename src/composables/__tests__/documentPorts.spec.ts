import { expect, it, vi } from "vitest";
import { createDocumentController } from "../../document/createDocumentController";
import { useDocumentActions } from "../useDocumentActions";
import type { DocumentPorts } from "../../document/ports";

function memoryPorts(): DocumentPorts {
  return {
    files: {
      canonicalPath: async path => path,
      read: async () => ({ content: "disk", encoding: "utf-8", bom: false, version: "v1" }),
      stamp: async () => "stamp", version: async () => "v1",
      write: async () => "v2",
    },
    picker: { openOne: async () => "/note.md", openMany: async () => ["/note.md"], saveAs: async () => "/note.md" },
    prompts: { unsaved: async () => "discard", overwrite: async () => false, externalChange: async () => "keep", alreadyOpen: async () => {}, error: async () => {} },
    recovery: { list: async () => ({ records: [], unreadable: 0 }), write: async () => {}, remove: async () => {} },
  };
}

it("uses the injected file port and retains edits made while a saved snapshot is pending", async () => {
  const ports = memoryPorts();
  let finish!: (version: string) => void;
  const write = vi.spyOn(ports.files, "write").mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const workspace = createDocumentController(() => "utf-8", ports);
  expect(await workspace.openFile()).toBe(true);
  workspace.markdown.value = "first edit";
  const saving = workspace.saveFile();
  await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
  workspace.markdown.value = "second edit";
  finish("v2");
  expect(await saving).toBe(true);
  expect(write).toHaveBeenCalledWith("/note.md", "first edit", { encoding: "utf-8", bom: false }, "v1");
  expect(workspace.savedMarkdown.value).toBe("first edit");
  expect(workspace.dirty.value).toBe(true);
});

it("uses the injected prompt and leaves the document untouched when replacement is cancelled", async () => {
  const ports = memoryPorts();
  ports.prompts.unsaved = vi.fn().mockResolvedValue("cancel");
  const workspace = createDocumentController(() => "utf-8", ports);
  workspace.newFile(); workspace.markdown.value = "unsaved";
  const actions = useDocumentActions(workspace, ports.prompts, { flushEditor() {} });
  expect(await actions.run("new")).toBe(false);
  expect(ports.prompts.unsaved).toHaveBeenCalledOnce();
  expect(workspace.markdown.value).toBe("unsaved");
  expect(workspace.dirty.value).toBe(true);
});
