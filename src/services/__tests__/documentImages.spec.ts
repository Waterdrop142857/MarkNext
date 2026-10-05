import { afterEach, describe, expect, it, vi } from "vitest";
import { createDocumentImageResolver, resolveLocalImagePath } from "../documentImages";
import { loadImage } from "../../muya/utils/image";

const native = vi.hoisted(() => ({ invoke: vi.fn(), convert: vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, convertFileSrc: native.convert }));
afterEach(() => { vi.unstubAllGlobals(); native.invoke.mockReset(); native.convert.mockClear(); });

describe("document image context", () => {
  it.each([
    ["images/picture.png", "/docs/note.md", "/docs/images/picture.png"],
    ["../共享/图片 (1).png", "/docs/sub/note.md", "/docs/共享/图片 (1).png"],
    ["images/a%20b%23c.png", "/docs/note.md", "/docs/images/a b#c.png"],
    ["../../../a.svg", "/docs/note.md", "/a.svg"],
    ["images\\a.png", "C:\\docs\\note.md", "C:/docs/images/a.png"],
    ["../../a.png", "C:\\docs\\note.md", "C:/a.png"],
    ["../../a.png", "\\\\server\\share\\docs\\note.md", "//server/share/a.png"],
    ["/absolute/picture.webp", "/docs/note.md", "/absolute/picture.webp"],
    ["file:///C:/docs/a%20b.png", null, "C:/docs/a b.png"],
    ["file://server/share/a.png", null, "//server/share/a.png"],
    ["images/a.png", null, null],
    ["javascript:alert(1)", "/docs/note.md", null],
    ["note.md", "/docs/note.md", null],
    ["https://example.com/image", null, undefined],
    ["data:image/png;base64,AA==", null, undefined],
    ["blob:https://localhost/id", null, undefined],
  ])("resolves %s in %s", (source, document, expected) => {
    expect(resolveLocalImagePath(source!, document ?? null)).toBe(expected);
  });

  it("uses current path after save-as and coalesces permission requests", async () => {
    native.invoke.mockResolvedValue(undefined);
    let document = "/docs/note.md";
    const images = createDocumentImageResolver(() => document);
    const first = images.resolve("images/a.png")!;
    await Promise.all([images.prepare(first), images.prepare(first)]);
    expect(native.invoke).toHaveBeenCalledTimes(1);
    expect(native.invoke).toHaveBeenCalledWith("allow_image_file", { path: "/docs/images/a.png" });
    document = "/other/note.md"; images.reset();
    const second = images.resolve("images/a.png")!;
    expect(second).not.toBe(first);
    await images.prepare(second);
    expect(native.invoke).toHaveBeenLastCalledWith("allow_image_file", { path: "/other/images/a.png" });
  });

  it("does not authorize remote resources or unresolved untitled paths", async () => {
    const images = createDocumentImageResolver(() => null);
    expect(images.resolve("images/a.png")).toBe("");
    expect(images.resolve("https://example.com/a.png")).toBeUndefined();
    await images.prepare("https://example.com/a.png");
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it("waits for permission before any image request and permits a retry after rejection", async () => {
    const requests: string[] = [];
    vi.stubGlobal("Image", class {
      width = 1; height = 1; onload?: () => void;
      set src(value: string) { requests.push(value); queueMicrotask(() => this.onload?.()); }
    });
    let grant!: () => void;
    native.invoke.mockImplementationOnce(() => new Promise<void>(resolve => { grant = resolve; }));
    const images = createDocumentImageResolver(() => "/docs/note.md");
    const url = images.resolve("images/a.png")!;
    const loading = loadImage(url, false, images.prepare);
    expect(requests).toEqual([]);
    grant(); await loading;
    expect(requests).toEqual([url]);
    images.reset(); images.resolve("images/a.png");
    native.invoke.mockRejectedValueOnce(new Error("denied"));
    await expect(loadImage(url, false, images.prepare)).rejects.toThrow("denied");
    expect(requests).toEqual([url]);
    native.invoke.mockResolvedValueOnce(undefined);
    await loadImage(url, false, images.prepare);
    expect(requests).toEqual([url, url]);
  });
});
