# MarkNext 降耦合重构执行方案

状态：A–G 的代码重构和相关自动化验证已完成。此文后面的原始步骤和基线问题保留作实施记录；当前模块及验收结果以本节和源码为准。

- A：文档格式、恢复数据和消费接口已独立。
- B：App 通过中立会话接口操作编辑器，Muya/源码交互分别由适配器实现；旧实例暴露已移除。
- C：文档状态和控制器已分离，文件、对话框和恢复存储通过平台接口注入；59 项旧动作测试迁入 Vitest。
- D：恢复目录、每文档备份和工作区协调器已分开；对外是只读标签摘要、活动文档视图和带代号的更新入口。窗口退出由工作区负责。
- E：菜单、快捷键、右键和原生关闭共用命令注册入口；磁盘监听及清理独立管理。
- F：Rust 应用启动、编码、路径、I/O、图片授权和命令包装已拆开；单例锁与协议保持。
- G：旧历史栈、重复会话类型和 VM 测试加载器已移除；扩展名与平台图标配置增加一致性测试。

已按改动范围运行相关 Vitest、类型检查、Rust 编译/单元测试和 Chromium 交互回归。按用户要求跳过 WebKit 测试；没有在本轮执行真实 Tauri 窗口、Windows 或 macOS 的人工验收，也没有进行跨机器性能对比。浏览器文件 I/O 由 mock 提供，不能替代原生平台验证。

同机 Chromium 大文件夹具分别在基线和重构后各运行三次：约 113 万字符、5000 行的文档加载并切换至源码模式，基线耗时 4917–4929 ms，重构后耗时 4793–4915 ms，源码视口均渲染 20 行。该结果未显示明显退化，但样本量小且使用模拟文件 I/O，不能代表真实磁盘或原生 WebKitGTK 性能。

基线：`9a1b1b7`，2026-10-30。原始设计基于该版本的静态检查。
## 1. 目标、范围和优先级

目标是让文档状态、编辑器实例、平台能力与 UI 有明确边界，使后续新增文档能力时不必同时改动 App、Muya、标签管理和文件 I/O。

| 优先级 | 工作包 | 收益 | 难度 / 主要风险 |
| --- | --- | --- | --- |
| P1 | A：领域类型和消费方接口 | 消除配置层、实现返回类型对业务层的牵引 | 低至中；类型迁移影响测试加载器 |
| P1 | B：统一编辑器能力边界 | App 不再访问 Muya、CodeMirror 和编辑器 DOM | 中；焦点、搜索、IME、异步粘贴 |
| P1 | C：文档状态与平台 I/O 分离 | 文档操作能独立测试，保存保护有唯一实现 | 中至高；快照保存、版本冲突、晚到结果 |
| P1 | D：标签、恢复、退出职责分离 | 收紧数据所有权，避免关闭与恢复互相干扰 | 高；切换回滚、关闭确认、恢复清理 |
| P2 | E：命令入口与 App 组合层 | 菜单、快捷键、右键动作一致 | 中；目标标签、输入框焦点和默认行为 |
| P2 | F：Rust 模块拆分 | 命令薄化，文件和恢复模块复用底层 I/O | 中；Tauri 命令注册、锁和错误协议 |
| P3 | G：清理旧抽象与打包元数据核对 | 移除重复概念，减少配置漂移 | 低至中；测试迁移及平台差异 |

建议先完成 A、B；再依次推进 C、D、E。F 可在独立提交中进行，G 最后收尾。本文明确全部阶段，但不要求一次提交完成。

此次不加入新状态框架、依赖注入容器、全局事件总线；不改编辑器引擎、不重写解析器、不增加新的多文件产品行为。性能优化先约束不能回退，不把全文虚拟化、后台渲染缓存、历史持久化等混进结构调整。

## 2. 重构前基线证据与问题定位

