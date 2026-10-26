import { t } from "../i18n";
import { computed, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { defaultPreferences, defaultFileFormat, type FileEncoding, type FileFormat } from "../config/preferences";
import { showError } from "../services/dialogs";
import { conflictVersion, newDocumentId, type ExternalChange, type ReadDocument, type RecoverySnapshot } from "../services/documentSafety";

export function useWorkspace(getDefaultEncoding: () => FileEncoding = () => defaultPreferences.defaultEncoding) {
  const markdown = ref("");
  const currentFilePath = ref<string | null>(null);
  const savedMarkdown = ref("");
  const isUntitled = ref(false);
  const isSourceMode = ref(false);
  const selection = ref<unknown>(null);
  const documentGeneration = ref(0);
  const fileFormat = ref<FileFormat | null>(null);
  const documentId = ref(newDocumentId());
  const diskVersion = ref("missing");
  const externalChange = ref<ExternalChange | null>(null);
  const recoveredCopy = ref(false);
  const recoveryNeedsSave = ref(false);
  const savedVersions = new Map<string, string>();
  let writing = 0;
  let checkedDisk: { generation: number; path: string; baseline: string; stamp: string; version: string } | null = null;
  let writeQueue: Promise<unknown> = Promise.resolve();
  let saveAsPending: Promise<boolean> | null = null;
  function setExternalChange(value: ExternalChange | null) {
    if (externalChange.value?.kind !== value?.kind || externalChange.value?.version !== value?.version) externalChange.value = value;
  }

  // Content changes need protection regardless of path or document label.
  const dirty = computed(() => recoveryNeedsSave.value || markdown.value !== savedMarkdown.value);

  function resetSession() {
    checkedDisk = null;
    documentId.value = newDocumentId();
    diskVersion.value = "missing";
    externalChange.value = null;
    recoveredCopy.value = recoveryNeedsSave.value = false;
  }

  async function replaceFromDisk(selected: string, beforeReplace?: () => Promise<boolean>, flushEditor?: () => void, reload = false): Promise<boolean> {
    if (beforeReplace && !(await beforeReplace())) return false;
    const generation = documentGeneration.value;
    let approvedContent = markdown.value;
    const incoming = await invoke<ReadDocument>("read_file", { path: selected, defaultEncoding: reload ? fileFormat.value?.encoding ?? getDefaultEncoding() : getDefaultEncoding() });
    if (typeof incoming.version !== "string") throw new Error("Missing document version");
    for (;;) {
      flushEditor?.();
      if (documentGeneration.value !== generation) return false;
      if (beforeReplace && markdown.value !== approvedContent) {
        if (!(await beforeReplace())) return false;
        approvedContent = markdown.value;
        continue;
      }
      if (!reload) resetSession();
      diskVersion.value = incoming.version;
      externalChange.value = null;
      recoveredCopy.value = recoveryNeedsSave.value = false;
      fileFormat.value = { encoding: incoming.encoding, bom: incoming.bom };
      currentFilePath.value = selected;
      markdown.value = savedMarkdown.value = incoming.content;
      isUntitled.value = false;
      documentGeneration.value += 1;
      checkedDisk = incoming.stamp ? { generation: documentGeneration.value, path: selected, baseline: incoming.version, stamp: incoming.stamp, version: incoming.version } : null;
      return true;
    }
  }

  async function openFile(
    beforeReplace?: () => Promise<boolean>,
    flushEditor?: () => void,
  ): Promise<boolean> {
    try {
      const selected = await open({
        title: t("document.open"),
        multiple: false,
        filters: [
          { name: "Markdown", extensions: ["md", "markdown", "txt"] },
        ],
      });
      if (typeof selected !== "string") return false;
      return await replaceFromDisk(selected, beforeReplace, flushEditor);
    }
    catch (error) {
      await showError(t("error.open"), error);
      return false;
    }
  }

  function newFile() {
    resetSession();
    fileFormat.value = defaultFileFormat(getDefaultEncoding());
    currentFilePath.value = null;
    markdown.value = "";
    savedMarkdown.value = "";
    isUntitled.value = true;
    documentGeneration.value += 1;
  }

  async function writeSnapshot(path: string, content: string, attachPath = false, approvedVersion?: string): Promise<boolean> {
    const generation = documentGeneration.value;
    const format = { ...(fileFormat.value ?? defaultFileFormat(getDefaultEncoding())) };
    const key = `${generation}\0${path}`;
    const expected = approvedVersion ?? diskVersion.value;
    writing += 1;
    const write = writeQueue.catch(() => undefined).then(async () => {
      const expectedVersion = approvedVersion ?? savedVersions.get(key) ?? expected;
      const version = await invoke<string>("write_file", { path, content, ...format, expectedVersion });
      if (typeof version !== "string") throw new Error("Missing saved document version");
      savedVersions.set(key, version);
      return version;
    });
    writeQueue = write;
    try {
      const version = await write;
      if (documentGeneration.value === generation
        && (attachPath || currentFilePath.value === path)) {
        if (attachPath) { currentFilePath.value = path; fileFormat.value = format; }
        savedMarkdown.value = content;
        diskVersion.value = version;
        checkedDisk = null;
        externalChange.value = null;
        recoveredCopy.value = recoveryNeedsSave.value = false;
        isUntitled.value = false;
      }
      return true;
    }
    catch (error) {
      const version = conflictVersion(error);
      if (version !== null && documentGeneration.value === generation && currentFilePath.value === path) {
        setExternalChange({ kind: version === "missing" ? "deleted" : "changed", version });
        return false;
      }
      await showError(t("error.save"), error);
      return false;
    }
    finally { writing -= 1; }
  }

  function saveFileAs(): Promise<boolean> {
    if (saveAsPending) return saveAsPending;
    const task = (async () => {
      const generation = documentGeneration.value;
      try {
        const selected = await save({
          title: t("command.saveAs"),
          filters: [
            { name: "Markdown", extensions: ["md", "markdown", "txt"] },
          ],
          defaultPath: currentFilePath.value ?? "untitled.md",
        });
        if (typeof selected !== "string" || documentGeneration.value !== generation) return false;
        const expected = selected === currentFilePath.value ? undefined : await invoke<string>("file_version", { path: selected });
        if (documentGeneration.value !== generation) return false;
        return await writeSnapshot(selected, markdown.value, true, expected);
      }
      catch (error) {
        await showError(t("error.saveAs"), error);
        return false;
      }
    })();
    saveAsPending = task;
    void task.finally(() => {
      if (saveAsPending === task) saveAsPending = null;
    });
    return task;
  }

  async function saveFile(): Promise<boolean> {
    if (saveAsPending && !(await saveAsPending)) return false;
    const path = currentFilePath.value;
    return path ? writeSnapshot(path, markdown.value) : saveFileAs();
  }

  function closeFile() {
    resetSession();
    fileFormat.value = null;
    currentFilePath.value = null;
    markdown.value = "";
    savedMarkdown.value = "";
    isUntitled.value = false;
    documentGeneration.value += 1;
  }

  function clearContent() {
    markdown.value = "";
  }

  function toggleMode() {
    isSourceMode.value = !isSourceMode.value;
  }

  async function checkExternalChange(): Promise<boolean> {
    const path = currentFilePath.value;
    if (!path || writing) return false;
    const generation = documentGeneration.value;
    const baseline = diskVersion.value;
    try {
      const stamp = await invoke<string>("file_status", { path });
      if (writing || documentGeneration.value !== generation || currentFilePath.value !== path || diskVersion.value !== baseline) return false;
      if (checkedDisk?.generation === generation && checkedDisk.path === path && checkedDisk.baseline === baseline && checkedDisk.stamp === stamp) {
        return checkedDisk.version !== baseline && checkedDisk.version !== "missing";
      }
      const version = await invoke<string>("file_version", { path });
      const after = await invoke<string>("file_status", { path });
      if (writing || documentGeneration.value !== generation || currentFilePath.value !== path || diskVersion.value !== baseline) return false;
      checkedDisk = stamp === after ? { generation, path, baseline, stamp, version } : null;
      setExternalChange(version === baseline ? null : { kind: version === "missing" ? "deleted" : "changed", version });
      return version !== baseline && version !== "missing";
    }
    catch {
      if (!writing && documentGeneration.value === generation && currentFilePath.value === path && diskVersion.value === baseline) {
        checkedDisk = null;
        setExternalChange({ kind: "unavailable", version: null });
      }
      return false;
    }
  }

  async function reloadFile(beforeReplace: () => Promise<boolean>, flushEditor: () => void): Promise<boolean> {
    const path = currentFilePath.value;
    if (!path) return false;
    try { return await replaceFromDisk(path, beforeReplace, flushEditor, true); }
    catch (error) { await showError(t("error.open"), error); return false; }
  }

  async function restoreRecovery(record: RecoverySnapshot, beforeReplace: () => Promise<boolean>, flushEditor: () => void): Promise<boolean> {
    if (!(await beforeReplace())) return false;
    const generation = documentGeneration.value;
    let approvedContent = markdown.value;
    let matches = false;
    if (record.path) {
      try { matches = await invoke<string>("file_version", { path: record.path }) === record.diskVersion && record.diskVersion !== "missing"; }
      catch { /* Missing/unreadable originals restore as independent copies. */ }
    }
    for (;;) {
      flushEditor();
      if (documentGeneration.value !== generation) return false;
      if (markdown.value !== approvedContent) {
        if (!(await beforeReplace())) return false;
        approvedContent = markdown.value;
        continue;
      }
      documentId.value = newDocumentId();
      checkedDisk = null;
      currentFilePath.value = matches ? record.path : null;
      diskVersion.value = matches ? record.diskVersion : "missing";
      fileFormat.value = { encoding: record.encoding, bom: record.bom };
      savedMarkdown.value = matches ? record.savedContent : "";
      markdown.value = record.content;
      isUntitled.value = !matches;
      externalChange.value = null;
      recoveredCopy.value = !!record.path && !matches;
      recoveryNeedsSave.value = true;
      documentGeneration.value += 1;
      isSourceMode.value = record.sourceMode;
      return true;
    }
  }

  return {
    markdown,
    currentFilePath,
    savedMarkdown,
    isUntitled,
    isSourceMode,
    documentGeneration,
    fileFormat,
    documentId,
    diskVersion,
    externalChange,
    recoveredCopy,
    selection,
    dirty,
    openFile,
    newFile,
    saveFileAs,
    saveFile,
    closeFile,
    clearContent,
    toggleMode,
    checkExternalChange,
    reloadFile,
    restoreRecovery,
    overwriteFile: (version: string) => currentFilePath.value ? writeSnapshot(currentFilePath.value, markdown.value, false, version) : Promise.resolve(false),
  };
}
