import { test, vi } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { i18n } from "../../i18n";
import { createDocumentController } from "../createDocumentController";
import { useDocumentActions } from "../useDocumentActions";
import { createTauriDocumentPorts } from "../../platform/tauri/documentPorts";
import { useWindowChrome } from "../../composables/useWindowChrome";

const native = vi.hoisted(() => ({ dialog: null, invoke: null, getWindow: null, onUnmount: null }));
vi.mock("vue", async importOriginal => ({ ...await importOriginal(), onBeforeUnmount: callback => native.onUnmount(callback) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args) => native.dialog.open(...args), save: (...args) => native.dialog.save(...args),
  message: (...args) => native.dialog.message(...args),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args) => native.invoke(...args) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native.getWindow() }));

const root = process.cwd();
i18n.setLocale("zh-CN");

function harness(choices = ['不保存'], options = {}) {
  const disk = new Map([['/old.md', 'saved'], ['/new.md', 'next document']]);
  const prompts = [];
  const errors = [];
  const unmount = [];
  let destroyed = 0;
  let unlistened = 0;
  let closeHandler;
  let workspace;
  const dialog = {
    open: async () => options.openPath === undefined ? '/new.md' : options.openPath,
    save: async () => options.savePath === undefined ? '/saved.md' : options.savePath,
    async message(text, config) {
      if (config.kind === 'error') {
        errors.push(text);
        return 'Ok';
      }
      prompts.push(config);
      if (options.prompt) return options.prompt();
      assert.ok(choices.length, 'Unexpected extra confirmation');
      return choices.shift();
    },
  };
  native.dialog = dialog;
  native.invoke = async (command, args) => {
    if (command === 'read_file') return { content: disk.get(args.path), encoding: 'utf-8', bom: false, version: disk.get(args.path) };
    if (command === 'file_version') return disk.get(args.path) ?? 'missing';
    assert.equal(command, 'write_file');
    if (options.failSave) throw new Error('simulated write failure');
    disk.set(args.path, args.content);
    options.afterWrite?.(workspace);
    return args.content;
  };
  const ports = createTauriDocumentPorts();
  workspace = createDocumentController(() => 'utf-8', ports);
  workspace.currentFilePath.value = '/old.md';
  workspace.savedMarkdown.value = 'saved';
  workspace.markdown.value = 'edited';

  native.onUnmount = callback => unmount.push(callback);
  native.getWindow = () => ({
    async destroy() {
      if (options.failClose) throw new Error('simulated permission denial');
      destroyed++;
    },
    async onCloseRequested(callback) {
      closeHandler = callback;
      await options.registration;
      return () => unlistened++;
    },
    isMaximized: async () => false,
    onResized: async () => () => unlistened++,
  });
  const chrome = useWindowChrome();
  const documentActions = useDocumentActions(workspace, ports.prompts, {
    flushEditor: () => options.flush?.(workspace),
  });
  const actions = { run: action => action === 'exit'
    ? documentActions.confirmAndRun(async () => {
      try { await chrome.destroyWindow(); return true; }
      catch (error) { await ports.prompts.error('closeWindow', error); return false; }
    })
    : documentActions.run(action) };
  return {
    workspace, actions, disk, prompts, errors,
    destroyed: () => destroyed,
    unlistened: () => unlistened,
    init: () => chrome.initWindowState(() => actions.run('exit')),
    nativeClose: event => closeHandler(event),
    unmount: () => unmount.forEach(callback => callback()),
  };
}

for (const action of ['new', 'open', 'close', 'exit']) {
  for (const choice of ['保存', '不保存', '取消', 'Yes', 'No', 'Cancel', 'unknown']) {
    test(`${action}: ${choice}`, async () => {
      const h = harness([choice]);
      const proceed = ['保存', '不保存', 'Yes', 'No'].includes(choice);
      assert.equal(await h.actions.run(action), proceed);
      assert.equal(h.prompts.length, 1);
      assert.equal(h.disk.get('/old.md'), ['保存', 'Yes'].includes(choice) ? 'edited' : 'saved');
      assert.equal(h.destroyed(), proceed && action === 'exit' ? 1 : 0);
      if (!proceed || action === 'exit') {
        assert.equal(h.workspace.markdown.value, 'edited');
        assert.equal(h.workspace.currentFilePath.value, '/old.md');
        assert.equal(h.workspace.documentGeneration.value, 0);
      }
      else {
        assert.equal(h.workspace.documentGeneration.value, 1);
        assert.equal(h.workspace.currentFilePath.value, action === 'open' ? '/new.md' : null);
        if (action === 'new' || action === 'close') assert.equal(h.workspace.markdown.value, '');
        if (action === 'new') assert.equal(h.workspace.isUntitled.value, true);
        if (action === 'open') assert.equal(h.workspace.markdown.value, 'next document');
      }
    });
  }
  test(`${action}: save failure cancels the action`, async () => {
    const h = harness(['保存'], { failSave: true });
    assert.equal(await h.actions.run(action), false);
    assert.equal(h.workspace.markdown.value, 'edited');
    assert.equal(h.workspace.documentGeneration.value, 0);
    assert.equal(h.workspace.dirty.value, true);
    assert.equal(h.destroyed(), 0);
    assert.equal(h.errors.length, 1);
  });
}