| 当前入口 | 已核实的耦合 | 迁移去向 |
| --- | --- | --- |
| `src/App.vue` | 直接遍历 Muya 块、设置光标、读滚动容器，访问 searchModule、clipboard，分支调用 SourceEditor | 编辑器能力接口及其引擎实现 |
| `src/App.vue` 的 ready 与替换按钮 | ready 传递 Muya 实例；替换按钮以 `!muyaEditor` 禁用 | 中立的会话状态和能力判断 |
| `src/components/EditorSession.vue` | 已管理捕获/挂起/恢复，却通过 getMuya/getSource 向上暴露实例 | 保留生命周期，逐项增加中立能力并移除逃生接口 |
| `src/composables/useWorkspace.ts` | 同时维护 Vue 状态、invoke、选择器、i18n、错误弹窗、写入队列 | 文档状态、文档用例和平台适配器 |
| `src/composables/useDocumentTabs.ts` | 标签集合、渲染器切换、批量关闭、恢复目录、原生打开等待共处 | 工作区协调器 + 恢复目录 + 明确的命令入口 |
| 每个标签的 useDocumentActions 初始化 | 必须提供一个只会抛错的 closeWindow 回调 | 每文档命令删除 exit，窗口退出由工作区负责 |
| useDocumentActions/useRecovery/DocumentTab 类型 | 使用 `ReturnType<typeof useWorkspace>` | 消费方显式小接口 |
| `src/editor/sessionTypes.ts` | DocumentSession 只声明，实际可变状态在 workspace/tab；历史类型引用 Muya | 区分实时状态和纯检查点；保留必要的引擎类型 |
| `src/config/preferences.ts` | 定义 FileEncoding/FileFormat/defaultFileFormat | 中立 document 模块，设置层依赖它 |
| `src-tauri/src/lib.rs` | 编码、路径、版本、原子写入、图片授权、命令和启动混合 | document、commands、app 模块 |
| `src-tauri/src/recovery.rs` | 从 crate 根引用编码和 atomic_write | 依赖明确的 document 子模块 |
| `tests/document-actions.test.cjs` | 自写 TS 转译/VM 加载器，按导入字符串注入 mock | 随业务接口迁移到现有 Vitest，保留场景覆盖 |

基线中的替换按钮依赖 Muya 实例。现已改用活动模式的可用状态，源码检查点独立恢复后替换的 Chromium 测试通过。

当前 `sessionTypes.ts` 的 Muya 依赖主要是 type-only，不能据此认定它破坏了懒加载。`checkpointCodec.ts` 的运行期校验需要引擎结构；只有真实出现加载或维护收益时才进一步拆 codec，不用 `unknown` 替换已有强类型。

## 3. 必须保留的行为约束

这些是每阶段的验收条件，不是新增功能：

1. **多文件语义**：新建/打开增加标签，当前脏文档继续保留；不恢复成旧版单文档替换时的保存询问流程。关闭/重新加载/退出仍需要对应确认。
2. **单一状态所有权**：每文档只维护一份正文、保存基线、编码和磁盘版本。渲染器通过受控更新同步正文，不能再复制一套可变 DocumentSession。
3. **身份分离**：documentId 表示逻辑文档；content revision 随正文改变递增，撤销也算改变；document generation 标识内容整体替换；renderer lease 区分实例激活。路径不能代替文档 ID。
4. **按快照保存**：保存成功只更新所保存正文的基线，保存期间的新编辑继续为脏。旧 generation 的成功/失败不能改写新状态。
5. **按内容版本批准**：不保存/加载磁盘的回答只批准当时内容；对话框或读盘期间的新编辑须重新确认。
6. **磁盘冲突保护**：普通保存不能绕过 expectedVersion；外部删除不直接重建；覆盖确认后磁盘再次变化仍须拒绝覆盖。
7. **切换事务**：先等待 IME/异步编辑并提交有效检查点，再销毁旧实例；目标恢复失败要回到原文档，保留两份内容/检查点。
8. **历史与实例分离**：后台文档不保留编辑器 DOM、CodeMirror.Doc、Muya 块实例或监听器；活动标签保持现有跨模式桥接策略，不强求活动标签同时只存在一个引擎对象。
9. **恢复语义**：运行期检查点保留撤销历史；磁盘恢复记录继续只保证正文/编码/模式/视图，不把本次拆分变成撤销历史跨进程持久化。
10. **关闭一致性**：全部关闭/退出中，前面选择不保存、后面取消，所有尚未关闭的脏文档与备份应保留；显式完成的保存不会回滚磁盘。
11. **原生请求交付**：系统打开请求在 UI 忙时等待，不能被按钮防重入逻辑丢弃。当前逐请求处理/确认和失败提示语义保持。
12. **启动与刷新**：保留 main → App → EditorSession 的动态加载边界，编辑器 CSS 随编辑器加载；欢迎页不请求编辑器。主题、语言、字体和缩放不重建实例、不清历史。
13. **性能边界**：磁盘元数据没变不反复读取全文；不新增每次按键深拷贝历史/全量会话的 watcher；切换不等待恢复备份写盘。
14. **兼容协议**：Tauri 命令名、参数、返回字段、编码字面值、恢复 JSON v1、设置键和快捷键 ID 均保持兼容。

## 4. 目标模块与依赖方向

当前布局如下；原始计划中的分散平台文件合并为一个 Tauri 适配器，具体接口以源码为准。

