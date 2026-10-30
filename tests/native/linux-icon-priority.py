import json, shutil, tempfile
from pathlib import Path
import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, Gio
project = Path.cwd()
config = json.loads((project/'src-tauri/tauri.conf.json').read_text())
with tempfile.TemporaryDirectory(prefix='marknext-icon-priority-') as folder:
    root = Path(folder)
    system = root/'system/icons'
    user = root/'user/icons'
    index = Path('/usr/share/icons/hicolor/index.theme').read_text()
    (system/'hicolor').mkdir(parents=True)
    (system/'hicolor/index.theme').write_text(index)
    for destination, source in config['bundle']['linux']['deb']['files'].items():
        output = system/'hicolor'/destination.split('/hicolor/', 1)[1]
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(project/'src-tauri'/source, output)
    def theme_index(name, inherits='hicolor'):
        path = system/name
        path.mkdir(parents=True, exist_ok=True)
        (path/'index.theme').write_text(f'[Icon Theme]\nName={name}\nInherits={inherits}\nDirectories=scalable/mimetypes\n\n[scalable/mimetypes]\nSize=48\nType=Scalable\nMinSize=1\nMaxSize=1024\nContext=MimeTypes\n')
        return path
    current = theme_index('MarkNextTestTheme')
    def lookup():
        theme = Gtk.IconTheme.new()
        theme.set_search_path([str(user), str(system)])
        theme.set_custom_theme('MarkNextTestTheme')
        result = theme.lookup_icon('text-markdown', 48, Gtk.IconLookupFlags.FORCE_SIZE)
        assert result is not None, 'Missing Markdown fallback icon'
        return Path(result.get_filename())
    assert lookup().is_relative_to(system/'hicolor'), lookup()
    # File managers may ask GTK to resolve all GIcon candidates together.
    # A generic document icon in the selected theme can then win as well.
    generic = current/'scalable/mimetypes/x-office-document.svg'
    generic.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(project/'public/icons/marknext.svg', generic)
    theme = Gtk.IconTheme.new()
    theme.set_search_path([str(user), str(system)])
    theme.set_custom_theme('MarkNextTestTheme')
    mime_icon = Gio.content_type_get_icon('text/markdown')
    assert 'x-office-document' in mime_icon.get_names(), mime_icon.get_names()
    assert Path(theme.lookup_by_gicon(mime_icon, 48, Gtk.IconLookupFlags.FORCE_SIZE).get_filename()) == generic
    generic.unlink()
    current_icon = current/'scalable/mimetypes/text-markdown.svg'
    current_icon.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(project/'public/icons/marknext.svg', current_icon)
    assert lookup() == current_icon, lookup()
    current_icon.unlink()
    parent = theme_index('MarkNextParentTheme')
    parent_icon = parent/'scalable/mimetypes/text-markdown.svg'
    parent_icon.parent.mkdir(parents=True)
    shutil.copyfile(project/'public/icons/marknext.svg', parent_icon)
    theme_index('MarkNextTestTheme', 'MarkNextParentTheme')
    assert lookup() == parent_icon, lookup()
    parent_icon.unlink()
    (user/'hicolor/scalable/mimetypes').mkdir(parents=True)
    (user/'hicolor/index.theme').write_text(index)
    user_icon = user/'hicolor/scalable/mimetypes/text-markdown.svg'
    shutil.copyfile(project/'public/icons/marknext.svg', user_icon)
    assert lookup() == user_icon, lookup()
    names = Gio.content_type_get_icon('text/markdown').get_names()
    assert 'text-markdown' in names, names
    print('PASS: theme/inheritance/hicolor priority, generic GIcon candidate priority, user path override and standard Markdown MIME.')
