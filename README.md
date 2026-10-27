# MarkNext

###### **此项目由AI辅助开发**

MarkNext 是一个基于 **Tauri 2 + Vue 3 + TypeScript** 的 WYSIWYG Markdown 编辑器。编辑/渲染核心来自 MarkText 的 Muya / Muyajs，已 vendor 到 `src/muya`，便于深度定制。

> 当前状态：早期原型。当前先聚焦单文件的打开/关闭/保存与 WYSIWYG 渲染，暂不包含多标签页、侧边栏等能力。

## 功能

- WYSIWYG 所见即所得 Markdown 编辑
- 源码模式（CodeMirror 5，Markdown 高亮 + 任务列表）
- 无边框窗口 + 自绘标题栏（Windows Fluent UI 风格）
- 单文件新建 / 打开 / 保存 / 另存为 / 关闭
- 外部修改保护：定期检查和窗口重新获得焦点时检测磁盘变化；保存使用内容版本校验，冲突时保留编辑并提供重新加载、另存为和确认覆盖
- 未保存文档恢复：独立记录草稿，重启后通过“文件 → 恢复未保存文档”查看；原文件已改变时恢复为未保存副本
- `Ctrl+A` 首次即全选整篇文档
- 分类设置浮窗（点击菜单栏“设置”），包含语言、字体、字号、编码和全局缩放；可配置快捷键，支持多个键位、冲突检测、解除绑定和恢复默认，设置会在重启后保留
- 中英文界面（设置 → 外观 → 界面语言），首次启动匹配系统语言，选择会在重启后保留；切换时保留文档、选区与撤销历史
- WebKitGTK / WKWebView 下自定义选区绘制，阴影贴合文字

## 技术栈

