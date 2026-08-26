# MDEditor —— Tauri 2.0 架构设计

> 版本：v0.1 架构草案  
> 目标：在现有 Demo（Tauri 2 + Vue 3 + Muya + CodeMirror）基础上，规划可扩展的桌面 Markdown 编辑器架构。

---

## 1. 总体分层

```
┌────────────────────────────────────────────────────────────────┐
│                     Frontend（Vue 3 + TypeScript）             │
│                                                                │
│  ┌──────────────┐   ┌──────────────────────────────────────┐   │
│  │  App Shell   │   │           Editor Area                │   │
│  │  - TitleBar  │   │  ┌──────────────┐ ┌───────────────┐  │   │
│  │  - Menu      │   │  │ WYSIWYG     │ │ Source 模式    │  │   │
│  │  - Sidebar   │   │  │ Muya         │ │ CodeMirror     │  │   │
│  │  - TabBar    │   │  └──────────────┘ └───────────────┘  │   │
│  │  - StatusBar │   │           模式切换 / 状态同步          │   │
│  └──────────────┘   └──────────────────────────────────────┘   │
│                                                                │
│  Pinia：editor / tabs / preferences / fileSystem               │
│  Composables：useEditor / useFile / useShortcuts               │
│  Services：@tauri-apps/api IPC 封装                             │
└───────────────────────────────┬────────────────────────────────┘
                                │  invoke() / Tauri Event
┌───────────────────────────────▼────────────────────────────────┐
│                   Rust Core（Tauri 2）                          │
│                                                                │
│  commands/       file.rs / search.rs / export.rs / config.rs    │
│  services/       file_service.rs / watcher.rs / search.rs       │
│  AppState        窗口状态 / 最近文件 / 设置缓存                  │
│  plugins         opener / dialog / store / updater / log / ...   │
└────────────────────────────────────────────────────────────────┘
```

---

## 2. 前端架构

### 2.1 目录结构（规划）

```
src/
├── main.ts
├── App.vue
├── styles.css
│
├── components/
│   ├── layout/
│   │   ├── AppHeader.vue
│   │   ├── Sidebar.vue
│   │   ├── TabBar.vue
│   │   └── StatusBar.vue
│   ├── editor/
│   │   ├── EditorView.vue          # 模式切换 + 状态同步
│   │   ├── MuyaEditor.vue          # WYSIWYG 封装
│   │   └── SourceEditor.vue        # CodeMirror 源码模式
│   ├── fileTree/
│   │   └── FileTree.vue
│   ├── search/
│   │   └── SearchPanel.vue
│   └── settings/
│       └── SettingsPanel.vue
│
├── stores/
│   ├── editor.ts                   # 当前文档内容 / 模式 / 脏标记
│   ├── tabs.ts                     # 多标签页模型
│   ├── preferences.ts              # 用户偏好
│   └── fileSystem.ts               # 文件树 / 最近文件
│
├── composables/
│   ├── useEditor.ts                # 编辑器实例生命周期
│   ├── useFile.ts                  # 打开/保存/自动保存
│   └── useShortcuts.ts             # 快捷键注册
│
├── services/
│   ├── fileService.ts              # invoke('open_file') 等
│   ├── dialogService.ts            # 文件对话框
│   ├── searchService.ts            # 全局搜索
│   └── configService.ts            # 设置读写
│
├── types/
│   ├── editor.ts
│   ├── file.ts
│   └── ipc.ts                      # 与 Rust 的接口契约
│
└── editor-core/
    ├── muya/                       # 提取的 WYSIWYG 核心（vendored）
    └── markdown/                   # 转换/工具函数
```

### 2.2 状态模型

#### 文档状态（Pinia editor store）

```ts
interface EditorState {
  markdown: string          // 当前文档的 Markdown 源码（统一数据源）
  savedMarkdown: string     // 上次保存的内容，用于脏标记
  mode: 'wysiwyg' | 'source'
  editorReady: boolean
}
```

- **统一数据源是 Markdown 字符串**。
- Muya 内部的 `JSONState / BlockTree` 是 WYSIWYG 的内部实现，不直接作为跨模式数据源。
- 源码模式直接编辑同一个 `markdown`。
- 模式切换时：
  - WYSIWYG → Source：取 `muya.getMarkdown()` 写入 store；
  - Source → WYSIWYG：用 store 的 markdown 重新初始化 Muya。

#### 多标签页模型

```ts
interface EditorTab {
  id: string
  path: string | null       // 未保存文件为 null
  title: string
  markdown: string
  savedMarkdown: string
  mode: 'wysiwyg' | 'source'
}
```

### 2.3 编辑器集成

| 模式 | 组件 | 核心库 | 职责 |
|---|---|---|---|
| WYSIWYG | `MuyaEditor.vue` | Muya（`@muyajs/core` 逻辑） | 所见即所得编辑、块树、行内渲染 |
| Source | `SourceEditor.vue` | CodeMirror 5 | Markdown 源码编辑 + 语法高亮 |
| 后续可加 Preview | `PreviewView.vue` | `MarkdownToHtml` | 只读 HTML 预览 |

Muya 的集成注意点：

- Muya 会 `replaceWith` 替换传入节点，因此 Vue 组件必须用**命令式占位节点**挂载，避免 Vue 管理被替换的 DOM。
- 编辑器快捷键（如 Ctrl+A、双击链接）通过 `editor.domNode` 上的 DOM 事件接管。

---

## 3. Rust 后端架构

### 3.1 目录结构（规划）