```text
src/
  App.vue                         # 布局、组合、UI 展示状态
  document/
    types.ts / errors.ts / identity.ts # 文档格式、错误和身份
    ports.ts / consumers.ts       # 平台能力及消费方接口
    useDocumentState.ts           # 单文档 Vue 状态
    createDocumentController.ts   # 保存/重载/外部版本与队列
    useDocumentActions.ts         # 保存确认与文档动作
  workspace/
    useDocumentWorkspace.ts       # 标签注册、激活事务、关闭协调
    useRecoveryCatalog.ts         # 旧草稿目录、删除和 retired 过滤
    useDocumentRecovery.ts        # 每文档备份调度与写/删队列
  editor/
    editorPort.ts                 # UI 使用的编辑器能力，类型定义
    sessionTypes.ts                # 保留纯数据历史契约
    muyaCommands.ts                # Muya 特有操作
    sourceCommands.ts              # CodeMirror/SourceEditor 特有操作
    *HistoryAdapter.ts            # 现有历史适配器
  application/
    commands.ts                   # 命令 ID、运行和可用性判定
    useDocumentMonitoring.ts      # 焦点、可见性、磁盘轮询和清理
  platform/tauri/
    documentPorts.ts              # 文件、对话框和恢复 IPC 适配
  components/
    EditorSession.vue             # 组装能力与既有生命周期
    MuyaEditor.vue / SourceEditor.vue
```

依赖方向：UI/工作区 → 显式契约与文档控制器；文档控制器 → 状态和注入的 ports；Tauri 适配器实现 ports；EditorSession → 引擎操作与历史适配器。平台适配器由应用组合层注入，不由文档控制器静态引入。

允许文档状态模块使用 Vue ref/computed；不为追求“纯领域层”再引入一套状态同步机制。公共模块避免通过大 index.ts 一次导出所有运行期模块，尤其不能把 Muya 带进欢迎页。

### 4.1 数据所有权

| 数据/资源 | 唯一所有者 | 对外开放方式 | 释放时机 |
| --- | --- | --- | --- |
| 正文、保存基线、路径、编码、磁盘状态 | 文档状态/控制器 | 只读 refs；正文更新等明确写入口 | 标签关闭且协调流程成功 |
| 标签次序、活动 ID、未命名序号 | 工作区协调器 | readonly 标签摘要 + 命令 | 工作区销毁 |
| 当前引擎、DOM、IME 状态、lease | EditorSession | EditorPort | 挂起/组件销毁 |
| 后台历史检查点 | 工作区内部文档记录 | 传入 EditorSession 的只读数据 | 成功恢复后解除挂起记录，或关闭 |
| 当前引擎 undo/redo 栈 | 引擎及 HistoryAdapter | 历史能力接口 | 捕获完成后销毁 |
| 单文档恢复写队列、计时器、签名 | DocumentRecovery | start/flush/prepareExit/resume/stop | 标签关闭/窗口退出 |
| 未打开的恢复记录、目录错误 | RecoveryCatalog | 只读目录与删除/重试 | 工作区销毁 |
| 文件写队列、saveAsPending、磁盘缓存 | DocumentController | 保存/检查等用例 | 文档生命周期结束，晚到结果失效 |
| 搜索框文本、设置弹窗、菜单展开 | UI | props/events 或局部 ref | UI 卸载 |

未采用的 `DocumentSession` 类型已移除，实际所有权以上表为准；没有复制一套可变状态。纯检查点继续是不可变数据。若以后需要工作区导出，再为该用途设计版本化 DTO。

### 4.2 文档和平台接口

接口按消费方需要拆分；以下为主要接口，完整定义见 `src/document/ports.ts`：

```ts
interface DocumentFiles {
  canonicalPath(path: string): Promise<string>;
  read(path: string, fallback: FileEncoding): Promise<ReadDocument>;
  stamp(path: string): Promise<string>;
  version(path: string): Promise<string>;
  write(path: string, content: string, format: FileFormat, expectedVersion: string): Promise<string>;
}
interface DocumentPicker {
  openOne(): Promise<string | null>;
  openMany(): Promise<readonly string[] | null>;
  saveAs(defaultPath: string): Promise<string | null>;
}
interface DocumentPrompts {
  unsaved(name?: string): Promise<"save" | "discard" | "cancel">;
  overwrite(): Promise<boolean>;
  externalChange(dirty: boolean): Promise<"reload" | "keep">;
  alreadyOpen(path: string): Promise<void>;
  error(context: DocumentErrorContext, error: unknown): Promise<void>;
}
interface RecoveryStore {
  list(): Promise<RecoveryListing>;
  write(snapshot: RecoverySnapshot): Promise<void>;
  remove(id: string): Promise<void>;
}
```

