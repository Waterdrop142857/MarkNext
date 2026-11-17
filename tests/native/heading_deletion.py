"""Check heading replacement, caret focus and Ctrl+A in an isolated native Tauri session."""
import argparse
import os
from pathlib import Path
import subprocess
import tempfile
import time


def run(args):
    if args.display == os.environ.get("DISPLAY"):
        raise RuntimeError("Use a dedicated display for native input tests")
    artifacts = Path(args.artifacts).resolve()
    artifacts.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="marknext-heading-deletion-") as directory:
        profile = Path(directory)
        env = os.environ.copy()
        env.update(DISPLAY=args.display, GDK_BACKEND="x11", GTK_USE_PORTAL="0", NO_AT_BRIDGE="1",
                   WEBKIT_DISABLE_DMABUF_RENDERER="1", LIBGL_ALWAYS_SOFTWARE="1", LANG="en_US.UTF-8",
                   LC_ALL="en_US.UTF-8", XDG_CONFIG_HOME=str(profile / "config"),
                   XDG_DATA_HOME=str(profile / "data"), XDG_CACHE_HOME=str(profile / "cache"))
        env.pop("WAYLAND_DISPLAY", None)

        def command(*values):
            return subprocess.check_output(values, env=env, text=True, timeout=15).strip()

        def keys(*values):
            command("xdotool", "key", "--clearmodifiers", *values)

        def type_text(value):
            command("xdotool", "type", "--clearmodifiers", "--delay", "35", value)

        def screenshot(name):
            command("python3", "-c", "import gi; gi.require_version('Gdk','3.0'); from gi.repository import Gdk; "
                    "w=Gdk.get_default_root_window(); "
                    "Gdk.pixbuf_get_from_window(w,0,0,w.get_width(),w.get_height()).savev(__import__('sys').argv[1],'png',[],[])",
                    str(artifacts / f"{name}.png"))

        cases = [("atx", key, False) for key in [
            "Delete", "BackSpace", "shift+BackSpace", "ctrl+BackSpace", "ctrl+Delete",
            "Return", "shift+Return", "ctrl+x", "shift+Delete", "replace", "paste",
        ]]
        cases += [("atx", key, True) for key in ["Delete", "BackSpace"]]
        cases += [("setext", key, False) for key in ["Delete", "BackSpace", "Return", "shift+Return"]]
        cases += [("cross-block", key, False) for key in [
            "Delete", "BackSpace", "Return", "shift+Return", "replace", "paste", "ctrl+x", "shift+Delete",
        ]]
        cases.append(("paragraph", "shift+Return", False))

        for heading, key, paragraphs in cases:
            name = f"{heading}-{key}-{'paragraphs' if paragraphs else 'empty'}"
            if args.case and name != args.case:
                continue
            source = profile / f"{name}.md"
            before = {"atx": "## Example title", "setext": "Example title\n===",
                      "cross-block": "## Example title\n\nbody", "paragraph": "Example title"}[heading]
            source.write_text(before if heading == "setext" else "")
            clipboard = None
            with (artifacts / f"{name}.log").open("w") as log:
                app = subprocess.Popen([str(Path(args.binary).resolve()), str(source)], env=env,
                                       stdout=log, stderr=subprocess.STDOUT)

                def wait(predicate, seconds=15):
                    until = time.monotonic() + seconds
                    while time.monotonic() < until:
                        if app.poll() is not None:
                            raise RuntimeError(f"Tauri exited with {app.returncode}")
                        try:
                            if predicate():
                                return
                        except subprocess.CalledProcessError:
                            pass
                        time.sleep(.1)
                    raise TimeoutError(f"Native heading test timed out in {name}")

                def saved(expected):
                    keys("ctrl+s")
                    try:
                        wait(lambda: source.read_text().strip() == expected, 5)
                    except TimeoutError as error:
                        raise AssertionError(f"Expected {expected!r}, saved {source.read_text()!r}") from error

                try:
                    wait(lambda: bool(command("xdotool", "search", "--onlyvisible", "--name", "^MarkNext$")))
                    time.sleep(3)
                    window = command("xdotool", "search", "--onlyvisible", "--name", "^MarkNext$").splitlines()[0]
                    command("xdotool", "windowfocus", "--sync", window)
                    command("xdotool", "mousemove", "200", "175", "click", "1")
                    if key == "paste":
                        clipboard = subprocess.Popen([
                            "python3", "-c", "import gi; gi.require_version('Gtk','3.0'); "
                            "from gi.repository import Gtk,Gdk; "
                            "Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).set_text('replacement',-1); Gtk.main()",
                        ], env=env, stdout=log, stderr=subprocess.STDOUT)
                        time.sleep(.3)
                    if heading == "cross-block":
                        type_text("## Example title")
                        keys("Return")
                        type_text("body")
                    elif heading in ("atx", "paragraph"):
                        type_text(before)
                    time.sleep(.4)
                    screenshot(f"{name}-heading")
                    keys("ctrl+a")
                    expected = ""
                    if key == "replace":
                        type_text("replacement")
                        expected = "replacement"
                    elif key == "paste":
                        keys("ctrl+v")
                        expected = "replacement"
                    else:
                        keys(key)
                    time.sleep(.3)
                    screenshot(f"{name}-deleted")
                    saved(expected)
                    if key in ("ctrl+x", "shift+Delete"):
                        copied = command("python3", "-c", "import gi; gi.require_version('Gtk','3.0'); "
                                         "from gi.repository import Gtk,Gdk; "
                                         "print(Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).wait_for_text() or '')")
                        assert copied == before, copied
                    keys("ctrl+z")
                    saved(before)
                    keys("ctrl+shift+z")
                    saved(expected)
                    if paragraphs:
                        type_text("sss")
                        keys("Return")
                        type_text("sss")
                        saved("sss\n\nsss")
                    command("xdotool", "mousemove", "160", "156", "click", "1")
                    type_text("CARET_PROOF")
                    expected = "CARET_PROOFsss\n\nsss" if paragraphs else "CARET_PROOF" + expected
                    saved(expected)
                    screenshot(f"{name}-typed")
                    keys("ctrl+a", "ctrl+c")
                    time.sleep(.2)
                    copied = command("python3", "-c", "import gi; gi.require_version('Gtk','3.0'); "
                                     "from gi.repository import Gtk,Gdk; "
                                     "print(Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).wait_for_text() or '')")
                    assert copied.replace("\n", "") == expected.replace("\n", ""), copied
                    type_text("REPLACEMENT")
                    saved("REPLACEMENT")
                    print(f"PASS {name}: model deletion, undo/redo, top-edge typing and Ctrl+A/copy", flush=True)
                except Exception:
                    screenshot(f"{name}-failure")
                    raise
                finally:
                    if clipboard is not None:
                        clipboard.terminate()
                        clipboard.wait(timeout=10)
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
    parser.add_argument("--artifacts", default="test-results/native-heading-deletion")
    parser.add_argument("--case", help="Run one named scenario, such as atx-paste-empty")
    run(parser.parse_args())
