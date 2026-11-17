"""Verify native selection editing, disk contents, history and continued input across block types."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time


VALUE = 'NativeReplacementProof'
CARET = 'CaretProof42!'
PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIklEQVR4nN3KMREAAAgCQM4zieEMZ0lpADs/f8/tQygYGYFIYgJE6M/vewAAAABJRU5ErkJggg=='
TABLE = '| head  | other  |\n| ----- | ------ |\n| first | sample |\n'
CASES = [
    {'name': 'paragraph', 'markdown': 'sample\n', 'expected': VALUE},
    {'name': 'inline-format', 'markdown': '**sample** and `code`\n', 'expected': VALUE},
    {'name': 'inline-math', 'markdown': 'before $x+y$ after\n', 'expected': VALUE},
    {'name': 'link', 'markdown': '[sample](https://example.test/note)\n', 'expected': VALUE},
    {'name': 'inline-image', 'markdown': f'![sample]({PNG})\n', 'expected': VALUE},
    {'name': 'atx', 'markdown': '## sample\n', 'expected': VALUE},
    {'name': 'setext', 'markdown': 'sample\n===\n', 'expected': VALUE + '\n==='},
    {'name': 'quote', 'markdown': '> sample\n', 'expected': '> ' + VALUE},
    {'name': 'bullet', 'markdown': '- sample\n', 'expected': '- ' + VALUE},
    {'name': 'ordered', 'markdown': '1. sample\n', 'expected': '1. ' + VALUE},
    {'name': 'task', 'markdown': '- [ ] sample\n', 'expected': '- [ ] ' + VALUE},
    {'name': 'checked-task', 'markdown': '- [x] sample\n', 'expected': '- [x] ' + VALUE},
    {'name': 'nested-list', 'markdown': '- outer\n  - sample\n', 'expected': VALUE},
    {'name': 'code-document', 'markdown': '```text\nsample\n```\n', 'expected': VALUE},
    {'name': 'code-body', 'markdown': '```text\nsample\n```\n', 'point': (240, 203),
     'select': ['Home', 'shift+End'], 'expected': '```text\n' + VALUE + '\n```'},
    {'name': 'code-body-enter', 'markdown': '```text\nsample\n```\n', 'point': (240, 203),
     'select': ['Home', 'shift+End'], 'key': 'Return', 'expected': '```text\n\n\n```'},
    {'name': 'code-range-enter', 'markdown': '```text\n{sample}\n```\n', 'point': (240, 203),
     'select': ['Home', 'Right'] + ['shift+Right'] * 6, 'key': 'Return', 'expected': '```text\n{\n    \n}\n```'},
    {'name': 'code-language', 'markdown': '```text\nsample\n```\n', 'point': (190, 165),
     'select': ['Home', 'shift+End'], 'expected': '```' + VALUE + '\nsample\n```'},
    {'name': 'indented-code', 'markdown': '    sample\n', 'expected': VALUE},
    {'name': 'indented-code-body', 'markdown': '    sample\n', 'point': (240, 203),
     'select': ['Home', 'shift+End'], 'expected': '    ' + VALUE},
    {'name': 'table-document', 'markdown': TABLE, 'expected': VALUE},
    {'name': 'table-cell', 'markdown': TABLE, 'point': (560, 226), 'select': ['Home', 'shift+End'],
     'expected': '| head | other |\n| --- | --- |\n| first | ' + VALUE + ' |'},
    {'name': 'math', 'markdown': '$$\nx+y\n$$\n', 'expected': '$$\n' + VALUE + '\n$$'},
    {'name': 'html', 'markdown': '<div>sample</div>\n', 'expected': VALUE},
    {'name': 'yaml', 'markdown': '---\ntitle: sample\n---\n', 'expected': '---\n' + VALUE + '\n---'},
    {'name': 'toml', 'markdown': '+++\ntitle = "sample"\n+++\n', 'expected': '+++\n' + VALUE + '\n+++'},
    {'name': 'json', 'markdown': ';;;\n{"title":"sample"}\n;;;\n', 'expected': ';;;\n' + VALUE + '\n;;;'},
    {'name': 'thematic', 'markdown': '***\n', 'expected': VALUE},
    {'name': 'mermaid', 'markdown': '```mermaid\ngraph LR\n A --> B\n```\n',
     'text': 'graph LR; C --> D', 'expected': '```mermaid\ngraph LR; C --> D\n```'},
    {'name': 'table-top-padding', 'markdown': TABLE, 'point': (500, 156), 'select': [],
     'expected': '| ' + VALUE + 'head | other |\n| --- | --- |\n| first | sample |'},
    {'name': 'word-backspace', 'markdown': 'word\n', 'select': ['ctrl+End'], 'key': 'ctrl+BackSpace', 'expected': ''},
    {'name': 'cross-block-escape', 'markdown': '## title\n\nbody\n', 'key': 'Escape', 'expected': '## title\n\nbody'},
    {'name': 'cross-block-home', 'markdown': '## title\n\nbody\n', 'key': 'Home', 'expected': '## title\n\nbody'},
    {'name': 'cross-block-f1', 'markdown': '## title\n\nbody\n', 'key': 'F1', 'expected': '## title\n\nbody'},
]
for name, markdown, point in [
    ('paragraph-image', 'sample\n', None), ('heading-image', '## sample\n', None),
    ('quote-image', '> sample\n', None), ('code-body-image', '```text\nsample\n```\n', (240, 203)),
]:
    CASES.append({'name': name, 'markdown': markdown, 'point': point,
                  'select': ['Home', 'shift+End'] if point else ['ctrl+a'], 'image': True})


def normalize(value):
    """Ignore only the serializer's table padding and separator dash lengths."""
    lines = value.rstrip('\r\n').splitlines()
    for index, line in enumerate(lines):
        if line.startswith('|') and line.endswith('|'):
            cells = [cell.strip() for cell in line[1:-1].split('|')]
            cells = [re.sub('-+', '---', cell) if re.fullmatch(':?-+:?', cell) else cell for cell in cells]
            lines[index] = '|' + '|'.join(cells) + '|'
    return '\n'.join(lines)