- `DocumentErrorContext` 包含 open/save/saveAs/fileAction/closeWindow/restore 等语义类型；翻译键只在适配器映射。保留当前可见文案，不把原生错误直接当可执行指令。
- 文件适配器验证读写返回字段，并将冲突错误转换为 `DocumentConflict`；其他错误保留原始信息供展示；业务层不再到处解析原始 IPC 对象。不要使用路径字符串模拟错误状态。
- 初次迁移继续沿用 boolean 返回语义，避免同时改所有动作协议；新命令注册器可把其转换成 done/not-executed。确需区分取消/繁忙/冲突时再在控制器定义判别联合，不能从 false 猜测取消原因。
- 消费方使用 `DocumentActionsSource`、`RecoverySource` 等小接口。显式列出必要字段；不要只是把 ReturnType 改名为一个同样巨大的接口。
- `updateMarkdown`、`updateMode` 和 `updateSelection` 拒绝旧文档/generation 的事件。状态批量替换沿用既有更新顺序和同步 revision watcher，先建立回归用例，再考虑调整提交实现。
- 规范化与重复路径政策属于工作区，控制器通过 `resolveSavePath` 类似的窄回调请求批准；文件适配器只解决路径，不依赖标签集合。

### 4.3 编辑器接口

`EditorPort` 分成生命周期和交互能力，避免恢复/标签模块被迫依赖整个 UI 操作集：

```ts
interface EditorLifecyclePort {
  flush(): void;
  capture(): Promise<EditorSessionCheckpoint | null>;
  suspend(): Promise<EditorSessionCheckpoint | null>;
  resume(): Promise<boolean>;
}
interface EditorInteractionPort {
  focus(): void;
  undo(): boolean;
  redo(): boolean;
  selectAll(): void;
  clearUndoably(): void;
  paste(): Promise<void>;
  search(query: string): void;
  find(query: string, forward: boolean): void;
  replace(query: string, replacement: string, all: boolean): void;
  closeSearch(): void;
  navigateHeading(target: OutlineHeading): boolean;
  captureView(): RecoveryView;
  applyView(view: RecoveryView | null | undefined, sourceMode: boolean): void;
}
```

接口片段只描述现有能力；`toggleMode` 继续采用现有返回契约。`OutlineHeading` 包含 line/index/level；调用前同步刷新大纲并核对目标 ID 与文字，失效目标不执行。实际成功定位后才更新 activeHeading。

粘贴单独处理：同步尝试原生粘贴须保持在用户事件调用栈内，不能先 await 队列再触发；异步读取剪贴板后须校验 documentId、generation、mode 与 lease，若用户已切换则取消，不能把 A 的内容粘到 B。现有 readClipboardData 可作为注入依赖；富文本/图片处理继续交给 Muya 的现有实现，源码模式使用纯文本。

会话分别发出中立的 ready 与 availability 状态，后者在组合输入或生命周期转换期间为 false；不轮询或深拷贝历史。替换按钮依赖当前模式可用状态和非空查询。

`EditorSession` 仍是唯一生命周期仲裁者：操作实现不得绕过 disposed/suspended/composing/transitioning 检查。普通查询与编辑命令不统一强行进入异步队列；具体规则见下一节。

引擎特有选区仍留在引擎/检查点层。App 若需要选择状态，只接收无块实例的摘要；当前 selection 的实际消费方须搜索核实，无消费者就删除该向上传递链。

## 5. 并发与事务设计

### 5.1 队列不能简单合并

| 操作 | 当前/目标策略 | 为什么 |
| --- | --- | --- |
| 用户连续点击文件命令 | 忙时拒绝重复执行 | 避免多个保存/关闭对话框 |
| 操作系统传入文件 | 按到达顺序等待工作区空闲 | 不能丢失外部打开请求 |
| capture/suspend/resume/切换模式 | 会话内部串行，等待 IME 最后 input 与 async-idle | 检查点必须覆盖最终输入 |
| undo/redo/清空/替换 | 检查当前会话可用性；忙时不执行 | 避免作用于挂起或错误引擎 |
| 剪贴板读取 | 用户事件内发起；异步完成校验原目标 | 保留权限与文档边界 |
| 单文档保存 | 保留 writeQueue，保存内容与格式先取快照 | 防止写入顺序颠倒 |
| 单文档恢复写入与删除 | 同队列按序，删除排在待写之后 | 防止关闭后备份复活 |
| 旧恢复目录删除 | 独立目录队列，拒绝删除打开文档记录 | 保留当前档案保护 |

### 5.2 激活事务留在一个协调器

1. 检查 targetId 与当前工作区是否有效，获得工作区操作权。
2. 捕获当前视图，等待旧 EditorSession.suspend；核对 documentId/revision。
3. 将有效检查点交给旧文档内部记录，清除任何实时选区引用；异步排队备份，不等磁盘完成。
4. 准备目标编辑器模块；变更活动文档/挂载代号，等待 Vue 挂载并 resume。
5. 成功后清除目标挂起检查点；模块只加载一次，切换模式/文档才按既有规则重建实例。
6. 目标失败时用旧检查点恢复原标签；原标签恢复也失败时保留两份文档数据和错误状态，允许重试，禁止回退为“清空成功”。

