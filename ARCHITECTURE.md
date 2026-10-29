# MDEditor —— Tauri 2.0 架构设计

> 版本：v0.1 架构草案  
> 目标：在现有 Demo（Tauri 2 + Vue 3 + Muya + CodeMirror）基础上，规划可扩展的桌面 Markdown 编辑器架构。

> 2026-10-29：文档会话与历史接口见 [文档会话与编辑历史接口设计](docs/editor-session-history.md)，当前多文件、单窗口及文件管理器集成见 [多文件与桌面集成](docs/multi-file.md)。多文档仓库和标签页已接入；后台标签保存纯数据检查点并销毁渲染器。后文早期多标签页和模式切换规划以这两份实现文档为准。

## 当前实现（2026-10-04）

以下记录核心实现，后文 Pinia 等未落地部分仍属于架构规划；多标签页以文首链接为准：

- `useDocumentTabs` 为每个标签创建独立 `useWorkspace`，保存正文、保存基线、路径、磁盘版本及修订号。新建/打开增加标签；关闭、关闭全部和退出复用 `useDocumentActions.confirmReplacement` 的按版本保存保护。后台标签保存纯数据历史检查点，切换时销毁旧渲染器并恢复目标；恢复失败保留两个文档。
- App 通过 EditorSession 统一调度历史与模式切换。普通编辑中每个文档保留一个 Muya 实例；CodeMirror 在第一次进入源码模式时创建，之后隐藏/激活同一实例。同文档且内容未在 WYSIWYG 改变时保留源码撤销步骤，外部内容变化清空旧 CodeMirror 历史，generation 变化创建新编辑器。源码会话仍作为一个 Muya 撤销边界提交。
- 搜索命令按当前查询和编辑器执行。空查询清理匹配，替换前核对当前文本；源码单次替换必须对应实际查询匹配，两种模式使用不区分大小写的字面查找并支持回绕。
- `documentImages` 显式提供当前文件目录与 Tauri URL 转换，Muya 通过 options 接入，不依赖宿主全局 DIRNAME。原生 assetProtocol 初始 scope 为空，`allow_image_file` 只授权具体图片文件，加载前等待授权；另存为刷新资源上下文。
- 异步图表在各版本独立的隐藏容器内渲染，当前版本才提交；取消/销毁清理 observer、订阅和 Vega view，相同请求复用结果。
- `src/i18n` 提供类型约束的中英文词典、统一响应式 locale 和参数插值。首次启动读取系统语言，语言、编辑器字体/字号、代码字体、编码、缩放和快捷键通过 usePreferences 一次写入 marknext-settings-v1，兼容读取旧语言与快捷键偏好；菜单、对话框与两个编辑器共用 locale。Muya 更新编辑器拥有的提示属性与浮动工具文案，不重建文档块、撤销栈、公式和图表。
- SettingsDialog 统一维护四类配置草稿；提交校验与持久化成功后应用。字体通过 Muya setOptions 的非重渲染路径更新，源码编辑器只重新测量布局。默认编码由原生 UTF-8/UTF-16 严格编解码处理，BOM 优先识别；每个文档保存自己的编码/BOM，写入队列捕获独立快照。
- `src/styles/ui-controls.css` 为标记 `ui-controls` 的应用 UI 容器和单个 `ui-control` 提供系统 UI 字体、固定 20px 行高及居中布局。普通控件高 36px，菜单/搜索高 32px，快捷键标签高 28px；组件通过 CSS 变量覆盖特殊尺寸，不再继承正文行高或依赖原生下拉框的内在尺寸。按钮宽度按内容计算；该规则不作用于编辑器正文。
- 设置中的 `ui-scroll-region` 同时保留稳定滚动条槽与右侧 20px 空间，兼容不占布局宽度的覆盖式滚动条，避免滚动时遮挡按钮。
- 快捷键设置由整个分类面板承接滚动，避免说明/搜索/录制区域挤掉列表。Muya 的滚动宿主保留原实例与选区监听，正文表面缩进右侧留白，滚动条位于正文背景外侧；原生窗口最小尺寸为 800×600 逻辑像素。
- 根文档和应用外壳限制在窗口内，标题栏/状态栏不收缩，编辑器承接滚动。统一自动验收为 `pnpm check`，细节见 [测试指南](tests/README.md)。
- 文件读取返回原始字节的 SHA-256 版本。后台先比较路径、大小、时间戳等元数据（Unix 额外含 inode/ctime）；不变时不读取全文，变化状态只计算一次内容版本，写入始终使用完整 SHA-256 校验。外部内容变化一律先询问保留编辑器内容或加载磁盘内容，同一文档的连续相同外部版本不重复询问，保留不会改变保存基线。后台检查与写入返回版本共用同一基线；普通保存和确认覆盖都使用指定版本，并在临时文件同步后、重命名前再次校验。Rust 的应用内互斥锁串行化文档 I/O，耗时 I/O 在工作线程执行。外部程序不受此锁约束，最后校验与文件替换之间仍有极短的竞争窗口。
- `useRecovery` 按独立文档 ID 捕获不可变草稿，串行执行备份与清理，使用 750ms 防抖及 5s 最长等待。原生 `recovery` 模块在应用数据目录原子写入 JSON，并保留损坏记录；Unix 下恢复目录和文件分别限制为 0700/0600。每个标签有独立控制器，恢复增加标签，磁盘基线不匹配或路径已打开时创建未保存副本；新会话先成功备份，再移除原恢复记录。干净的已打开文件不自动恢复，当前范围为未保存草稿恢复。
- 官方 single-instance 插件转发再次启动时的路径和工作目录，Rust 持有待打开请求，前端先监听再拉取、逐项确认；原生菜单退出经过统一关闭保护。文件关联及 Linux `.desktop` 模板随安装包提供，应用只有一个 `main` 主窗口。

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
| `dialog` | 打开/保存文件对话框及未保存确认 | 已接入 |
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
每 5 秒 / 窗口重新获得焦点
   │
   ▼
检查磁盘元数据，疑似变化时核对内容版本
   │
   ▼
内容版本已变化 → 询问保留编辑器内容或加载磁盘内容
  - 保留 / 关闭询问 → 两方内容均不变，不重复询问同一版本
  - 加载 → 替换已批准的编辑器内容，期间新编辑须再次确认
  - 普通保存 → 仍校验磁盘版本，覆盖须单独确认
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
