# MarkNext

###### **此项目由DeepSeek辅助开发***

MarkNext 是一个基于 **Tauri 2 + Vue 3 + TypeScript** 的 WYSIWYG Markdown 编辑器。编辑/渲染核心来自 MarkText 的 Muya / Muyajs，已 vendor 到 `src/muya`，便于深度定制。

> 当前状态：早期原型。当前先聚焦单文件的打开/关闭/保存与 WYSIWYG 渲染，暂不包含多标签页、侧边栏等能力。

## 功能

- WYSIWYG 所见即所得 Markdown 编辑
- 源码模式（CodeMirror 5，Markdown 高亮 + 任务列表）
- 无边框窗口 + 自绘标题栏（Windows Fluent UI 风格）
- 单文件新建 / 打开 / 保存 / 另存为 / 关闭
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