先搬迁现有流程，新增状态表示仅为表达已有阶段。不要把步骤分散到多个 watcher，以免失去成功/失败的统一返回和回滚顺序。

### 5.3 关闭与恢复

- 单标签关闭：settle → 针对内容确认 → 锁定编辑并再次核验 → prepareExit → 激活后继 → 删除标签/停止监听。中途失败恢复备份调度。
- closeAll/exit：先收集每文档批准内容，再锁定并复核全部；此之前不删除标签。窗口退出由工作区调用窄 WindowPort，窗口销毁失败要 resume 并 flush 恢复存储。
- `DocumentController` 不具有 exit/closeWindow 能力；关闭标签/关闭全部/退出由工作区组合单文档确认与保存。
- 恢复旧草稿：创建新文档并挂载 → 新草稿备份成功 → 删除原记录。备份失败时原记录保留；重复路径/磁盘变化恢复为副本。
- 拆 RecoveryCatalog 与 DocumentRecovery 时保留 retired、打开文档 ID 过滤、未读损坏记录计数和失败重试；不能把“当前文档备份”与“可恢复目录”当作一份列表。

## 6. 具体提交计划

每个提交保持可构建和行为可用；不预先删除旧入口。新入口接通全部调用后，在同阶段移除兼容转发。

### A1 — `refactor(document): centralize document contracts`

1. 新建 document/types.ts，迁入 FileEncoding、FileFormat、defaultFileFormat 及适合集中管理的磁盘/恢复 DTO；保留字面值与 v1 字段。
2. preferences、sessionTypes、documentSafety 和调用方改为依赖中立类型。短期 re-export 可以帮助迁移，但完成后删除无用途转发。
3. 定义动作/恢复消费方的小接口，替换 ReturnType<typeof useWorkspace>；暂不拆状态算法和队列。
4. 更新受到导入路径影响的 Node 测试加载器，保持其现有场景能执行；不可借改类型删除测试。
5. 验收：业务类型不依赖设置 UI；类型检查通过；编码与文档动作相关测试通过。

### B1 — `refactor(editor): encapsulate interaction capabilities`

1. 增加 editorPort.ts 与引擎操作实现；逐项迁移 focus、selectAll、clearUndoably、搜索/查找/替换。
2. 迁移大纲导航和 captureView/applyView；保持无效视图降级不阻止正文恢复。
3. 迁移剪贴板调用，保留同步权限路径与异步目标校验。
4. 增加中立状态通知，更新 App 的搜索可用性和 ready 处理；覆盖源码检查点独立恢复场景。
5. App 仅通过 EditorPort 操作实例，删除 getMuya/getSource 的 App 调用、Muya 类型、IHistorySelection 类型、引擎 DOM 访问。
6. EditorSession 的外观 props 改为中立 EditorAppearance，在组件内部映射 IMuyaOptions；保留稳定 computed 对象与 CSS 更新策略。
7. 验收：两种模式交互一致；关闭搜索后焦点/光标策略保留；延迟粘贴不污染其他标签；设置变更不重建实例。

### C1 — `refactor(document): inject native file and dialog ports`

1. 实现 Tauri 文件/对话框/恢复存储适配器；集中命令和 DTO 映射，语义错误在 UI 适配器翻译。
2. useWorkspace/useDocumentActions/useRecovery 改成显式注入 ports，先保持它们的内部流程和返回值。
3. 将 file picker 从读写函数中提到用例层；文件读取只接收路径和 fallback encoding。
4. App 或应用工厂创建适配器并传给工作区；不得在文档模块内偷偷创建默认 Tauri 实现。
5. 为适配器保留少量 IPC 参数/结果用例；业务用例使用内存 ports 和可控制 resolve/reject 的 Promise。
6. 验收：文档/恢复业务代码不直接 import Tauri 或 i18n；错误仍只提示一次，取消仍不报错。

### C2 — `refactor(document): separate state and lifecycle use cases`

1. 提取 useDocumentState，明确 readonly 视图与 commit/update 方法；revision 更新只有一个所有者。
2. 提取 createDocumentController，集中 replaceFromDisk、writeSnapshot、saveAsPending、writeQueue、checkedDisk、确认循环。
3. 将文件读取、保存、外部确认等状态变更通过 state 方法完成，继续逐个校验旧 generation/path/baseline。
4. useWorkspace 暂时作为组合转发门面；消费者迁完后删除或改成语义明确的轻量入口。
5. 将 Node 文档动作场景迁入 Vitest（含系统关闭监听生命周期）；完成一一映射后删 VM loader，更新 package scripts/check.mjs/tests 文档的对应引用。
6. 旧单文档 new/open/close 流程只在仍有真实生产调用时保留；测试迁移须区分单文档替换保护和当前多标签新增行为。
7. 验收：写入期间输入、覆盖期间再修改磁盘、对话框期间编辑、旧请求晚到、恢复副本、独立编码均保留。

