"""Exercise real Fcitx Pinyin replacement in an isolated native Tauri session."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time


PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIklEQVR4nN3KMREAAAgCQM4zieEMZ0lpADs/f8/tQygYGYFIYgJE6M/vewAAAABJRU5ErkJggg=='
CASES = [
    ('heading', '## sample\n', None, '你好'),
    ('paragraphs', 'first\n\nsecond\n', None, '你好'),
    ('quote', '> sample\n', None, '> 你好'),
    ('image', f'![sample]({PNG})\n', None, '你好'),
    ('code', '```text\nsample\n```\n', (240, 203), '```text\n你好\n```'),
    ('table', '| sample |\n| ------ |\n| body   |\n', (200, 226), None),
]


def run(args):
    if args.display == os.environ.get('DISPLAY'):
        raise RuntimeError('Use a dedicated display for native input tests')
    artifacts = Path(args.artifacts).resolve()
    artifacts.mkdir(parents=True, exist_ok=True)
    results = []
    with tempfile.TemporaryDirectory(prefix='marknext-ime-') as directory:
        profile = Path(directory)
        config = profile / 'config/fcitx5'
        config.mkdir(parents=True)
        (config / 'profile').write_text(
            '[Groups/0]\nName=Default\nDefault Layout=us\nDefaultIM=pinyin\n'
            '[Groups/0/Items/0]\nName=keyboard-us\nLayout=\n'
            '[Groups/0/Items/1]\nName=pinyin\nLayout=\n[GroupOrder]\n0=Default\n')
        env = os.environ.copy()
        env.update(DISPLAY=args.display, GDK_BACKEND='x11', GTK_USE_PORTAL='0', NO_AT_BRIDGE='1',
                   WEBKIT_DISABLE_DMABUF_RENDERER='1', LIBGL_ALWAYS_SOFTWARE='1', LANG='en_US.UTF-8',
                   LC_ALL='en_US.UTF-8', XDG_CONFIG_HOME=str(profile / 'config'),
                   XDG_DATA_HOME=str(profile / 'data'), XDG_CACHE_HOME=str(profile / 'cache'),
                   GTK_IM_MODULE='fcitx', XMODIFIERS='@im=fcitx', QT_QPA_PLATFORM='xcb')
        env.pop('WAYLAND_DISPLAY', None)

        def command(*values):
            return subprocess.check_output(values, env=env, text=True, timeout=15).strip()

        def keys(*values):
            command('xdotool', 'key', '--clearmodifiers', *values)
            time.sleep(.15)

        def type_text(value):
            command('xdotool', 'type', '--clearmodifiers', '--delay', '100', value)
            time.sleep(.2)

        def screenshot(name):
            command('python3', '-c', "import gi; gi.require_version('Gdk','3.0'); from gi.repository import Gdk; "
                    "w=Gdk.get_default_root_window(); "
                    "Gdk.pixbuf_get_from_window(w,0,0,w.get_width(),w.get_height()).savev(__import__('sys').argv[1],'png',[],[])",
                    str(artifacts / f'{name}.png'))

        def stop(process):
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()

        with (artifacts / 'fcitx.log').open('w') as ime_log:
            ime = subprocess.Popen(['fcitx5', '-D', '--disable=wayland,notificationitem,cloudpinyin,spell'], env=env,
                                   stdout=ime_log, stderr=subprocess.STDOUT)
            try:
                time.sleep(2)
                for name, markdown, point, expected in CASES:
                    if args.case and name != args.case:
                        continue
                    source = profile / f'{name}.md'
                    source.write_text(markdown)
                    result = {'case': name}
                    with (artifacts / f'{name}.log').open('w') as log:
                        app = subprocess.Popen([str(Path(args.binary).resolve()), str(source)], env=env,
                                               stdout=log, stderr=subprocess.STDOUT)
                        try:
                            deadline = time.monotonic() + 15
                            while time.monotonic() < deadline:
                                if app.poll() is not None:
                                    raise RuntimeError(f'Tauri exited with {app.returncode}')
                                try:
                                    window = command('xdotool', 'search', '--onlyvisible', '--name', '^MarkNext$')
                                    if window:
                                        break
                                except subprocess.CalledProcessError:
                                    pass
                                time.sleep(.1)
                            else:
                                raise TimeoutError('Native window did not appear')
                            time.sleep(3)
                            command('xdotool', 'windowfocus', '--sync', window.splitlines()[0])
                            command('fcitx5-remote', '-c')
                            if point:
                                command('xdotool', 'mousemove', str(point[0]), str(point[1]), 'click', '1')
                                keys('Home', 'shift+End')
                            else:
                                command('xdotool', 'mousemove', '200', '175', 'click', '1')
                                keys('ctrl+a')
                            screenshot(f'{name}-selected')
                            command('fcitx5-remote', '-o')
                            time.sleep(.3)
                            assert command('fcitx5-remote', '-n') == 'pinyin'
                            type_text('nihao')
                            screenshot(f'{name}-preedit')
                            keys('space')
                            time.sleep(.3)
                            command('fcitx5-remote', '-c')
                            keys('ctrl+s')
                            time.sleep(.4)
                            actual = source.read_text().strip()
                            result['saved'] = actual
                            screenshot(f'{name}-committed')
                            if expected is None:
                                cells = [line.strip().strip('|').strip() for line in actual.splitlines()
                                         if line.strip().startswith('|') and '-' not in line]
                                assert cells == ['sample', '你好'], actual
                            else:
                                assert actual == expected, actual
                            type_text('NativeCaretProof')
                            keys('ctrl+s')
                            time.sleep(.3)
                            continued = source.read_text().strip()
                            assert 'NativeCaretProof' in continued, continued
                            result['passed'] = True
                        except Exception as error:
                            result['passed'] = False
                            result['error'] = str(error)
                            screenshot(f'{name}-failure')
                        finally:
                            stop(app)
                    results.append(result)
                    print(json.dumps(result, ensure_ascii=False), flush=True)
                    (artifacts / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
            finally:
                stop(ime)
    assert results and all(result['passed'] for result in results), 'Native IME regression failed'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--display', required=True)
    parser.add_argument('--binary', default='src-tauri/target/debug/marknext')
    parser.add_argument('--artifacts', default='test-results/native-ime')
    parser.add_argument('--case', choices=[case[0] for case in CASES])
    run(parser.parse_args())
