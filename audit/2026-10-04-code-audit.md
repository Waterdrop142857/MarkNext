# MarkNext 全局代码质量与 Bug 审计

后续状态：本报告记录修复前的审计结果。三项 P1、测试基础设施与 Rust 测试清理问题已修复，见 [P1 修复与自动化验收](2026-10-04-p1-fixes.md)。剩余五项 P2 与窗口滚动问题的修复见 [P2 修复报告](2026-10-04-p2-fixes.md)；下文保留原始证据。

日期：2026-10-04。审计对象：当前工作区的 `MarkNext`，包括 Vue UI、文档生命周期、快捷键与剪贴板、内置 Muya 编辑器、搜索替换、HTML/公式/图表预览、资源路径、Rust 文件读写、Tauri 权限和构建测试配置。相邻的 `marktext` 是参考代码库，本报告不代表对该独立项目完成同等审计。

本次未修改业务代码，未安装依赖。新增本报告、独立复现用例和配置。保留工作区原有未提交修改。结论来自当前工作区内容，不能仅用 Git HEAD 重现。

## 结论与修复顺序

确认 8 项产品/构建缺陷，其中 3 项为 P1；另有测试基础设施和静态检查问题。未发现需要立即停用整个项目的 P0 问题，但当前不能通过 release 编译，也不能将现有全量测试视为通过。

P1：发布阻断、可能丢失编辑、文档内容影响宿主 UI，优先修复。P2：功能错误或验证能力缺口，随后修复。P3：维护与性能改进。

| 顺序 | 等级 | 问题 | 证据 | 实现难度 |
| --- | --- | --- | --- | --- |
| 1 | P1 | release 编译失败：无条件调用 `open_devtools` | release 编译实际报 E0599 | 低 |
| 2 | P1 | 打开文件期间遗漏尚未同步的 Muya 编辑 | 真实 Muya + 受控 IPC/RAF 复现 | 中 |
| 3 | P1 | HTML 预览可把文档 CSS 注入整个应用 | 真实 Muya 预览与计算样式复现 | 中至高 |
| 4 | P2 | 清空搜索框后仍替换旧查询的匹配 | 执行 App 原函数 + 真实 Muya 复现 | 低至中 |
| 5 | P2 | 源码模式“替换”修改无关的选中文本 | 挂载真实 SourceEditor 复现 | 中 |
| 6 | P2 | 模式切换丢失源码编辑器的撤销历史 | 挂载、编辑、卸载、重新挂载复现 | 中 |
| 7 | P2 | 相对图片路径没有当前文档目录上下文 | 真实路径解析函数复现，宿主接入缺失 | 中 |
| 8 | P2 | 异步图表旧结果覆盖新预览 | 真实 DiagramPreview + 受控渲染器加载复现 | 中 |
| 9 | P2 | 全量测试无法完整执行，且存在错误断言 | 全量 Vitest 实际运行 | 低至中 |
| 10 | P3 | Rust 测试清理触发 Clippy 错误 | `clippy --all-targets -D warnings` 实际失败 | 低 |

建议先完成 1–3 并补入正常回归测试；恢复第 9 项的完整验证能力；再统一处理 4–6 的编辑器命令与历史接口，随后处理 7–8。不要为修复这些问题在每次输入或模式切换时重建 Muya。

## 1. P1：发布构建被开发者工具命令阻断

