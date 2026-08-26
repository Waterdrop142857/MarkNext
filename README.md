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
- WebKitGTK / WKWebView 下自定义选区绘制，阴影贴合文字

## 技术栈

- [Tauri 2](https://tauri.app/)
- [Vue 3](https://vuejs.org/) + TypeScript + [Vite](https://vitejs.dev/)
- Muya / Muyajs（vendored，位于 `src/muya`）
- CodeMirror 5
- pnpm workspace

## 开发

### 环境要求

- Node.js ≥ 20
- pnpm
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