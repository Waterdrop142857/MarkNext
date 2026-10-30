# MarkNext icons

Editable sources:

- `../../public/icons/marknext.svg`: ruled white paper and a dark serif M.
- `../../public/icons/markdown.svg`: folded document with a small application
  logo in its upper-left corner and ruled lines below.

Both are original, self-contained SVG paths/gradients. They contain no fonts,
external images, scripts or remote resources. Project MIT licensing applies.

Run `pnpm icons:generate` (or `node scripts/generate-icons.mjs`) after editing
the SVGs. It uses the already installed Tauri CLI, needs no added dependency,
and exports the desktop PNG/ICO/ICNS files here. Mobile outputs are temporary.
The application uses the normal `icon.*` / size-named exports; document exports
are `markdown.png`, `markdown.ico`, and `markdown.icns`.
The generator also synchronizes the application's SVG into the document SVG's
marked logo section, keeping the embedded logo standalone and up to date.

The SVGs are used by the browser favicon, titlebar and Markdown/untitled tabs.
Tauri's configured application icons supply the window and installer icons.
The Windows NSIS installer optionally registers MarkNext in Open With and copies
`markdown.ico` for its document ProgIDs, separately from the application icon.
See `../windows/README.md` for registration, upgrade and uninstall behavior.
Other installers still use Tauri's file-association defaults, which do not expose
a separate document-icon field. System MIME icon themes are not overridden.