- [Tauri 2](https://tauri.app/)
- [Vue 3](https://vuejs.org/) + TypeScript + [Vite](https://vitejs.dev/)
- Muya / Muyajs（vendored，位于 `src/muya`）
- CodeMirror 5
- pnpm workspace

## 开发

### 环境要求

- Node.js ≥ 24
- pnpm 11.28.3（由 packageManager 固定）
- Rust stable
- Tauri 2 系统依赖（Linux 需要 WebKitGTK 等；Windows/macOS 按 Tauri 文档准备）

### 安装

```bash
pnpm install
```

### 运行

```bash
pnpm tauri dev
```

### 构建

```bash
pnpm build
pnpm tauri build
```

### GitHub Release 自动发布

[`Build and publish release`](./.github/workflows/release.yml) 在推送 `v*` 标签时自动构建并发布；也可在 Actions 中手动运行，填写已存在的版本标签。普通提交和 Pull Request 不再自动运行质量检查，可按需在本地执行 `pnpm check`。

发布前将 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 和 `src-tauri/Cargo.lock` 中 MarkNext 自身的版本同步，并提交。例如当前版本为 `0.1.0`：

```bash
git tag -a v0.1.0 -m "MarkNext v0.1.0"
git push origin v0.1.0
```

标签必须与应用版本完全一致。`v0.2.0-beta.1` 等带预发布后缀的标签会创建 Prerelease；稳定版本发布后标记为 Latest。

工作流分别生成 Linux x64 的 `.deb` / `.AppImage`、Windows x64 的 NSIS `.exe` / `.msi`，以及 macOS Apple Silicon / Intel 的 `.dmg`。所有平台成功后才上传完整安装包、生成 `SHA256SUMS.txt` 并公开 Release。构建失败不会发布；上传失败会留下草稿，可用同一标签重跑。已公开的 Release 不会被重跑覆盖。

发布使用内置 `GITHUB_TOKEN` 的 `contents: write` 权限，无需额外 PAT。当前 Windows 安装包未配置代码签名；macOS 使用 ad-hoc 签名，未做 Apple 公证，下载后系统可能要求确认。签名与公证方式可参阅 [Tauri 官方说明](https://v2.tauri.app/distribute/sign/macos/)。

### 快捷键

默认键位：新建 `Ctrl+N`、打开 `Ctrl+O`、保存 `Ctrl+S`、另存为 `Ctrl+Shift+S`、关闭文件 `Ctrl+W`、退出 `Ctrl+Q`。
撤销 `Ctrl+Z`，重做 `Ctrl+Y` 或 `Ctrl+Shift+Z`，查找 `Ctrl+F`，替换 `Ctrl+H`，下一个/上一个匹配 `F3` / `Shift+F3`，切换源码模式 `Ctrl+Shift+M`。
macOS 使用 `Cmd` 替代 `Ctrl`，重做为 `Cmd+Shift+Z`。

点击菜单栏的“设置”或按 `Ctrl+,`（macOS 为 `Cmd+,`）打开统一设置窗口，在左侧选择“快捷键”管理键位。点击“添加”后按组合键，用键位旁的 `×` 解除绑定，点击“应用”保存；“取消”放弃本次修改。占用其他命令的键位时会提示冲突，需要先解除原绑定。
搜索输入框保留系统文字编辑键位。格式快捷键等 Muya 自带键位继续由编辑器处理；如果为应用命令分配了相同键位，应用命令优先。

设置窗口保留 Fluent 浮动样式，以左侧分类导航组织内容。外观包含语言与 75%–200% 缩放；编辑器包含正文字体、12–40 px 字号和代码字体，可填写已安装的自定义字体；文件包含 UTF-8、UTF-8 BOM、UTF-16 LE/BE 默认编码。默认编码用于新文档和无 BOM 文件的读取，已打开文件保存时保留识别到的编码和 BOM。修改统一点击“应用”，取消不影响现有配置；旧语言和快捷键偏好自动继承。

桌面窗口的最小尺寸为 800×600（逻辑像素）。UI 控件采用系统字体和共享的固定高度，切换中英文时保持高度一致；设置页面与 Muya 正文均为滚动条预留独立空间。

完整验证：`pnpm check`。首次运行需准备 Tauri 系统依赖与 Playwright Chromium/WebKit；详见 [自动化测试流程](./tests/README.md)。

正式版隐藏开发者工具入口；该原生命令只在 debug 构建中启用。

### 文件保护与恢复

当前文件每 5 秒及窗口重新获得焦点时检查磁盘状态；元数据不变时不读取全文，仅在疑似变化时计算内容版本。检测到外部修改后，无论当前文档是否有未保存修改，都先询问“保留编辑器内容”还是“重新加载磁盘内容”。保留或关闭对话框不会改写任一方，同一外部版本不重复弹窗；加载时保持编辑模式，并保护询问或读取期间的新编辑。普通保存会校验打开/上次保存时的磁盘版本；“保存我的版本”需要确认，且只批准当时检测到的外部版本，后续再有变化仍会停止保存。磁盘文件被删除或移动时不会通过普通保存自动重建，可另存为或确认保存自己的版本。

未保存内容在停止输入约 750 毫秒后备份，持续输入时最长约 5 秒刷新一次；切出窗口时也会刷新。恢复文件位于 Tauri 应用数据目录的 `recovery-v1` 子目录，与 Markdown 原文件分开存放。恢复保留内容、编码、编辑模式，并尽量还原选区和滚动位置；恢复后的撤销历史从新会话开始。原文件版本已改变、被删除或无法访问时，以未保存副本恢复。正常保存、关闭或明确选择不保存会清理当前记录；尚未查看的其他恢复记录不会因退出而删除。损坏记录保留在磁盘并显示提示，备份失败会提供重试入口。

源码编辑器只渲染当前视窗及相邻行，避免大文件创建全部行的 DOM；首次打开的 WYSIWYG 仍会构建完整文档。

突然终止进程可能丢失尚未到达备份周期的最后几秒输入。独立备份不会自动修改原文件，也不代替手动保存。

## 目录结构

```text
MarkNext/
├── src/                 # 前端源码
│   ├── components/      # MuyaEditor / SourceEditor 等组件
│   └── muya/            # vendored Muya WYSIWYG 核心
├── src-tauri/           # Tauri / Rust 壳
├── ARCHITECTURE.md      # 架构与路线图
├── package.json
└── vite.config.ts
```

## 路线图

按重要性排序，详见 [ARCHITECTURE.md](./ARCHITECTURE.md)：

1. 完整的编辑功能（撤销、重做、查找替换等）
2. i18n 国际化
3. 自定义主题
4. 多标签页
5. 侧边栏（目录 / 文档层级）
6. 通过可选 pandoc 导出其他格式
7. 打印

## License

[MIT](./LICENSE)。本项目包含来自 MarkText / Muya 的代码，按上游 MIT 许可保留相应版权声明。
