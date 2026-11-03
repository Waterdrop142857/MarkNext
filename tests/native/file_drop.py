"""Real GTK -> Tauri file drops on an isolated X11 display; no DOM/IPC mocks.

Requires a running dev frontend, a compiled debug binary, Xvfb, xdotool and
PyGObject GTK 3. Run in a private D-Bus session; see tests/README.md.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time


def gtk_helpers(args):
    import gi
    gi.require_version("Gtk", "3.0")
    gi.require_version("Gdk", "3.0")
    from gi.repository import Gdk, Gtk

    if args.clipboard:
        print(json.dumps(Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).wait_for_text()))
        return
    if args.screenshot:
        window = Gdk.get_default_root_window()
        Gdk.pixbuf_get_from_window(window, 0, 0, window.get_width(), window.get_height()).savev(
            args.screenshot, "png", [], []
        )
        return
    window = Gtk.Window(title="MarkNext native drop source")
    window.set_default_size(240, 150)
    window.move(10, 100)
    window.add(Gtk.Label(label="Native file drag source"))
    window.drag_source_set(
        Gdk.ModifierType.BUTTON1_MASK,
        [Gtk.TargetEntry.new("text/uri-list", 0, 7)],
        Gdk.DragAction.COPY | Gdk.DragAction.MOVE,
    )

    def data(_widget, _context, selection, _info, _time):
        paths = json.loads(Path(args.source).read_text())
        selection.set_uris([Path(path).resolve().as_uri() for path in paths])
        print("URI requested", flush=True)

    def ended(_widget, context):
        print(f"END action={int(context.get_selected_action())}", flush=True)

    window.connect("drag-data-get", data)
    window.connect("drag-end", ended)
    window.connect("drag-data-delete", lambda *_: print("ERROR delete requested", flush=True))
    window.connect("destroy", Gtk.main_quit)
    window.show_all()
    Gtk.main()


def run(args):
    repo = Path(__file__).resolve().parents[2]
    binary = Path(args.binary or repo / "src-tauri/target/debug/marknext").resolve()
    if args.display == os.environ.get("DISPLAY"):
        raise RuntimeError("Choose a separate Xvfb display; never run against the current desktop")
    if not binary.is_file():
        raise RuntimeError(f"Build the Tauri binary first: {binary}")
    artifacts = Path(args.artifacts).resolve()
    artifacts.mkdir(parents=True, exist_ok=True)
    profile = tempfile.TemporaryDirectory(prefix="profile-", dir=artifacts)
    root = Path(profile.name)
    env = os.environ.copy()
    env.update(
        DISPLAY=args.display, GDK_BACKEND="x11", NO_AT_BRIDGE="1",
        WEBKIT_DISABLE_DMABUF_RENDERER="1", LIBGL_ALWAYS_SOFTWARE="1",
        XDG_CONFIG_HOME=str(root / "config"), XDG_DATA_HOME=str(root / "data"),
        XDG_CACHE_HOME=str(root / "cache"),
    )
    env.pop("WAYLAND_DISPLAY", None)
    for name in ["config", "data", "cache", "files"]:
        (root / name).mkdir()
    files = root / "files"
    first = files / "文档 # 100%.MD"
    second = files / "second.txt"
    third = files / "third.Markdown"
    fourth = files / "fourth.md"
    unsupported = files / "page.html"
    directory = files / "directory.md"
    directory.mkdir()
    contents = {
        first: "# Native first\n\nFIRST_DOCUMENT_PROOF\n",
        second: "SECOND_DOCUMENT_PROOF\n",
        third: "# Third\n\nTHIRD_DOCUMENT_PROOF\n",
        fourth: "# Fourth\n\nFOURTH_DOCUMENT_PROOF\n",
        unsupported: "<p>UNSUPPORTED_DOCUMENT</p>",
    }
    for path, content in contents.items():
        path.write_text(content)
    payload = root / "drop-paths.json"
    payload.write_text("[]")
    app_log = artifacts / "app.log"
    source_log = artifacts / "source.log"
    children = []
    handles = []

    def start(command, log):
        handle = log.open("w")
        handles.append(handle)
        process = subprocess.Popen(command, cwd=repo, env=env, stdout=handle, stderr=subprocess.STDOUT)
        children.append(process)
        return process

    def command(*values):
        return subprocess.check_output(values, env=env, text=True, timeout=15).strip()

    def wait(check, label):
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if check():
                return
            if children[0].poll() is not None:
                raise AssertionError("Native application exited; inspect app.log")
            time.sleep(.05)
        raise AssertionError(f"Timed out: {label}; inspect {artifacts}")

    def helper(*values):
        return command(sys.executable, str(Path(__file__).resolve()), *values)

    def screenshot(name):
        helper("--screenshot", str(artifacts / f"{name}.png"))

    def queued():
        return app_log.read_text().count("[file-drop] drop queued")

    def drag(paths, cancel=False):
        payload.write_text(json.dumps([str(path) for path in paths]))
        before = queued()
        command("xdotool", "mousemove", "80", "160", "mousedown", "1")
        try:
            for step in range(1, 31):
                command("xdotool", "mousemove", str(80 + step * 20), str(160 + step * 6))
                time.sleep(.025)
            time.sleep(.3)
            if cancel:
                # Hover may prefetch paths but must never open a document.
                assert queued() == before
                screenshot("hover-before-cancel")
                command("xdotool", "mousemove", "1500", "950")
                time.sleep(.15)
        finally:
            command("xdotool", "mouseup", "1")
        if cancel:
            time.sleep(.3)
            assert queued() == before
        else:
            wait(lambda: queued() > before, "native drop enqueued")

    def focus():
        command("xdotool", "windowfocus", "--sync", window)
        command("xdotool", "mousemove", "800", "300", "click", "1")

    def key(value):
        command("xdotool", "key", "--clearmodifiers", value)

    def select_tab(x):
        command("xdotool", "windowfocus", "--sync", window)
        command("xdotool", "mousemove", str(x), "105", "click", "1")
        time.sleep(.4)

    def read_source(toggle=False):
        focus()
        if toggle:
            key("ctrl+shift+m")
            time.sleep(.5)
        key("ctrl+a")
        key("ctrl+c")
        time.sleep(.1)
        return json.loads(helper("--clipboard"))

    try:
        start([str(binary)], app_log)
        wait(lambda: "GTK receiver ready" in app_log.read_text(), "GTK receiver installed")
        window = ""

        def ready_window():
            nonlocal window
            found = subprocess.run(["xdotool", "search", "--onlyvisible", "--class", "marknext"],
                                   env=env, capture_output=True, text=True, timeout=3)
            if found.returncode == 0 and found.stdout.strip():
                window = found.stdout.splitlines()[-1]
                return True
            return False

        wait(ready_window, "native window visible")
        command("xdotool", "windowmove", window, "320", "0")
        command("xdotool", "windowsize", window, "1100", "900")
        start([sys.executable, str(Path(__file__).resolve()), "--source", str(payload)], source_log)
        time.sleep(.5)
        drag([first], cancel=True)
        print("PASS hover/cancel does not open a document", flush=True)

        drag([first])
        wait(lambda: "END action=2" in source_log.read_text(), "source receives COPY action")
        time.sleep(.6)
        original = read_source(toggle=True)
        assert original.rstrip() == contents[first].rstrip(), repr(original)
        screenshot("single-document")
        print("PASS native URI transport, COPY feedback, Unicode/space/#/% path and real editor content", flush=True)

        key("ctrl+End")
        command("xdotool", "type", "--clearmodifiers", "--delay", "2", "UNSAVED")
        edited = read_source()
        assert edited == original + "UNSAVED", repr(edited)
        drag([second])
        time.sleep(.5)
        assert read_source(toggle=True).rstrip() == contents[second].rstrip()
        select_tab(410)
        actual = read_source()
        assert actual == edited, f"Dirty document changed: {actual!r} != {edited!r}"
        drag([first])
        time.sleep(.4)
        assert read_source() == edited, "Duplicate drop must activate the dirty document"
        key("ctrl+z")
        time.sleep(.3)
        assert read_source() == original, "Original document undo history must survive drops"
        screenshot("history-preserved")
        print("PASS dirty source preservation, duplicate activation and undo", flush=True)

        # Unsupported files must not replace the app or trigger its startup gate.
        before = queued()
        payload.write_text(json.dumps([str(unsupported), str(directory)]))
        command("xdotool", "mousemove", "80", "160", "mousedown", "1")
        for step in range(1, 31):
            command("xdotool", "mousemove", str(80 + step * 20), str(160 + step * 6))
            time.sleep(.025)
        command("xdotool", "mouseup", "1")
        time.sleep(.5)
        assert queued() == before
        assert read_source() == original
        print("PASS unsupported files/directories do not navigate or replace the document", flush=True)

        drag([third, directory, fourth, unsupported])
        time.sleep(.6)
        assert read_source(toggle=True).rstrip() == contents[fourth].rstrip()
        select_tab(705)
        assert read_source(toggle=True).rstrip() == contents[third].rstrip()
        assert directory.is_dir()
        for path, content in contents.items():
            assert path.read_text() == content, f"Source file changed: {path.name}"
        assert "ERROR delete requested" not in source_log.read_text()
        screenshot("multiple-documents")
        print("PASS mixed multiple-file drop and unchanged source files", flush=True)
    except BaseException:
        try:
            screenshot("failure")
        except (OSError, subprocess.SubprocessError):
            pass
        raise
    finally:
        for child in reversed(children):
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
        for handle in handles:
            handle.close()
        profile.cleanup()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--display", help="A separate, already running Xvfb display, e.g. :96")
    parser.add_argument("--binary", help="Compiled debug Tauri binary")
    parser.add_argument("--artifacts", default="test-results/native-drop")
    parser.add_argument("--source", help=argparse.SUPPRESS)
    parser.add_argument("--clipboard", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--screenshot", help=argparse.SUPPRESS)
    options = parser.parse_args()
    if options.source or options.clipboard or options.screenshot:
        gtk_helpers(options)
    else:
        if not options.display:
            parser.error("--display must identify an isolated Xvfb display")
        run(options)