### D1 — `refactor(workspace): isolate recovery ownership`

1. 从 useDocumentTabs 提取 useRecoveryCatalog；注入 RecoveryStore、打开 ID 集合与 retired 判断。
2. useRecovery 迁为每文档 useDocumentRecovery，接受 RecoverySource 与 view/flush 小接口。
3. 保留 750ms debounce、5s deadline、快照签名、写删顺序和失败标记；清楚区分 stop 与 prepareExit，不把卸载直接当作丢弃。
4. 工作区统一聚合 failed/flush/prepareExit/resume；恢复 UI 只读目录，不碰每文档内部对象。
5. 验收：关闭取消、清理失败、旧写晚到、恢复后备份失败、未查看草稿保留、损坏记录保留。

### D2 — `refactor(workspace): narrow tab and window lifecycle APIs`

1. useDocumentTabs 迁成 useDocumentWorkspace；DocumentTab 内部记录不向 App 暴露 workspace/actions/recovery/stop。
2. 外部仅拿 readonly TabSummary、活动文档视图、EditorLifecyclePort 接线和 activate/close/openPaths/执行命令。
3. 将 exit 从每文档 action 类型和配置移除；删除抛错的 closeWindow 占位实现。窗口退出仍由同一个工作区关闭协调流程控制。
4. 激活/回滚与 confirmAll 保持在协调器内部；原生打开等待保留独立入口及卸载取消能力。
5. 必要时用结构化事件更新正文/模式；异步回调须携带身份，不能仅按“当前 active”写入。
6. 验收：激活失败回滚、关闭后台标签、全部关闭取消、窗口销毁失败、忙时原生请求等待、销毁后请求取消。

### E1 — `refactor(app): unify command routing and monitoring`

1. 用命令 ID 联合和带参数请求替代任意 string；如 `{ id: 'tabClose', tabId }`，不用隐式读取已变化的 contextMenu。
2. 注册器提供 canExecute 与 execute；执行时再次判断，不信任菜单打开时缓存的 disabled 状态。
3. 菜单、快捷键、右键和系统关闭接同一用例；快捷键配置 ID 不改，菜单结构与分组仍归 UI 配置。
4. 输入框内复制/全选等保留浏览器行为；编辑器外的 focus 不得被命令注册器无条件抢走。无文档/IME/弹窗/忙状态按现有约束禁用。
5. 提取 useDocumentMonitoring，负责焦点/visibility/5s 轮询及卸载清理；复用现有文档检查策略，不增加后台扫描频率。
6. App 剩余职责为依赖组合、布局和 UI 状态；不以行数指标为目标，也不创建另一个等量“大 composable”。
7. 验收：同一动作从三个入口执行结果相同；右键关闭目标明确；事件监听与计时器无重复；欢迎页与冷启动边界保持。

### F1 — `refactor(native): separate document IO and command adapters`

当前文件：

```text
src-tauri/src/
  lib.rs                  # 模块声明与 run 导出
  app.rs                  # builder、插件、事件、命令注册
  document.rs             # document 模块组合与原有文件测试
  document/
    codec.rs              # 文档类型、编码、解码与 BOM
    paths.rs              # 规范化和符号链接写目标
    io.rs                 # 错误、版本、读写、锁和原子写
    commands.rs           # Tauri 命令与 blocking 调度
    images.rs             # 图片路径校验及授权
  recovery.rs             # 恢复存储与现有命令
  window_instance.rs      # 现有窗口、请求与 StartupGate
```

1. 先搬类型/codec，再搬路径与 I/O，再迁命令/app；过渡期 pub(crate) 显式导出，拒绝无差别 pub。
2. DOCUMENT_IO_LOCK、TEMP_FILE_SEQUENCE 只保留一个定义，检查是否有嵌套持锁；锁的范围和 checked_atomic_write 二次校验顺序保持。
3. recovery 从 document 模块导入 atomic_write/encode_document；低层 I/O 不反向 import recovery/app。
4. Tauri 命令名称、参数 camelCase 映射、返回 JSON、错误 code/version、asset 授权范围保持。移动后核对 generate_handler 与插件注册。
5. 原有测试按职责随代码迁移；不改断言让新路径“通过”。window_instance 内部细拆暂缓，避免同时改启动行为。
6. 验收：编码已知字节、原文件保护、临时文件冲突清理、符号链接、图片授权、恢复目录全通过；编译实际 Tauri 入口，必要的 Linux 原生命令冒烟验证。

