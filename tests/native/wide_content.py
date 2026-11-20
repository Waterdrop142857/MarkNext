"""Exercise wide content, selection painting and full-pane input in isolated Tauri."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time


LINE = 'WideText_0123456789' * 40
ROWS = [['Library', 'namespace', 'class', 'method', 'signature', 'argument', 'result', 'visibility'], ['---'] * 8]
ROWS += [[f'`Column{column}_Row{row}_LongIdentifier`' for column in range(8)] for row in range(45)]
MARKDOWN = '# Wide Content Native Proof\n\n```text\n' + LINE + '\nshort\n```\n\n## Large table\n\n'
MARKDOWN += '\n'.join('| ' + ' | '.join(row) + ' |' for row in ROWS) + '\n\nDocumentEndProof\n'


def table_rows(markdown):
    rows = []
    for line in markdown.splitlines():
        if line.strip().startswith('|'):
            cells = [cell.strip() for cell in line.strip().strip('|').split('|')]
            rows.append([re.sub('-+', '---', cell) if re.fullmatch(':?-+:?', cell) else cell for cell in cells])
    return rows


def check_selection_image(path):
    import gi
    gi.require_version('GdkPixbuf', '2.0')
    from gi.repository import GdkPixbuf
    image = GdkPixbuf.Pixbuf.new_from_file(str(path))
    pixels = image.get_pixels()
    stride = image.get_rowstride()
    channels = image.get_n_channels()
    selected_x = []
    for y in range(215, 285):
        for x in range(1024):
            offset = y * stride + x * channels
            red, green, blue = pixels[offset:offset + 3]
            if blue - red > 25 and green - red > 15 and red < 230:
                selected_x.append(x)
    assert selected_x, 'Expected visible code selection pixels'
    assert 20 <= min(selected_x) < 70 and 900 < max(selected_x) < 984, (min(selected_x), max(selected_x))


def run(args):
    if args.display == os.environ.get('DISPLAY'):
        raise RuntimeError('Use a dedicated native test display')
    artifacts = Path(args.artifacts).resolve()
    artifacts.mkdir(parents=True, exist_ok=True)
    results = []
    with tempfile.TemporaryDirectory(prefix='marknext-wide-content-') as directory:
        for name, original in [('wide', MARKDOWN), ('blank-edges', 'first\n\nsecond\n\nthird\n')]:
            profile = Path(directory) / name
            profile.mkdir()
            source = profile / f'{name}.md'
            source.write_text(original)
            env = os.environ.copy()
            env.update(DISPLAY=args.display, GDK_BACKEND='x11', GTK_USE_PORTAL='0', NO_AT_BRIDGE='1',
                       GDK_SCALE='1', GDK_DPI_SCALE='1',
                       WEBKIT_DISABLE_DMABUF_RENDERER='1', LIBGL_ALWAYS_SOFTWARE='1', LANG='en_US.UTF-8',
                       XDG_CONFIG_HOME=str(profile / 'config'), XDG_DATA_HOME=str(profile / 'data'),
                       XDG_CACHE_HOME=str(profile / 'cache'))
            env.pop('WAYLAND_DISPLAY', None)

            def command(*values):
                return subprocess.check_output(values, env=env, text=True, timeout=15).strip()

            def keys(*values):
                command('xdotool', 'key', '--clearmodifiers', *values)
                time.sleep(.15)

            def type_text(value):
                command('xdotool', 'type', '--clearmodifiers', '--delay', '20', value)

            def screenshot(suffix):
                path = artifacts / f'{name}-{suffix}.png'
                command('/usr/bin/python3', '-c', "import gi; gi.require_version('Gdk','3.0'); from gi.repository import Gdk; "
                        "w=Gdk.get_default_root_window(); "
                        "Gdk.pixbuf_get_from_window(w,0,0,w.get_width(),w.get_height()).savev(__import__('sys').argv[1],'png',[],[])", str(path))
                return path

            def clipboard():
                return command('/usr/bin/python3', '-c', "import gi; gi.require_version('Gtk','3.0'); "
                               "from gi.repository import Gtk,Gdk; print(Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).wait_for_text() or '')")

            result = {'case': name}
            command('xdotool', 'getdisplaygeometry')
            with (artifacts / f'{name}.log').open('w') as log:
                app = subprocess.Popen([str(Path(args.binary).resolve()), str(source)], env=env,
                                       stdout=log, stderr=subprocess.STDOUT)

                def wait(predicate, seconds=15):
                    deadline = time.monotonic() + seconds
                    while time.monotonic() < deadline:
                        if app.poll() is not None:
                            raise RuntimeError(f'Tauri exited with {app.returncode}')
                        try:
                            if predicate():
                                return
                        except subprocess.CalledProcessError:
                            pass
                        time.sleep(.1)
                    raise TimeoutError(f'Native {name} check timed out')

                def saved(predicate):
                    keys('ctrl+s')
                    wait(lambda: predicate(source.read_text()), 5)

                try:
                    wait(lambda: bool(command('xdotool', 'search', '--onlyvisible', '--name', '^MarkNext$')))
                    window = command('xdotool', 'search', '--onlyvisible', '--name', '^MarkNext$').splitlines()[0]
                    command('xdotool', 'windowfocus', '--sync', window)
                    time.sleep(4)
                    keys('ctrl+Home', 'ctrl+a', 'ctrl+c')
                    assert ('DocumentEndProof' if name == 'wide' else 'third') in clipboard()
                    keys('ctrl+Home')
                    screenshot('opened')
                    if name == 'wide':
                        command('xdotool', 'mousemove', '200', '245', 'click', '1')
                        keys('Home', 'shift+End', 'ctrl+c')
                        assert LINE in clipboard(), 'Expected the wide code line to be selected'
                        time.sleep(.3)
                        image = screenshot('selected-code')
                        # Check actual WebKitGTK pixels for paint spilling into
                        # the editor's outer margins. Browser tests cover exact geometry.
                        check_selection_image(image)
                        keys('Escape', 'ctrl+Home')
                        command('xdotool', 'mousemove', '500', '450', 'click', '--repeat', '24', '--delay', '40', '7')
                        time.sleep(.3)
                        screenshot('scrolled-table')
                        command('xdotool', 'mousemove', '800', '450', 'click', '1')
                        keys('Home', 'shift+End', 'ctrl+c')
                        copied = clipboard()
                        match = re.search(r'Column7_Row(\d+)_LongIdentifier', copied)
                        assert match, f'Last column was unreachable: {copied!r}'
                        expected = [row.copy() for row in ROWS]
                        expected[int(match[1]) + 2][7] = 'NativeWideCellProof'
                        type_text('NativeWideCellProof')
                        saved(lambda text: table_rows(text) == expected and LINE in text)
                        keys('ctrl+z')
                        saved(lambda text: table_rows(text) == ROWS)
                        keys('ctrl+shift+z')
                        saved(lambda text: table_rows(text) == expected)
                        keys('ctrl+a', 'Delete')
                        saved(lambda text: text.strip() == '')
                        type_text('AfterWideClearProof')
                        saved(lambda text: text.strip() == 'AfterWideClearProof')
                        screenshot('cleared-and-typed')
                    else:
                        for marker, x, y in [('LeftEdgeProof', 10, 207), ('RightEdgeProof', 980, 207),
                                              ('TopEdgeProof', 500, 135), ('BottomEdgeProof', 500, 650)]:
                            command('xdotool', 'mousemove', str(x), str(y), 'click', '1')
                            type_text(marker)
                            saved(lambda text: marker in text)
                        keys('ctrl+a', 'ctrl+c')
                        assert clipboard().strip() == source.read_text().strip()
                        screenshot('typed')
                    result['passed'] = True
                    result['saved'] = source.read_text()
                except Exception as error:
                    result['passed'] = False
                    result['error'] = str(error)
                    result['saved'] = source.read_text()
                    screenshot('failure')
                finally:
                    app.terminate()
                    try:
                        app.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        app.kill()
                        app.wait()
            results.append(result)
            print(json.dumps(result, ensure_ascii=False), flush=True)
            (artifacts / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    assert all(result['passed'] for result in results), 'Wide content native regression failed'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--display', required=True)
    parser.add_argument('--binary', default='src-tauri/target/debug/marknext')
    parser.add_argument('--artifacts', default='test-results/native-wide-content')
    run(parser.parse_args())