位置：[src-tauri/src/lib.rs:110](../src-tauri/src/lib.rs#L110)，[Cargo.toml:21](../src-tauri/Cargo.toml#L21)。

`open_devtools` 命令无条件调用 `window.open_devtools()`，而当前 Tauri 依赖未启用 `devtools` feature。已安装的 Tauri 2.11.5 源码把该方法限制为 `debug_assertions` 或 `devtools` feature；因此 debug 检查通过，release 检查失败。

实测：在 `src-tauri` 执行 `cargo check --release --offline`，报 `E0599`，位置 `src/lib.rs:115`。这会阻断正式 Tauri 打包，前端 `pnpm build` 通过无法覆盖这个问题。

建议：对开发模式实现加条件编译，正式版返回明确的不支持结果，并隐藏对应菜单/快捷键入口；如产品确实需要正式版开发者工具，再显式选择 feature。验收须同时包含 debug 与 release Rust 检查，以及实际打包检查。

## 2. P1：打开文件的最终替换没有刷新编辑器队列

位置：[useWorkspace.ts:29](../src/composables/useWorkspace.ts#L29)，[useDocumentActions.ts:12](../src/composables/useDocumentActions.ts#L12)。

当前流程在读取文件前调用保存保护并 `flushEditor()`，随后等待 `read_file`。读取完成后仅比较 Vue 的 `markdown` 和文档 generation，没有再次刷新 Muya。如果用户在读取期间输入，最新修改仍在 Muya 的 RAF 队列，Vue 内容与 dirty 尚未更新，比较会误认为可以安全替换。

复现：旧文档初始已保存 → 开始打开新文档，暂停 IPC 返回 → 修改真实 Muya 内容但延迟 RAF → 返回新文档。操作成功且没有保存询问；旧编辑被新内容取代。现有文档动作测试覆盖了 Vue 内容变化，未覆盖尚未发出 `json-change` 的真实编辑器队列。

建议：读取内容先暂存；最终提交替换前同步刷新活跃编辑器，并复核 generation、内容/编辑 revision 与用户已批准丢弃的版本。若出现新的修改，再走统一确认接口。读取不应在每次重新确认时无意义地重复执行。确认、保存、最终替换仍由统一文档动作协调。

验收：延迟读取时的已同步修改与排队修改都得到保护；取消保留旧文档；不保存替换正确；读取失败保留旧内容；保护不会反复询问同一份已批准丢弃的修改。

## 3. P1：HTML 预览缺少宿主 UI 隔离

位置：[utils/index.ts:182](../src/muya/utils/index.ts#L182)，[htmlPreview.ts:56](../src/muya/block/commonMark/html/htmlPreview.ts#L56)，[config/index.ts:411](../src/muya/config/index.ts#L411)。

HTML 预览直接写入应用同一个 document。`escapeInBlockHtml` 对 `style/script/title` 使用区分大小写的正则；大写 `STYLE` 可绕过该转义，而当前 DOMPurify 配置保留样式元素。以下 Markdown HTML 块经过真实 Muya 预览仍含可执行的样式表，并使外部 `.app-shell` 元素的计算样式变为 `display: none`：

```html
<div><STYLE>.app-shell { display: none !important }</STYLE><p>content</p></div>
```

另外，`position:fixed;inset:0;z-index:999999` 的行内样式会保留，可覆盖应用界面。配置注释所称“DOMPurify sanitizes the style values themselves”不成立。已确认的影响是宿主 UI 被文档 CSS 操纵，不据此推断存在 JavaScript 执行或原生 IPC 越权。

建议：立即使用解析器/净化策略禁止预览中的样式表，而不是依赖字符串正则；对行内样式建立明确的布局约束。需要支持完整 HTML/CSS 时，采用 sandbox 预览与独立样式作用域，并限制内容越过预览边界。Shadow DOM 单独使用仍不足以阻止 fixed 布局越界。预览策略与导出策略可以共用基础净化，但必须各自体现宿主隔离需求。

验收：小写、大写、混合大小写 style 标签均不能改变外部 UI；行内布局不能覆盖菜单和对话框；普通表格、图片与允许的样式正常显示。原生 WebKitGTK 仍需验证最终视觉边界。

## 4. P2：查找状态与输入框不一致，可能误替换

位置：[App.vue:322](../src/App.vue#L322)，[App.vue:342](../src/App.vue#L342)，[App.vue:351](../src/App.vue#L351)。

`runSearch()` 遇到空查询直接返回，未清除 Muya 的旧匹配；替换命令又不校验当前查询。因此对 `foo bar foo` 搜索 `foo`，清空搜索框，再全部替换为 `X`，结果仍是 `X bar X`。源码模式的全部替换已有空查询保护，两种模式行为不一致。

同一状态同步缺口也存在于文件/模式切换：搜索输入保留，但新 Muya 没有对应匹配，F3 只调用 `find()`，不会用当前查询重新建立搜索。

建议：统一搜索会话，明确查询、文档 revision、当前匹配和模式。空查询立即清理匹配且禁用替换；任何替换都必须基于当前查询和当前文档的有效匹配；文档或模式切换后重建或清空搜索状态。避免每次操作使用过期的 Muya 内部状态。

验收：空查询不修改内容；切换文档后 F3/替换使用新文档；编辑匹配内容后不使用旧偏移；两种模式的边界与回绕行为一致。

## 5. P2：源码单次替换不验证选区是不是查询匹配

位置：[SourceEditor.vue:109](../src/components/SourceEditor.vue#L109)，[App.vue:342](../src/App.vue#L342)。

`replaceCurrent(replacement)` 只检查是否有选区，随后直接替换，不接收查询或验证匹配。源码模式输入查询时 `runSearch()` 也不会建立当前匹配。真实组件复现：`foo bar` 中预选 `bar`，当前查找目标为 `foo`，执行替换为 `X`，会变成 `foo X`。

建议：把单次替换纳入统一搜索接口，传入当前查询/匹配身份；选区必须与当前有效匹配一致，否则先查找或拒绝替换。搜索框为空、无匹配、任意手动选区均不得修改无关内容。

验收：有效匹配可以替换；无关选区保持原样；替换后定位下一处正确匹配；与 Muya 模式的规则一致。

## 6. P2：源码撤销历史在模式切换后消失

位置：[App.vue:518](../src/App.vue#L518)，[SourceEditor.vue:21](../src/components/SourceEditor.vue#L21)。

SourceEditor 由 `v-if="isSourceMode"` 控制，每次退出源码模式卸载，每次进入重新创建 CodeMirror。当前没有保存/恢复 CodeMirror history。复现确认：编辑后旧实例有 undo 记录；重新挂载后的 Ctrl+Z 不再回退该编辑。

Muya 会把一次源码会话作为整体历史边界提交，这保留了 WYSIWYG 的整体撤销，但不保留源码会话内部的撤销步骤。

建议：按文档 generation 保留源码编辑器及其 history，或在卸载前保存 history 并在同文档重新进入时恢复。若 WYSIWYG 在两次源码会话之间改变内容，必须明确旧历史失效/重建策略，不能直接把旧偏移套用到新内容。继续保留 Muya 实例与单次会话提交边界，避免重新引入两套历史互相覆盖。

验收：只切换模式不丢历史；打开新文档不继承旧历史；WYSIWYG 修改后的源码撤销不能回滚错文档或错位置。

## 7. P2：宿主没有连接本地图片路径上下文

位置：[utils/image.ts:98](../src/muya/utils/image.ts#L98)，[MuyaEditor.vue](../src/components/MuyaEditor.vue)，[tauri.conf.json](../src-tauri/tauri.conf.json)。

图片解析依赖 `window.DIRNAME`，但应用没有在打开/另存为时设置它，也未接入 `convertFileSrc` 或本地图片 asset protocol。当前 `images/picture.png` 被解析成 `file://images/picture.png`，其中 `images` 是 URL host，不是当前 Markdown 所在目录。已有路径函数测试提供了 DIRNAME，无法覆盖实际宿主缺失。

建议：建立文档资源上下文，按当前文件目录解析相对路径，再通过有范围约束的 Tauri 本地资源接口提供 WebView URL。优先显式依赖注入，避免长期依赖全局变量。另存为后同步刷新目录；无路径的新文档要有明确行为。实现时覆盖空格、中文、括号、相对上级目录和跨平台路径。

验收：打开 `/docs/note.md` 后 `images/picture.png` 指向 `/docs/images/picture.png`；另存为改变目录后解析更新；绝对路径和远程 URL 行为正确。函数层面问题已复现，实际本地图片显示仍需原生 WebView 测试。

## 8. P2：异步图表渲染没有版本隔离

位置：[diagramPreview.ts:68](../src/muya/block/extra/diagram/diagramPreview.ts#L68)，[diagramPreview.ts:168](../src/muya/block/extra/diagram/diagramPreview.ts#L168)。

每次 `update()` 将同一 DOM target 交给异步渲染；没有更新 token、取消或结果提交校验。受控复现让旧请求等待渲染器、新请求先完成，随后放行旧请求，最终预览从 `new` 退回 `old`。过期错误也能覆盖正确的新预览，清空内容后旧结果仍可能回来。

建议：每次更新分配 revision；在独立 target 渲染，只有当前 revision 可提交结果/错误；清空和销毁使旧 revision 失效。仅在 `await` 后检查 token 不够，因为渲染器此前可能已直接改写共享 DOM。还要处理绘制库内部延迟回调与资源清理。

验收：旧成功、旧失败都不覆盖新结果；清空后不恢复旧图；销毁后不再提交；连续输入不会产生重复无用渲染。

## 9. P2：测试基础设施与断言存在缺口

全量 `pnpm exec vitest run`：198 个文件通过、3 个失败；1396 条测试通过、2 条失败；另有 15 个 worker 启动错误。

- 15 个文件声明 `@vitest-environment jsdom`，项目未声明/安装 jsdom；这些用例没有执行，不能算通过。应依据它们实际依赖的 DOM 行为选择补齐依赖或迁移到已有 happy-dom，不能盲目更换环境。安装仍须按用户要求核对来源与元数据。
- Node runner 的 `tests/document-actions.test.cjs` 被 Vitest 自动发现，报 “No test suite found”；独立 Node 执行 59 条全部通过。应明确两种 runner 的 include/exclude，并提供统一验证入口。
- [webkitSelectionPainter.spec.ts:145](../src/components/editor/__tests__/webkitSelectionPainter.spec.ts#L145) 假定 LaTeX 源码是单一 text node。异步 Prism 语法加载后它会拆成多个 token，断言失败但片段仍被收集。应验证拼接后的源码覆盖与范围，并控制 grammar 加载时机；目前不能将这个失败认定为产品选区缺陷。
- [embedKatexFonts.spec.ts:12](../src/muya/utils/__tests__/embedKatexFonts.spec.ts#L12) 通过 `?inline` 导入 CSS；Vitest 默认 CSS 处理提供空内容，导致期望 20 个 font-face 实际为 0。应启用实际 CSS 处理或读取确定的 CSS fixture，同时确保字体 URI 转换链被真正验证。另两条对空字符串的排除断言可能产生空通过。

建议提供统一 `check`/CI：typecheck、前端构建、明确环境的 Vitest、Node 文档动作测试、Rust fmt/test/clippy、debug 和 release 检查。仓库本次未发现已有 CI 配置。把本次复现转为正常回归测试时，应反转缺陷断言为期望行为，并放入相应模块，不能将“缺陷仍存在”作为通过条件。

## 10. P3：Clippy 在测试清理阶段失败

位置：[src-tauri/src/lib.rs:160](../src-tauri/src/lib.rs#L160)。

`permissions.set_readonly(false)` 在 Unix 上可能扩大为全员可写，触发 `permissions_set_readonly_false`；使用 `-D warnings` 时失败。位置在临时文件的测试清理代码，不能据此认定生产文件保存权限有同样问题。

建议保存并恢复原权限，在 Unix 上使用精确 mode；Windows 使用对应只读恢复逻辑。验收为 all-targets Clippy 通过，同时原子写入测试仍通过。

## 其他代码质量与性能观察

这些不是已测得的用户卡顿或独立安全漏洞，暂不作为 P1/P2 功能缺陷：

- 主 JS chunk 约 1,575.54 kB，gzip 470.16 kB，超过已设为 1500 kB 的警告阈值。应检查入口依赖和实际启动成本，再选择拆包；不要仅继续调高阈值。
- SourceEditor 的 `viewportMargin: Infinity` 禁用了 CodeMirror 常规视窗限制；WebKit 选区收集会遍历相交节点并读取布局/样式，全选时范围可能覆盖全文。建议用大文档与大量公式/代码块实测输入、切换、全选和滚动延迟，再决定视窗限制、缓存及增量重绘。当前未给出未经测量的耗时结论。
- `useHistory.ts` 在应用中没有引用，是第三套未使用的历史实现；应移除或说明用途，避免之后修复撤销时误接入两种不一致的历史策略。
- App.vue 同时承担文件、模式、命令、搜索、剪贴板与 UI 协调。优先抽取具备真实编辑器桥接测试的命令/搜索接口，避免只把同一逻辑拆成更多文件。
- ARCHITECTURE.md 仍把已经接入的 dialog 标成“待接入”；建议更新当前实现、源码历史边界和统一文件动作规则。
- 原生拖拽、缩放、最小化等 promise 部分未捕获错误。应在可恢复操作上给出一致的错误处理，避免无处理拒绝；尚未模拟原生调用失败。

## 已执行检查

环境：Node v24.21.0、pnpm 11.26.0、Rust 1.98.1，Linux；复现 DOM 使用项目已有 happy-dom。命令从 MarkNext 运行，Rust 命令从 src-tauri 运行。

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过，主 chunk 大小警告 |
| `node tests/document-actions.test.cjs` | 59/59 通过 |
| `pnpm exec vitest run` | 失败：上述 3 文件失败、2 条失败、15 worker 错误 |
| `cargo check --offline` | debug 通过 |
| `cargo check --release --offline` | 失败：E0599 open_devtools |
| `cargo test --offline` | 1 条 Rust 单元测试通过 |
| `cargo fmt -- --check` | 通过 |
| `cargo clippy --offline --all-targets -- -D warnings` | 失败：测试权限清理 |
| `pnpm exec vitest run --config audit/vitest.config.ts` | 8/8 缺陷复现成功 |

复现用例：[repros.ts](./repros.ts)，独立配置：[vitest.config.ts](./vitest.config.ts)。这些用例刻意断言当前错误行为；绿色表示已成功重现，不能当作修复完成证据。搜索复现执行 App.vue 中原函数体，原生 IPC、RAF 和图表加载使用受控 mock；源码替换/历史和 HTML 净化使用真实组件/引擎代码。

原始运行日志在本机 `/tmp/marknext-audit-*.log`，属于临时产物。本报告保留关键错误、计数和复现命令，便于之后重新验证。

## 覆盖边界

已覆盖应用主要模块的静态检查、现有全量测试执行、前后端编译及关键缺陷的确定性复现。未运行真实 Tauri GUI/系统对话框、Windows/macOS 包验证、真实 WebKitGTK 视觉与剪贴板权限测试，也未进行外部依赖漏洞数据库审计。发布构建已在编译阶段失败，未进入完整安装包验证。本报告不保证代码库不存在其他缺陷。