### G1 — `chore(architecture): remove obsolete contracts and document boundaries`

1. 核对全仓引用后移除 useHistory.ts 和未采用的 DocumentSession；更新 editor-session-history.md 的实际所有权描述。
2. 清除完成迁移的 re-export、旧 VM loader、旧动作分支、getMuya/getSource 暴露及已无消费者的选区链。
3. tests/README.md 改为按改动范围选择测试，保留完整 check 作为可选全集入口，不恢复代码质量 Action。
4. 同步 multi-file/startup 文档中的模块名、接口和已过时描述。
5. 打包元数据先扩充 desktopIcons 契约测试核对扩展名、UTI/MIME、图标引用和文件存在；这一阶段不引入生成器。跨 NSIS/plist/JSON 的共用元数据生成留作独立后续方案，不借重构抹平 Windows 可选注册、Linux 主题优先级和 macOS UTI 的差异。
6. 验收：无过渡门面遗留，文档与实际边界一致；平台行为和工作流触发条件保持。

## 7. 测试选择与缺口补齐

遵循用户要求：只运行修改触及的测试类别；依赖迁移影响到的消费者属于相关范围。纯文档阶段不运行应用测试。以下是实施时的选择规则，不是本轮已通过的报告。

| 工作包 | 现有相关测试 | 重点新增/补齐 |
| --- | --- | --- |
| A | fileEncoding、preferences、document-actions；前端类型检查 | DTO/编码引用迁移后语义保留 |
| B | editorSession、historyAdapters、SourceEditor；E2E editorSession/documentOutline/p2 中受影响用例 | 源码独立恢复可替换；两引擎能力一致；异步粘贴跨标签取消；陈旧大纲目标拒绝 |
| C | documentOpen、documentSafety、fileEncoding、document-actions；E2E documentSafety | 注入 ports 的延迟/错误用例；每种错误只提示一次；旧代号回调隔离 |
| D | documentTabs、nativeFileRequests、documentSafety；E2E documentTabs/nativeFiles | 双重恢复失败仍保留数据；prepareExit 失败恢复备份；目录与活动 ID 隔离 |
| E | shortcuts、相关命令新用例；E2E contextMenu/documentTabs，startup | 同命令多入口；输入框焦点策略；右键目标已关闭时安全返回；卸载清理 |
| F | Rust document/recovery/image 迁移测试；入口编译 | 命令 DTO/错误兼容；锁定义与持锁路径检查 |
| G | 删除模块原相关用例；desktopIcons（仅元数据核对变动时） | 文档链接/引用、旧入口消失；平台配置一致性 |

实例存活/外观约束涉及共享 EditorSession 时，从 settings/i18n/mermaidTheme 中选择实际覆盖“设置不重建”的用例；如果只改底层编码类型，不运行这些视觉测试。涉及编辑器命令/选择行为时选择相关 Chromium 用例；按用户当前要求跳过 WebKit 测试。浏览器测试不能替代 Linux WebKitGTK 原生交互验收。

建议命令（在仓库根执行，实施时替换为该提交实际涉及文件；无需新增包）：

```bash
pnpm exec vue-tsc --noEmit
pnpm exec vitest run src/editor/__tests__/editorSession.spec.ts src/editor/__tests__/historyAdapters.spec.ts
pnpm exec vitest run src/composables/__tests__/documentTabs.spec.ts src/composables/__tests__/nativeFileRequests.spec.ts
pnpm exec vitest run src/document/__tests__/documentActions.spec.js
pnpm build
pnpm exec playwright test --project=chromium tests/e2e/editorSession.spec.ts tests/e2e/documentTabs.spec.ts
```

上述是不同范围的示例，不是每个提交都执行一遍。文档动作测试已迁入 Vitest，仅在相关功能受影响时运行。Playwright 配置同时启动开发入口和 dist 预览，运行相关浏览器用例前，源码变更后须构建当前 dist，不能拿旧产物验收。`tsconfig.node.json` 检查仅在工具/配置 TS 改动时额外运行。

Rust 模块迁移涉及文件 I/O 与命令入口时，在 src-tauri 运行 `cargo check --locked --offline`，并执行迁移后 document/recovery 等模块的测试过滤；若 run/窗口接线被改动，才纳入 window_instance 和真实启动冒烟。发布打包/图标安装测试仅在相应打包文件变更时运行。

新增测试检验可观察行为和失败时序，不为每个新接口写“调用了一次同名方法”的镜像测试。原有覆盖删除前列场景映射清单，尤其不能丢弃窗口关闭监听、保存确认期间新输入等既往回归。

## 8. 分阶段人工验收

以下为后续原生平台验收指南；本轮依用户要求跳过 WebKit，未执行这些人工场景：