for (const choice of ['保存', '不保存', '取消']) {
  test(`system close uses the same confirmation: ${choice}`, async () => {
    const h = harness([choice]);
    await h.init();
    let prevented = false;
    const closing = h.nativeClose({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    await closing;
    assert.equal(h.destroyed(), choice === '取消' ? 0 : 1);
    assert.equal(h.prompts.length, 1);
    assert.equal(h.disk.get('/old.md'), choice === '保存' ? 'edited' : 'saved');
    h.unmount();
    assert.equal(h.unlistened(), 2);
  });
}

test('repeated close/new requests share one pending confirmation', async () => {
  let answer;
  const h = harness([], { prompt: () => new Promise(resolve => { answer = resolve; }) });
  await h.init();
  const first = h.actions.run('exit');
  let prevented = false;
  await h.nativeClose({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(await h.actions.run('new'), false);
  assert.equal(h.prompts.length, 1);
  answer('不保存');
  assert.equal(await first, true);
  assert.equal(h.destroyed(), 1);
});

test('a failed close reports the error and permits retry', async () => {
  const options = { failClose: true };
  const h = harness(['不保存', '不保存'], options);
  assert.equal(await h.actions.run('exit'), false);
  assert.equal(h.errors.length, 1);
  assert.match(h.errors[0], /关闭窗口失败/);
  options.failClose = false;
  assert.equal(await h.actions.run('exit'), true);
  assert.equal(h.destroyed(), 1);
});

test('edits made during save require another confirmation before closing', async () => {
  const h = harness(['保存', '取消'], { afterWrite: ws => { ws.markdown.value = 'new edits'; } });
  assert.equal(await h.actions.run('exit'), false);
  assert.equal(h.prompts.length, 2);
  assert.equal(h.disk.get('/old.md'), 'edited');
  assert.equal(h.workspace.dirty.value, true);
  assert.equal(h.destroyed(), 0);
});

test('canceling Save As aborts an untitled document close', async () => {
  const h = harness(['保存'], { savePath: null });
  h.workspace.currentFilePath.value = null;
  h.workspace.isUntitled.value = true;
  assert.equal(await h.actions.run('exit'), false);
  assert.equal(h.destroyed(), 0);
  assert.equal(h.workspace.markdown.value, 'edited');
});

test('canceling the open picker does not prompt or change the document', async () => {
  const h = harness([], { openPath: null });
  assert.equal(await h.actions.run('open'), false);
  assert.equal(h.prompts.length, 0);
  assert.equal(h.workspace.markdown.value, 'edited');
});

test('a clean document closes without a prompt', async () => {
  const h = harness([]);
  h.workspace.markdown.value = 'saved';
  assert.equal(await h.actions.run('exit'), true);
  assert.equal(h.prompts.length, 0);
  assert.equal(h.destroyed(), 1);
});

for (const action of ['new', 'open', 'close', 'exit']) {
  for (const choice of ['保存', '不保存', '取消']) {
    test(`content without a path or label is protected for ${action}: ${choice}`, async () => {
      const h = harness([choice]);
      h.workspace.closeFile();
      assert.equal(h.workspace.dirty.value, false);
      h.workspace.markdown.value += '\nUser edits that must be protected';
      const content = h.workspace.markdown.value;
      const generation = h.workspace.documentGeneration.value;
      assert.equal(h.workspace.dirty.value, true);
      assert.equal(await h.actions.run(action), choice !== '取消');
      assert.equal(h.prompts.length, 1);
      assert.equal(h.disk.get('/old.md'), 'saved');
      if (choice === '保存') assert.equal(h.disk.get('/saved.md'), content);
      else assert.equal(h.disk.has('/saved.md'), false);
      if (choice === '取消') {
        assert.equal(h.workspace.markdown.value, content);
        assert.equal(h.workspace.documentGeneration.value, generation);
        assert.equal(h.destroyed(), 0);
      }
      else if (action === 'new') {
        assert.equal(h.workspace.markdown.value, '');
        assert.equal(h.workspace.isUntitled.value, true);
      }
    });
  }
}

test('blank untitled documents do not prompt, but typing then creating a new document does', async () => {
  const h = harness(['取消']);
  h.workspace.newFile();
  assert.equal(await h.actions.run('new'), true);
  assert.equal(h.prompts.length, 0);
  h.workspace.markdown.value = 'unsaved new document';
  assert.equal(await h.actions.run('new'), false);
  assert.equal(h.prompts.length, 1);
  assert.equal(h.workspace.markdown.value, 'unsaved new document');
});

test('pending editor edits are flushed before deciding whether to prompt', async () => {
  const h = harness(['取消'], { flush: ws => { ws.markdown.value = 'last keystroke'; } });
  h.workspace.markdown.value = h.workspace.savedMarkdown.value;
  assert.equal(h.workspace.dirty.value, false);
  assert.equal(await h.actions.run('new'), false);
  assert.equal(h.prompts.length, 1);
  assert.equal(h.workspace.markdown.value, 'last keystroke');
});

test('content changes are protected even without a path or an untitled flag', async () => {
  const h = harness(['取消']);
  h.workspace.closeFile();
  h.workspace.markdown.value = 'untracked editor content';
  assert.equal(await h.actions.run('new'), false);
  assert.equal(h.prompts.length, 1);
  assert.equal(h.workspace.markdown.value, 'untracked editor content');
});

test('a dialog failure preserves the current document', async () => {
  const h = harness([], { prompt() { throw new Error('dialog unavailable'); } });
  assert.equal(await h.actions.run('new'), false);
  assert.equal(h.workspace.markdown.value, 'edited');
  assert.equal(h.errors.length, 1);
});

test('listeners finishing registration after unmount are removed', async () => {
  let finish;
  const h = harness([], { registration: new Promise(resolve => { finish = resolve; }) });
  const ready = h.init();
  h.unmount();
  finish();
  await ready;
  assert.equal(h.unlistened(), 1);
});

test('the main window has permission for the approved destroy operation', () => {
  const capability = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/capabilities/default.json'), 'utf8'));
  assert.ok(capability.windows.includes('main'));
  assert.ok(capability.permissions.includes('core:window:allow-destroy'));
});
