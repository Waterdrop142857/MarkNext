import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

// Test-only entry point. The production bundle starts from index.html and
// never imports these native mocks; all UI/editor code remains the real app.
export interface NativeFixture {
  openPath: string;
  savePath: string;
  allowedImages: string[];
  disk: Record<string, string>;
  choices: string[];
  prompts: string[];
  promptButtons: unknown[];
  dialogTitles: string[];
  errors: string[];
  reads: string[];
  writeFormats: { encoding: string; bom: boolean }[];
  fileFormats: Record<string, { encoding: string; bom: boolean }>;
  writes: { path: string; content: string }[];
  delayReads: boolean;
  readPending: boolean;
  destroyed: boolean;
  finishRead: () => void;
}
declare global { interface Window { nativeFixture: NativeFixture } }

let completeRead: (() => void) | null = null;
const fixture: NativeFixture = {
  openPath: "/old.md", disk: { "/old.md": "original", "/new.md": "replacement" },
  savePath: "/saved.md", allowedImages: [],
  choices: [], prompts: [], promptButtons: [], dialogTitles: [], errors: [], reads: [], writes: [], writeFormats: [], fileFormats: {}, delayReads: false,
  readPending: false, destroyed: false,
  finishRead() {
    if (!completeRead) throw new Error("No pending file read");
    completeRead();
    completeRead = null;
  },
};
window.nativeFixture = fixture;
mockWindows("main");
// Native asset URLs are represented by a local SVG fixture in browser tests.
// Production still uses the SDK's real platform-specific convertFileSrc.
const internals: { convertFileSrc: (path: string) => string } = Reflect.get(window, "__TAURI_INTERNALS__");
internals.convertFileSrc = path => `/tests/e2e/fixtures/pixel.svg?path=${encodeURIComponent(path)}`;
mockIPC((command, args) => {
  const payload = args && !Array.isArray(args) && !(args instanceof ArrayBuffer) && !(args instanceof Uint8Array) ? args : {};
  if (command === "plugin:dialog|open") { fixture.dialogTitles.push(String(payload.options && (payload.options as { title?: string }).title)); return fixture.openPath; }
  if (command === "plugin:dialog|save") return fixture.savePath;
  if (command === "allow_image_file") { fixture.allowedImages.push(String(payload.path)); return; }
  if (command === "plugin:dialog|message") {
    if (payload.kind === "error") { fixture.errors.push(String(payload.message)); return "Ok"; }
    fixture.prompts.push(String(payload.message));
    fixture.promptButtons.push(payload.buttons);
    const choice = fixture.choices.shift();
    if (!choice) throw new Error("Unexpected unsaved-changes confirmation");
    return choice;
  }
  if (command === "read_file") {
    const path = String(payload.path);
    fixture.reads.push(path);
    const document = () => ({ content: fixture.disk[path], ...(fixture.fileFormats[path] ?? { encoding: "utf-8", bom: false }) });
    if (!fixture.delayReads) return document();
    fixture.readPending = true;
    return new Promise<ReturnType<typeof document>>(resolve => {
      completeRead = () => { fixture.readPending = false; resolve(document()); };
    });
  }
  if (command === "write_file") {
    const path = String(payload.path);
    const content = String(payload.content);
    fixture.writes.push({ path, content });
    const format = { encoding: String(payload.encoding ?? "utf-8"), bom: Boolean(payload.bom) };
    fixture.writeFormats.push(format); fixture.fileFormats[path] = format;
    fixture.disk[path] = content;
    return;
  }
  if (command === "plugin:window|is_maximized") return false;
  if (command === "plugin:window|destroy") { fixture.destroyed = true; return; }
  throw new Error(`Unexpected native command: ${command}`);
}, { shouldMockEvents: true });

// Bootstrap after mocks are ready, before App imports the native window API.
await import("../../src/main");