1. **B/E：两模式交互**。新建、输入中文/英文，搜索/向前后查找/替换/清空/撤销；切到另一个标签再回来，使源码模式从检查点单独恢复，重复上述动作。检查工具栏可用性。
2. **B/D：输入与切换**。中文输入法组合未结束时切换标签/模式；完成输入后验证最后字符、选区和 undo。延迟剪贴板读取期间切换标签，内容不得进入新标签。
3. **C/D：保存与退出**。两个脏文档，第一份不保存、第二份取消退出；两份内容仍在。保存期间继续输入只保存已捕获版本，新增输入仍显示未保存。对话框期间继续编辑触发再次确认。
4. **C/D：外部编辑和恢复**。外部修改/删除文件、保留本地、覆盖确认期间再次外部修改；模拟恢复存储失败，原草稿不得提前删除，恢复后可重试。
5. **B/E/F：启动和外观**。冷启动开发/安装版本，欢迎页先显示；首次新建加载编辑器。切换中英/主题/字体/缩放保持历史与实例，无全局滚动条或焦点回退。
6. **D/F：系统入口**。文件选择/保存确认期间由文件管理器打开另一文件；原命令结束后交付到同一窗口。取消关闭保持原标签，真正关闭后不复活旧会话。

性能验收以相同机器/构建/文档比较：记录欢迎页是否加载编辑器、每标签实例数、未编辑时磁盘全文读取次数、输入期间检查点捕获次数、切换/打开的耗时分布。现有大文件用例可作行为基线，不能把 fixture 耗时当原生磁盘性能。没有测量前不承诺固定毫秒或内存下降比例。

## 9. 风险与回退策略

| 风险 | 检测方式 | 处置 |
| --- | --- | --- |
| 改目录使静态 import 提前加载 Muya | 启动浏览器请求、构建 chunk 检查 | 回退相应导出/组合，恢复动态入口 |
| ref/readonly 修改改变 watcher 时序 | 延迟输入、保存和 revision 行为测试 | 保留原提交顺序，分离类型迁移和状态变更 |
| 操作抽离丢失 DOM/引擎上下文 | 两模式真实组件与相关浏览器测试 | 显式注入实例访问函数，禁止失去 this 的裸方法转发 |
| 过度统一队列引起等待环 | IME、OS 队列与关闭交错测试 | 维持分层队列；内部已持操作权时不重新进入 guard |
| 关闭后旧写导致备份复活 | 控制 Promise 顺序并检查存储最终内容 | 删除始终排在待写之后，失败恢复调度 |
| 类型抽象损失引擎检查点校验 | historyAdapters 无效状态/恢复用例 | 保留判别联合、强类型、clone/freeze 和版本验证 |
| Rust 移动导致宏、锁或 IPC 漂移 | 入口编译、真实文件测试、命令契约 | 单独回退 F 提交，不牵连前端 |

各阶段提交独立可回退；A/B/C/D 有依赖时按逆序回退，不只回退类型定义留下新调用方。保持数据格式兼容，使回退不需要转换用户设置、Markdown 或恢复记录。暂存门面须标记删除阶段，不能成为永久双实现。

## 10. 完成判定与交付

本方案实现完成时应提交以下证据：

- [x] App 不 import Muya/CodeMirror 运行时或实例类型，不使用 getMuya/getSource/searchModule/编辑器 domNode。
- [x] 文档控制器、状态和恢复模块不直接调用 Tauri、i18n 或原生对话框；依赖由应用层注入。
- [x] 公共业务接口不再使用整个 composable 的 ReturnType；UI 只能读标签摘要和受控更新入口。
- [x] 文档状态只有一个所有者，未引入并行可变 DocumentSession；后台检查点没有实时对象引用。
- [x] 单文档 action 不含退出窗口能力，不存在抛错占位实现。
- [x] 菜单/快捷键/右键共享执行入口，目标标签显式传递，输入框默认行为保留。
- [x] 切换、关闭、保存、恢复和原生打开请求满足第 3、5 节全部约束，有对应行为测试或原生验收记录。
- [x] Rust 基础模块不依赖 crate 根的实现细节，命令协议、单例锁与文件原子写语义保持。
- [x] 删除旧类型/旧加载器前有覆盖迁移清单；相关测试已通过，未运行范围明确记录，不能笼统宣称全平台通过。
- [x] 文档、测试入口与真实实现一致；没有新增质量 Action、无关依赖或未要求的格式升级。

本轮测试结果和平台限制见文首。相关提交按职责拆分，可按 Git 历史逐项审查。

相关现有文档：[多文件](multi-file.md)、[历史检查点](editor-session-history.md)、[启动](startup.md)、[文档图标](document-icons.md)、[测试说明](../tests/README.md)。
