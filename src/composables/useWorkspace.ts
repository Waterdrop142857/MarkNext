import { computed, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

export function useWorkspace() {
  const markdown = ref("");
  const currentFilePath = ref<string | null>(null);
  const savedMarkdown = ref("");
  const isUntitled = ref(false);
  const isSourceMode = ref(false);
  const selection = ref<unknown>(null);

  const dirty = computed(
    () => (isUntitled.value || currentFilePath.value !== null)
      && markdown.value !== savedMarkdown.value,
  );

  async function openFile() {
    const selected = await open({
      multiple: false,
      filters: [
        { name: "Markdown", extensions: ["md", "markdown", "txt"] },
      ],
    });

    if (typeof selected !== "string") return;

    try {
      const content = await invoke<string>("read_file", { path: selected });
      currentFilePath.value = selected;
      markdown.value = content;
      savedMarkdown.value = content;
      isUntitled.value = false;
    }
    catch (error) {
      console.error("Failed to open file:", error);
    }
  }

  function newFile() {
    currentFilePath.value = null;
    markdown.value = "";
    savedMarkdown.value = "";
    isUntitled.value = true;
  }

  async function saveFileAs() {
    const selected = await save({
      filters: [
        { name: "Markdown", extensions: ["md", "markdown", "txt"] },
      ],
      defaultPath: currentFilePath.value ?? "untitled.md",
    });

    if (typeof selected !== "string") return;

    try {
      await invoke("write_file", { path: selected, content: markdown.value });
      currentFilePath.value = selected;
      savedMarkdown.value = markdown.value;
      isUntitled.value = false;
    }
    catch (error) {
      console.error("Failed to save file:", error);
    }
  }

  async function saveFile() {
    if (currentFilePath.value) {
      try {
        await invoke("write_file", {
          path: currentFilePath.value,
          content: markdown.value,
        });
        savedMarkdown.value = markdown.value;
      }
      catch (error) {
        console.error("Failed to save file:", error);
      }
    }
    else {
      await saveFileAs();
    }
  }

  function closeFile() {
    currentFilePath.value = null;
    markdown.value = "";
    savedMarkdown.value = "";
    isUntitled.value = false;
  }

  function resetExample() {
    currentFilePath.value = null;
    const content =
      "# Hello Muya\n\nStart typing **bold**, *italic*, `code`, or a list:\n\n- item 1\n- item 2\n\nLink: [Example](https://example.com)\n\nTodo:\n\n- [ ] Buy milk\n- [x] Write code\n";
    markdown.value = content;
    savedMarkdown.value = content;
    isUntitled.value = false;
  }

  function clearContent() {
    markdown.value = "";
  }

  function toggleMode() {
    isSourceMode.value = !isSourceMode.value;
  }

  return {
    markdown,
    currentFilePath,
    savedMarkdown,
    isUntitled,
    isSourceMode,
    selection,
    dirty,
    openFile,
    newFile,
    saveFileAs,
    saveFile,
    closeFile,
    resetExample,
    clearContent,
    toggleMode,
  };
}