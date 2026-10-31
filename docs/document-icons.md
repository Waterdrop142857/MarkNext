# 安装后的文档图标

软件图标与文件图标使用不同资源。软件为 `public/icons/marknext.svg`，文件为
`public/icons/markdown.svg`；`pnpm icons:generate` 同步生成 PNG/ICO/ICNS。
修改 SVG 后需要重新生成并构建安装包。开发态不会自动安装桌面图标或注册关联。

## Linux：尊重图标包

DEB、RPM 和 AppImage 均包含标准名称 `text-markdown`、`text-x-markdown` 的
scalable SVG 与 512×512 PNG，安装到 `hicolor` 的 `mimetypes` 目录。
应用菜单项继续使用软件图标。

同一图标名的查找顺序为：当前图标主题 → 继承主题 → `hicolor` 回退。
因此主题已有 Markdown 图标时优先使用主题；缺少时使用 MarkNext 文件图标。
不会覆盖图标包文件，也不使用独有图标名绕过现有主题。相同主题内的用户图标目录
还可以覆盖系统目录的同名图标。

文件管理器若将 MIME 的多个候选图标一起查找，当前主题的通用文档图标也可能先于
`hicolor` 的专用图标。该行为同样保留用户主题的优先级，不保证强制显示 MarkNext 图案。

此配置不改变标准 `text/markdown` MIME 类型、扩展名判断或默认打开程序，也不
替换全局 `text/plain` 图标。Linux 文件图标按 MIME/主题查找，不按默认编辑器
分别注册；用户选择另一编辑器时仍按当前主题和回退规则显示。

DEB/RPM 安装、卸载后会尝试刷新 GTK 图标缓存；系统包管理器也可执行自己的主题
缓存触发器。卸载移除本包的回退图标，主题自身的图标不受影响。

AppImage 将相同资源保存在 AppDir，运行本身不会写入宿主机主题目录。
桌面集成工具需要导出 MIME 图标；如果工具只注册程序图标，可以解包后手动安装：

```sh
./MarkNext_*.AppImage --appimage-extract
xdg-icon-resource install --mode user --context mimetypes --size 512 squashfs-root/usr/share/icons/hicolor/512x512/mimetypes/text-markdown.png text-markdown
xdg-icon-resource install --mode user --context mimetypes --size 512 squashfs-root/usr/share/icons/hicolor/512x512/mimetypes/text-x-markdown.png text-x-markdown
```

撤销这两项用户安装可执行相同参数的 `xdg-icon-resource uninstall`，省略源 PNG
路径、保留最后的图标名。已有的其他用户自定义图标应先备份。

## macOS：文档类型图标

`bundle.macOS.files` 将 `markdown.icns` 放到 `.app/Contents/Resources/`。
`macos/Info.plist` 在 Tauri 自动生成的 plist 之后合并，为 Markdown 和纯文本
文档设置 `CFBundleTypeIconFile`，保持 `Editor` / `Alternate` 排名，不修改软件图标。

Markdown 导入通用 UTI `net.daringfireball.markdown`，提供 `.md`、`.markdown`
和 `text/markdown` 的类型标签；不声明 MarkNext 拥有 Markdown 格式。
Finder 为 MarkNext 关联文档显示独立文件图标。默认打开程序仍由用户在系统设置或
“显示简介 → 打开方式 → 全部更改”中选择。Finder 缩略图预览可能替代文件类型图标。

由于 `CFBundleDocumentTypes` 整个数组会被覆盖，新增或更改文件关联时必须同步
`tauri.conf.json` 和 `macos/Info.plist`；自动测试会检查一致性。

## Windows NSIS

使用独立 ICO 和 ProgID，并提供可选安装项，见 [Windows NSIS 说明](../src-tauri/windows/README.md)。
MSI 仍使用 Tauri 默认文件关联配置，尚未单独适配文档图标。

## 验证

- `pnpm exec vitest run src/config/__tests__/desktopIcons.spec.ts`：检查文件关联、
  UTI、图标格式和三种 Linux 包的资源映射。
- `/usr/bin/python3 tests/native/linux-icon-priority.py`：需要系统 Python 的
  PyGObject/GTK 3；在临时目录用真实 GTK 验证当前主题、继承主题、hicolor 及用户
  目录的优先级，不改系统图标或设置。
- 构建后运行 `node scripts/verify-native-icons.mjs <target/release/bundle>`：
  Linux 校验最终 DEB 归档与 AppDir 的实际图标字节；macOS 用系统 `plutil` 检查
  `.app` 内最终 Info.plist 和 ICNS。现有安装包构建工作流包含此资源校验。
  macOS 显式构建 `app,dmg`，避免 Tauri 在仅请求 DMG 时清理用于验证的 `.app`；
  上传到 Artifacts/Release 的安装包仍只有 DMG。
- Linux 手动切换有/无 Markdown 图标的主题，刷新文件管理器后检查回退；测试
  `.md`、`.markdown` 和 `.txt`，后者应继续使用原主题。
- macOS 安装新的 `.app` 后，在 Finder 选择 MarkNext 打开 Markdown，检查文件
  图标、软件/Dock 图标、双击打开和已有窗口复用；更改默认程序时确认系统选择保留。

Linux 下的 plist/资源测试不代表已运行 macOS Finder；最终显示仍需 macOS 验收。

参考：[图标主题规范](https://specifications.freedesktop.org/icon-theme/)、
[Apple 文档类型图标](https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/CoreFoundationKeys.html)、
[Tauri macOS 资源配置](https://v2.tauri.app/distribute/macos-application-bundle/)。