```
src-tauri/
├── Cargo.toml
├── tauri.conf.json
├── capabilities/
│   └── default.json
└── src/
    ├── main.rs
    ├── lib.rs
    ├── state.rs               # AppState / 全局状态
    ├── commands/
    │   ├── mod.rs
    │   ├── file.rs            # open_file / save_file / read_dir
    │   ├── search.rs          # search_in_files / replace_in_files
    │   ├── export.rs          # export_html / export_pdf
    │   ├── config.rs          # get_config / set_config
    │   └── window.rs          # window state / recent files
    └── services/
        ├── mod.rs
        ├── file_service.rs    # 原子写入 / 临时文件
        ├── watcher.rs         # notify 文件监听
        └── search_service.rs  # ripgrep 集成
```

### 3.2 核心 IPC 契约（草案）

```ts
// file.ts
openFile(): Promise<{ path: string; content: string } | null>
saveFile(path: string, content: string): Promise<void>
readDir(path: string): Promise<FileEntry[]>
watchPath(path: string): Promise<void>

// search.ts
searchInFiles(query: string, root: string): Promise<SearchResult[]>

// config.ts
getConfig(): Promise<AppConfig>
setConfig(patch: Partial<AppConfig>): Promise<AppConfig>

// export.ts
exportHtml(markdown: string): Promise<string>
exportPdf(markdown: string, outPath: string): Promise<void>
```

### 3.3 Tauri 插件规划

| 插件 | 用途 | 状态 |
|---|---|---|
| `opener` | 打开外部链接 / 文件 | 已接入 |
| `dialog` | 打开/保存文件对话框 | 待接入 |
| `store` | 设置持久化 | 待接入 |
| `log` | 日志 | 待接入 |
| `global-shortcut` | 全局快捷键 | 待接入 |
| `updater` | 自动更新 | 后期 |
| `clipboard-manager` | 剪贴板增强 | 可选 |

---

## 4. 核心数据流

### 4.1 编辑流

```
用户输入
   │
   ▼
Muya inputHandler
   │
   ▼
JSONState（OT json）
   │
   ▼
Muya 内部块树 / DOM 渲染
   │
   ▼
muya.getMarkdown()
   │
   ▼
Pinia editor.markdown（统一数据源）
```

源码模式：

```
CodeMirror change
   │
   ▼
Pinia editor.markdown
```

### 4.2 文件打开流

```
用户点击打开
   │
   ▼
dialogService.open()
   │
   ▼
Rust command: open_file
   │
   ▼
返回 { path, content }
   │
   ▼
Pinia tabs.add({ path, markdown: content })
   │
   ▼
EditorView 根据 mode 初始化 Muya / CodeMirror
```

### 4.3 文件保存流

```
用户保存 / 自动保存
   │
   ▼
从 Pinia 取当前 markdown
   │
   ▼
Rust command: save_file(path, content)
   │
   ▼
更新 savedMarkdown / 清除脏标记
```

### 4.4 文件监听流

```
Rust notify 监听到文件变化
   │
   ▼
Tauri Event: file-changed
   │
   ▼
前端收到后：
  - 若当前 tab 未修改 → 自动更新内容
  - 若已修改 → 提示用户“外部修改”/“覆盖”
```

---

## 5. 安全与权限

- Renderer 运行在 Tauri WebView 中，**不直接访问 Node.js / 文件系统**。
- 所有文件操作通过 Rust command 暴露。
- `capabilities/default.json` 按需声明权限：

```json
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "dialog:default",
    "store:default"
  ]
}
```

---

## 6. 开发路线图（按重要性排序）

> 以下按用户价值与基础依赖排序：越靠前越优先进入开发。

### 1. 完整的编辑功能

编辑器体验是一切的基础。

- [ ] 撤销 / 重做（统一 Muya 与 CodeMirror 的历史栈）
- [ ] 剪切 / 复制 / 粘贴增强
- [ ] 查找 / 替换
- [ ] 自动配对、缩进、列表续写等细节

### 2. i18n 国际化

- [ ] 语言包框架（至少 zh-CN / en）
- [ ] 菜单、右键菜单、设置、状态栏等文案全部接入
- [ ] 跟随系统语言 / 手动切换

### 3. 自定义主题

- [ ] 主题变量化（颜色、字体、排版）
- [ ] 用户可编辑 / 导入自定义主题
- [ ] 亮色 / 暗色 / 跟随系统 / 自定义主题

### 4. 多标签页

- [ ] TabBar 与标签页模型
- [ ] 多文档状态隔离（内容、脏标记、模式）
- [ ] 未保存关闭确认、标签拖拽排序

### 5. 侧边栏

- [ ] 当前文档目录（TOC）
- [ ] 当前文档层级 / 标题导航
- [ ] 后续可扩展文件树

### 6. 通过 pandoc 导出

- [ ] 可选安装 pandoc 的检测
- [ ] 导出 docx / epub / html / pdf 等格式
- [ ] 未安装时的提示与引导

### 7. 打印

- [ ] 打印预览
- [ ] 打印样式（纸张 / PDF）

---

## 7. 关键设计决策

1. **Markdown 字符串作为跨模式统一数据源**，避免 Muya JSONState 与 CodeMirror 状态分叉。
2. **Muya 作为 vendored 核心保留在 `editor-core/muya`**，不直接改上游，便于后续同步。
3. **Rust 只做“系统能力”**，不参与 Markdown 编辑逻辑。
4. **文件系统全部走 Tauri commands**，渲染进程保持沙箱化。
5. **编辑器与 App Shell 解耦**：`EditorView` 只负责编辑，`App.vue` 只负责布局。

---

## 8. 下一步

按此架构先开发 **Phase 2 文件系统基础**：

1. 接入 `tauri-plugin-dialog`
2. 实现 Rust `open_file` / `save_file` command
3. 前端封装 `fileService.ts`
4. Pinia 增加 `tabs` / `editor` store
5. 实现“打开 / 保存 / 自动保存”最小闭环