"""Export PDFs through the real Tauri UI and native WebKitGTK print engine.

Run under a private D-Bus session with a dedicated Xvfb display. Uses real
dialogs and keyboard input; PDF dimensions/content are inspected with Poppler.
"""
import argparse
import os
import re
from pathlib import Path
import subprocess
import tempfile
import time
import unicodedata
import xml.etree.ElementTree as ET


def run(args):
    repo = Path(__file__).resolve().parents[2]
    if args.display == os.environ.get("DISPLAY"):
        raise RuntimeError("Use a dedicated Xvfb display, not the current desktop")
    artifacts = Path(args.artifacts).resolve()
    artifacts.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="marknext-pdf-") as temporary:
        profile = Path(temporary)
        env = os.environ.copy()
        env.update(DISPLAY=args.display, GDK_BACKEND="x11", GTK_USE_PORTAL="0", NO_AT_BRIDGE="1",
                   WEBKIT_DISABLE_DMABUF_RENDERER="1", LIBGL_ALWAYS_SOFTWARE="1", LANG=args.locale,
                   LC_ALL=args.locale, LANGUAGE=args.locale.split(".")[0],
                   XDG_CONFIG_HOME=str(profile / "config"), XDG_DATA_HOME=str(profile / "data"),
                   XDG_CACHE_HOME=str(profile / "cache"))
        env.pop("WAYLAND_DISPLAY", None)
        image = profile / "图片 # %.svg"
        image.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#15934a"/></svg>')
        source = profile / "PDF source # %.md"
        markdown = """LEFT_MARGIN_PROOF

# Native PDF test / 原生导出测试

Chinese text 中文正文 and **bold**, *italic*, ~~deleted~~.

Inline math $x^2 + y^2 = z^2$.

$$
\\frac{1}{2} + \\sqrt{x}
$$

```typescript
const answer: number = 42;
```

```mermaid
graph LR
StartNode --> EndNode
```

![Local image](%E5%9B%BE%E7%89%87%20%23%20%25.svg)

[PDF link](https://example.test/pdf-link)

| Column A | Column B |
| --- | --- |
""" + "".join(f"| Row {n} | TABLE_PROOF_{n} |\n" for n in range(35)) + "\n" + "\n\n".join(
            f"PARAGRAPH_{n:03d} " + "A stable native PDF export keeps the complete document. " * 4 for n in range(65)
        ) + "\n\nEND_OF_DOCUMENT_PROOF\n"
        source.write_text(markdown)

        def command(*values):
            return subprocess.check_output(values, cwd=repo, env=env, text=True, timeout=15).strip()

        def keys(*values):
            command("xdotool", "key", "--clearmodifiers", *values)

        def type_text(value):
            command("xdotool", "type", "--clearmodifiers", "--delay", "0", str(value))

        def wait(predicate, seconds=20):
            until = time.monotonic() + seconds
            while time.monotonic() < until:
                if app.poll() is not None:
                    raise RuntimeError(f"Tauri exited with {app.returncode}")
                try:
                    if predicate():
                        return
                except subprocess.CalledProcessError:
                    pass  # xdotool returns 1 while the window is not mapped yet.
                time.sleep(.15)
            raise TimeoutError("Native PDF test condition was not reached")

        def screenshot(name):
            subprocess.run(["python3", "-c", "import gi; gi.require_version('Gdk','3.0'); from gi.repository import Gdk; "
                            "w=Gdk.get_default_root_window(); "
                            "Gdk.pixbuf_get_from_window(w,0,0,w.get_width(),w.get_height()).savev(__import__('sys').argv[1],'png',[],[])",
                            str(artifacts / f"{name}.png")], env=env, check=True, timeout=10)

        with (artifacts / "app.log").open("w") as log:
            app = subprocess.Popen([str(Path(args.binary).resolve()), str(source)], cwd=repo, env=env, stdout=log, stderr=subprocess.STDOUT)
            try:
                wait(lambda: bool(command("xdotool", "search", "--onlyvisible", "--name", "^MarkNext$")))
                time.sleep(3)  # Real editor/module warmup, not a replacement for PDF assertions.
                screenshot("editor")
                if args.html_only:
                    command("xdotool", "mousemove", "24", "66", "click", "1")
                    time.sleep(.15)
                    command("xdotool", "mousemove", "70", "325", "click", "1")
                    time.sleep(.4)
                    screenshot("html-settings")
                    keys("Tab", "Return")  # HTML dialog focuses Cancel first.
                    time.sleep(.8)
                    output = artifacts / "portable.htm"
                    output.unlink(missing_ok=True)
                    keys("ctrl+a")
                    type_text(output)
                    keys("Return")
                    wait(lambda: output.is_file(), 100)
                    html = output.read_text()
                    assert html.startswith("<!DOCTYPE html>")
                    for token in ["中文正文", "StartNode", "EndNode", "answer", "TABLE_PROOF_34", "PARAGRAPH_064", "END_OF_DOCUMENT_PROOF", 'class="katex', 'class="token keyword"', "data:image/svg+xml;base64,", "Content-Security-Policy"]:
                        assert token in html, f"Missing HTML content: {token}"
                    assert "<script" not in html.lower()
                    assert "asset://" not in html
                    fonts = re.findall(r"@font-face\s*\{[^}]*\}", html)
                    assert len(fonts) == 20
                    assert all(re.search(r"src:\s*url\(data:font/woff2;base64,", face) for face in fonts)
                    assert all(face.count("base64,") == 1 and 'format("truetype")' not in face for face in fonts)
                    assert source.read_text() == markdown
                    screenshot("html-done")
                    print("PASS HTML: portable file with embedded image, formulas, highlighted code, diagram and complete source", flush=True)
                    return
                cases = [
                    ("a4", 0, False, None, (20, 20, 20, 20), (210, 297)),
                    ("b5-landscape", 2, True, None, (12, 18, 10, 30), (250, 176)),
                    ("custom", 4, False, (160, 210), (25, 35, 15, 25), (160, 210)),
                ]
                if args.only_empty:
                    cases = []
                for name, paper, landscape, custom, margins, size in cases:
                    command("xdotool", "mousemove", "24", "66", "click", "1")
                    time.sleep(.15)
                    command("xdotool", "mousemove", "70", "289", "click", "1")
                    time.sleep(.4)
                    keys("Home", *("Down" for _ in range(paper)), "Tab")
                    keys("End" if landscape else "Home", "Tab")
                    if custom:
                        for value in custom:
                            keys("ctrl+a")
                            type_text(value)
                            keys("Tab")
                    for value in margins:
                        keys("ctrl+a")
                        type_text(value)
                        keys("Tab")
                    screenshot(f"{name}-settings")
                    keys("Tab", "Return")  # Cancel -> Export.
                    time.sleep(.8)
                    output = artifacts / f"{name}.pdf"
                    output.unlink(missing_ok=True)
                    keys("ctrl+a")
                    type_text(output)
                    keys("Return")
                    wait(lambda: output.is_file(), 100)
                    # The final PDF is atomically installed only after native completion.
                    bbox = command("pdftotext", "-bbox", str(output), "-")
                    (artifacts / f"{name}.bbox.html").write_text(bbox)
                    pages = ET.fromstring(bbox).findall(".//{*}page")
                    assert len(pages) > 1, "Expected a genuinely paginated document"
                    width, height = (value * 72 / 25.4 for value in size)
                    top, bottom, left, right = (value * 72 / 25.4 for value in margins)
                    for page in pages:
                        assert abs(float(page.attrib["width"]) - width) < 1.1
                        assert abs(float(page.attrib["height"]) - height) < 1.1
                        for word in page.findall(".//{*}word"):
                            assert float(word.attrib["xMin"]) >= left - 2, word.text
                            assert float(word.attrib["xMax"]) <= width - right + 2, word.text
                            assert float(word.attrib["yMin"]) >= top - 2, word.text
                            assert float(word.attrib["yMax"]) <= height - bottom + 2, word.text
                    first = next(word for word in pages[0].findall(".//{*}word") if word.text == "LEFT_MARGIN_PROOF")
                    assert abs(float(first.attrib["xMin"]) - left) < 1
                    text = command("pdftotext", "-layout", str(output), "-")
                    # Some CJK fonts map shared glyphs to compatibility radical
                    # code points in the PDF. Compare Unicode-normalized text.
                    text = unicodedata.normalize("NFKC", text)
                    for token in ["中文正文", "StartNode", "EndNode", "answer", "TABLE_PROOF_34", "PARAGRAPH_064", "END_OF_DOCUMENT_PROOF"]:
                        assert token in text, f"Missing PDF content: {token}"
                    subprocess.run(["pdftoppm", "-f", "1", "-singlefile", "-scale-to", "1000", "-png", str(output), str(artifacts / name)], check=True, timeout=20)
                    screenshot(f"{name}-done")
                    print(f"PASS {name}: {len(pages)} pages, size={size} mm, margins={margins} mm, full content and diagrams", flush=True)
                    time.sleep(.3)
                assert source.read_text() == markdown, "Export must never modify the source document"
                # An empty, never-saved tab must produce a blank PDF without
                # requiring a Markdown save or inheriting the previous file.
                keys("ctrl+n")
                time.sleep(.5)
                command("xdotool", "mousemove", "24", "66", "click", "1")
                time.sleep(.15)
                command("xdotool", "mousemove", "70", "289", "click", "1")
                time.sleep(.4)
                keys(*("Tab" for _ in range(7)), "Return")
                time.sleep(.8)
                output = artifacts / "empty.pdf"
                output.unlink(missing_ok=True)
                keys("ctrl+a")
                type_text(output)
                keys("Return")
                wait(lambda: output.is_file(), 100)
                assert command("pdftotext", str(output), "-") == ""
                assert "Pages:           1" in command("pdfinfo", str(output))
                print("PASS empty: one blank page from a never-saved document", flush=True)
            except Exception:
                screenshot("failure")
                raise
            finally:
                app.terminate()
                try:
                    app.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    app.kill()
                    app.wait()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--display", required=True)
    parser.add_argument("--binary", default="src-tauri/target/debug/marknext")
    parser.add_argument("--artifacts", default="test-results/native-pdf")
    parser.add_argument("--locale", default="en_US.UTF-8")
    parser.add_argument("--only-empty", action="store_true")
    parser.add_argument("--html-only", action="store_true", help="Export and verify one standalone HTML file instead of PDF cases")
    run(parser.parse_args())