def run(args):
    if args.display == os.environ.get('DISPLAY'):
        raise RuntimeError('Use a dedicated display for native input tests')
    artifacts = Path(args.artifacts).resolve()
    artifacts.mkdir(parents=True, exist_ok=True)
    results = []
    with tempfile.TemporaryDirectory(prefix='marknext-content-editing-') as directory:
        root = Path(directory)
        for case in CASES:
            if args.case and case['name'] != args.case:
                continue
            name = case['name']
            profile = root / name
            profile.mkdir()
            source = profile / f'{name}.md'
            source.write_text(case['markdown'])
            env = os.environ.copy()
            env.update(DISPLAY=args.display, GDK_BACKEND='x11', GTK_USE_PORTAL='0', NO_AT_BRIDGE='1',
                       WEBKIT_DISABLE_DMABUF_RENDERER='1', LIBGL_ALWAYS_SOFTWARE='1', LANG='en_US.UTF-8',
                       LC_ALL='en_US.UTF-8', XDG_CONFIG_HOME=str(profile / 'config'),
                       XDG_DATA_HOME=str(profile / 'data'), XDG_CACHE_HOME=str(profile / 'cache'))
            env.pop('WAYLAND_DISPLAY', None)

            def command(*values):
                return subprocess.check_output(values, env=env, text=True, timeout=15).strip()

            def keys(*values):
                command('xdotool', 'key', '--clearmodifiers', *values)
                time.sleep(.1)

            def type_text(value):
                command('xdotool', 'type', '--clearmodifiers', '--delay', '20', value)
                time.sleep(.2)

            def screenshot(suffix):
                command('python3', '-c', "import gi; gi.require_version('Gdk','3.0'); from gi.repository import Gdk; "
                        "w=Gdk.get_default_root_window(); "
                        "Gdk.pixbuf_get_from_window(w,0,0,w.get_width(),w.get_height()).savev(__import__('sys').argv[1],'png',[],[])",
                        str(artifacts / f'{name}-{suffix}.png'))

            def stop(process):
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()

            result = {'case': name}
            clipboard = None
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
                    raise TimeoutError(f'Native editor test timed out in {name}')

                def saved(expected):
                    keys('ctrl+s')
                    wait(lambda: normalize(source.read_text()) == normalize(expected), 5)

                try:
                    wait(lambda: bool(command('xdotool', 'search', '--onlyvisible', '--name', '^MarkNext$')))
                    time.sleep(3)
                    window = command('xdotool', 'search', '--onlyvisible', '--name', '^MarkNext$').splitlines()[0]
                    command('xdotool', 'windowfocus', '--sync', window)
                    point = case.get('point') or (200, 175)
                    command('xdotool', 'mousemove', str(point[0]), str(point[1]), 'click', '1')
                    selection = case.get('select', ['ctrl+a'])
                    if selection:
                        keys(*selection)
                    screenshot('selected')
                    if case.get('image'):
                        clipboard = subprocess.Popen([
                            'python3', '-c', "import gi; gi.require_version('Gtk','3.0'); "
                            "from gi.repository import Gtk,Gdk,GdkPixbuf; "
                            "p=GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB,True,8,8,8); p.fill(0x22aa66ff); "
                            "Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).set_image(p); Gtk.main()",
                        ], env=env, stdout=log, stderr=subprocess.STDOUT)
                        time.sleep(.3)
                        keys('ctrl+v')
                        time.sleep(.4)
                        keys('ctrl+s')
                        wait(lambda: 'data:image/png;base64,' in source.read_text(), 5)
                        after = source.read_text()
                        match = re.search(r'!\[\]\(data:image/png;base64,[A-Za-z0-9+/=]+\)', after)
                        assert match, after
                        expected = case['markdown'].replace('sample', match[0], 1)
                        if name in ['paragraph-image', 'heading-image']:
                            expected = match[0]
                        elif name == 'quote-image':
                            expected = '> ' + match[0]
                        assert normalize(after) == normalize(expected), after
                    else:
                        if case.get('key'):
                            keys(case['key'])
                        else:
                            type_text(case.get('text', VALUE))
                        saved(case['expected'])
                        after = source.read_text()
                    result['saved'] = after
                    screenshot('saved')
                    keys('ctrl+z')
                    saved(case['markdown'])
                    screenshot('undo')
                    keys('ctrl+shift+z')
                    saved(after)
                    type_text(CARET)
                    keys('ctrl+s')
                    wait(lambda: CARET in source.read_text(), 5)
                    continued = source.read_text()
                    if case.get('image'):
                        assert normalize(continued) == normalize(after.replace(match[0], match[0] + CARET, 1)), continued
                    elif not case.get('key'):
                        inserted = case.get('text', VALUE)
                        assert normalize(continued) == normalize(after.replace(inserted, inserted + CARET, 1)), continued
                    result['continued'] = continued
                    result['passed'] = True
                    screenshot('continued')
                except Exception as error:
                    result['passed'] = False
                    result['error'] = str(error)
                    result['actual'] = source.read_text()
                    screenshot('failure')
                finally:
                    if clipboard is not None:
                        stop(clipboard)
                    stop(app)
            results.append(result)
            print(json.dumps(result, ensure_ascii=False), flush=True)
            (artifacts / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    assert results and all(result['passed'] for result in results), 'Native content editing regression failed'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--display', required=True)
    parser.add_argument('--binary', default='src-tauri/target/debug/marknext')
    parser.add_argument('--artifacts', default='test-results/native-content-editing')
    parser.add_argument('--case', choices=[case['name'] for case in CASES])
    run(parser.parse_args())
