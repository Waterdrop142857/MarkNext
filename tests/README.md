# 自动化测试与质量检查

统一入口是 `pnpm check`。任何检查失败立即返回非零退出码，后续阶段不继续执行；不自动重试失败测试，Vitest 和浏览器测试不允许 `.only`，Vitest 的未处理异常会令流程失败。浏览器测试还会检查未捕获异常、console.error 与意外的外部网络请求。

## 环境准备

需要 Node.js 24+、项目固定的 pnpm 11.28.3、Rust stable（含 rustfmt/clippy）以及当前平台的 Tauri 系统依赖。使用锁文件安装：

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium webkit
```

在受支持的 Linux 系统（例如 Ubuntu 24.04）可以一次安装浏览器及系统依赖：

```bash
pnpm exec playwright install --with-deps chromium webkit
```

新增 jsdom 27.4.0、@playwright/test 1.58.2 前，已核对 npm 官方 registry 的名称、版本、repository、tarball/integrity，以及官方源码 package.json 的名称与版本。固定精确版本并记录锁文件，后续增加/升级依赖也应先确认真实存在、来源可信。

## 命令

| 命令 | 范围 |
| --- | --- |
| `pnpm check` | 类型检查、全部前端测试、Rust 检查、Tauri 发布二进制、Chromium/WebKit 回归 |
| `pnpm check:frontend` | 类型检查、全部前端测试、生产前端构建、两个浏览器回归 |
| `pnpm check:native` | Rust fmt/check/test/clippy、实际 Tauri 发布二进制构建、plain release check/clippy |
| `pnpm test` | 全部 Vitest 测试（包括文档动作） |
| `pnpm test:e2e` | 先构建生产前端，再运行全部浏览器回归 |
| `pnpm test:unit` | 所有 `src/**/*.spec.ts` 与文档动作测试，不含历史审计复现 |
| `pnpm test:document-actions` | Vitest 的文档动作与窗口关闭测试 |

单文件定位失败可使用 `pnpm exec vitest run <文件>`。浏览器单项目诊断可使用 `pnpm exec playwright test --project=webkit` 或 `--project=chromium`；这两条诊断命令要求已有 dist。按改动范围运行相关测试；明确记录未覆盖的范围。完整流程可在需要全量检查时运行。

`scripts/check.mjs` 负责跨平台串行执行和退出码传播，支持 pnpm JS 启动器与 Unix/standalone 启动器。Rust 命令使用 `--locked`；Tauri CLI 也将该参数传给 Cargo，实际验证 beforeBuildCommand、production 资源、release feature flags 和链接。流程使用 `--no-bundle`，验证可执行文件，不依赖签名、商店账户或安装器打包环境。

## 测试层次与 P1 回归

多文件与单窗口新增覆盖：`src/composables/__tests__/documentTabs.spec.ts` / `nativeFileRequests.spec.ts`、浏览器 `documentTabs.spec.ts` / `nativeFiles.spec.ts` 及 Rust `window_instance` 测试。覆盖每文件历史/模式隔离、唯一活动渲染器、关闭事务、路径去重、恢复、原生请求队列及安装器配置。浏览器原生 IPC 仍使用官方 mocks，窗口管理器焦点和安装后的文件关联按 [手动指南](../docs/multi-file.md#手动验收) 在对应系统验证。

冷启动覆盖：`src/services/__tests__/startup.spec.ts`、浏览器 `startup.spec.ts` 及 Rust `StartupGate` 测试验证前置主题、开发/生产入口延迟、编辑器按需加载、启动失败重试与窗口就绪代号。流程和人工验收见 [启动设计](../docs/startup.md)。

- Vitest 保留原测试声明的 happy-dom/jsdom 环境。安全净化用例使用 jsdom；happy-dom 对此版本 DOMPurify 的支持不完整，不以它证明净化安全。CSS inline 导入启用真实 KaTeX、Prism、GitHub Markdown 和 exportStyle 内容，避免空字符串产生误通过。
- `documentOpen.spec.ts` 使用真实 Muya、真实 workspace/actions，并控制 RAF 与 IPC 完成时序。覆盖读取期间排队编辑后的保存/丢弃/取消、已批准版本不重复询问、确认期间的新编辑、读取失败和 generation 变化；读取只执行一次。另覆盖新建、关闭窗口和退出时，确认期间新输入的内容不会被此前的丢弃选择覆盖。
- `htmlPreviewIsolation.spec.ts` 使用真实 Muya，验证大小写样式表、危险行内布局、SVG 动画/事件属性、允许的普通样式，以及源 Markdown 不被净化改写。行内 HTML 与块预览使用同一 CSS 策略。
- Vitest 文档动作测试覆盖新建、打开、关闭、退出与系统关闭的统一保存保护、保存失败、重复操作和监听器生命周期。
- 浏览器回归挂载真实 Vue 应用与编辑器，通过 Tauri SDK 的官方 mocks 控制磁盘和对话框 IPC；Chromium/WebKit 分别验证延迟读取期间的实际输入、三种确认选择、CSS 净化与真实布局/菜单点击，以及生产 dist 隐藏开发者工具、正常启动。页面只能访问本地测试服务器，外部请求会被阻止并令测试失败。
- `/tests/e2e/fixtures/host-style.css` 是真实存在的测试样式表。浏览器测试会确认原始 HTML 的 link 被移除，且没有请求该文件；不会下载外部“恶意 CSS”。
- `mermaidTheme.spec.ts` 使用真实 Mermaid，覆盖流程图、时序图、类图、状态图和 ER 图。验证暗色连接线及箭头在编辑器与浮层背景上达到 3:1 对比度，时序消息文字达到 4.5:1；亮色、暗色与跟随系统之间切换保留原 SVG/编辑器实例，恢复浅色配色，保留显式 linkStyle 线条颜色和空心标记语义。
- P2 的 SourceEditor/search 单元测试覆盖空查询、无关选区、内容变更后的偏移、大小写与整词选项、替换后下一匹配、模式切换保留历史以及新文档/外部内容使旧历史失效。
- `diagramRevision.spec.ts` 用受控 renderer 加载和延迟绘制验证旧成功/失败、清空、销毁、移除、重复请求以及 Vega view.finalize 清理。每个版本在独立目标渲染，断言晚到回调无法改写最新预览。
- `documentImages.spec.ts` 覆盖 POSIX/Windows/UNC、上级目录、中文、空格及编码路径，另存为后的目录更新，权限请求合并、先授权后加载和失败重试。Rust 单元测试验证只接受存在的图片文件，并拒绝非图片、目录、缺失文件和伪装扩展名的符号链接。
- `p2.spec.ts` 在两种浏览器里验证真实应用的搜索、源码历史与文件/模式边界，行内/引用/HTML 图片目录更新，以及 640×480、800×500、1024×720 下两种编辑模式的内部滚动。图片的原生 convertFileSrc 在测试入口映射到本地 SVG fixture，磁盘授权由 IPC mock 记录；这不是原生 asset 协议的端到端测试。

`tests/e2e/app.html` 是 Vite 开发服务器下的测试入口，先准备 mock 再导入真实 src/main。生产构建只从 index.html 进入，不包含该入口及原生 mocks。另一个测试服务器用 vite preview 提供真实生产 dist。二者端口固定为 4173/4174，严格禁止端口自动切换和复用已有服务，避免测试误连其他实例。

## CI

代码质量检查工作流已移除，push/pull_request 不再自动执行上述检查。所有本地测试和 `pnpm check` 命令仍然保留，可按需运行。

仓库保留 [Release 工作流](../.github/workflows/release.yml)，仅由版本标签或手动操作触发，负责多平台安装包构建与发布，不运行完整质量检查流程。发布方法见 [README](../README.md#github-release-自动发布)。

[Build main artifacts](../.github/workflows/build-main.yml) 可手动构建远端 `main` 的最新代码，将各平台安装包保留在当次运行的 Artifacts 中 14 天，不创建 Release。它与 Release 工作流共用 [安装包构建流程](../.github/workflows/build-installers.yml)，均固定源提交并使用 Node.js 24 LTS。

## 报告

统一流程输出：

- `test-results/vitest.xml`：Vitest JUnit。
- `test-results/browser.xml`：浏览器 JUnit。
- `playwright-report/index.html`：浏览器 HTML 报告。
- 浏览器失败时的截图与 trace：位于 test-results 对应用例目录。

这些产物已加入 gitignore。查看 trace 使用 `pnpm exec playwright show-trace <trace.zip>`。历史 `audit/repros.ts` 已将 P1/P2 输入改为正确行为断言，可独立运行，但不替代 src 和 tests/e2e 中的正式验收测试。

## Arch Linux 的 Playwright WebKit

本机 ICU 78 与下载的 Ubuntu WebKit 所需 ICU 74 有不同的动态库名和版本符号；不要用软链接伪装版本。Playwright 的受支持 Ubuntu 环境可由 `install --with-deps` 准备；Arch 可选择受支持容器，或独立兼容运行目录。

本次本地验证从 Ubuntu 官方仓库取得 libicu74 74.2-1ubuntu3.1、libflite1 2.2-6build3，只解包到 `/tmp/marknext-playwright-libs`，没有安装或替换系统库。由于 Playwright 打包启动器会覆盖 LD_LIBRARY_PATH，临时 `/tmp/marknext-webkit-run.sh` 设置对应 WebKit 路径与兼容库后启动原浏览器二进制。

该环境下可执行：

```bash
MARKNEXT_WEBKIT_EXECUTABLE=/tmp/marknext-webkit-run.sh pnpm check
```

MARKNEXT_WEBKIT_EXECUTABLE 只覆盖 WebKit 的启动器路径，测试项目、用例与断言完全相同；缺少运行库依旧失败，不会跳过 WebKit。临时文件可能被系统清理，之后需重新准备兼容环境。Release 工作流不运行浏览器测试。

## 覆盖边界

跨平台文档图标测试见 [文档图标说明](../docs/document-icons.md)：Vitest 检查类型与
资源引用，Linux GTK 集成测试验证主题优先级，安装包工作流验证实际 DEB/AppDir
或 macOS `.app` 内的图标和元数据。

Windows NSIS 安装器有独立的真实安装回归脚本：
`pwsh -NoProfile -File scripts/test-windows-installer.ps1 -Installer <setup.exe>`。
必须在无 MarkNext 安装的一次性 Windows 用户账户或虚拟机中运行，具体范围见
[NSIS 说明](../src-tauri/windows/README.md)。此脚本按需执行，不加入质量检测 Action。

浏览器模拟的是 Tauri IPC，不是 OS 的真实对话框。原生矩阵验证编译、Rust 单元测试和发布二进制链接；不宣称已经自动验证所有操作系统窗口行为、安装器、签名或整库覆盖率。实际 WebKitGTK 窗口、系统剪贴板权限和安装包交互仍需要对应平台验收。

## P2 与窗口布局的手动验收

1. 打开含重复 `foo` 的文档，在两种编辑模式搜索后清空查询，确认替换按钮不可用；编辑前缀后替换仍只改变当前匹配。关闭文档、打开另一份文件，F3/替换应使用新文档。
2. 源码模式先选中无关 `bar` 再点击替换，内容应不变；选择有效 `foo` 可替换并跳到下一处。用 `fooX` 替换 `foo` 两次，应修改原来的两处匹配。
3. 源码编辑后往返切换模式，Ctrl+Z/重做应有效；在所见即所得模式修改内容后再进入源码，旧源码历史应失效。打开新文档不继承旧文件的撤销记录。
4. 准备 Markdown 文件和真实图片，使用 `images/a.png`、`../shared/图片.png`、绝对图片路径、引用图片及 HTML img；在真实 Tauri 窗口确认显示。另存为到另一个目录前，先在新目录准备对应图片；确认相对资源改指向新目录。无路径的新文档不猜测相对图片的基准目录。
5. 连续修改有效图表、立即清空/删掉图表或关闭文档；旧图和旧错误不应晚到覆盖新结果，切换暗色主题应继续清晰。
6. 长文档下将原生窗口缩到最小尺寸，再放大/缩小；分别检查所见即所得和源码模式。滚轮/拖动滚动条只移动编辑区域，标题栏、菜单和底部状态栏保持原位，长状态文字应截断显示。


## 中英文 i18n 验收

`src/i18n/__tests__` 检查词典键与插值参数一致性、系统语言匹配、持久化失败、快捷键冲突和原生按钮返回值。Muya locale 回归验证同一块树、跨段落选区、滚动、输入焦点、已有预览节点与浮动菜单；异步图表回归验证改语言不重启渲染。`tests/e2e/i18n.spec.ts` 在 Chromium/WebKit 检查应用界面、语言偏好、英文保存询问、两种模式的实例/撤销历史和预览节点保留。这些测试已包含在 `pnpm check`。

原生手动验收：

1. 点击菜单栏“设置”，在“外观 → 界面语言”选择 English 并应用，检查菜单、标题栏按钮、底部状态栏、查找/替换、右键菜单与快捷键设置；切回简体中文，确认所有应用文案同步更新。
2. 编辑未保存的文件后切换语言，再新建/关闭/退出。分别选择保存、不保存和取消，确认按钮文案和实际行为一致。检查打开/另存为窗口标题以及应用错误提示。
3. 在两种模式编辑，切换语言，再撤销/重做；检查正文、光标/选区、滚动位置与公式/图表显示。语言切换不会修改 Markdown 文件或重建编辑器。
4. 关闭并重新启动，确认保留所选语言。无已保存偏好时，按系统语言列表的第一个中/英语言选择；中文地区标签统一使用简体中文，其余语言回退英语。

应用可控制的原生对话框标题、消息和自定义按钮已翻译；系统文件选择器自身的控件，以及操作系统/第三方库返回的诊断文字，保持其原始语言。

## 分类设置验收

`preferences.spec.ts` 覆盖旧配置继承、单次持久化、存储失败的原子行为、输入校验和字体引用；`fileEncoding.spec.ts` 验证默认编码捕获、取消打开、另存为保留格式及并发写入隔离。Rust 测试检查明确的 UTF-8/UTF-16 字节、BOM 优先识别、emoji/中文往返、非法编码报错和真实临时文件读写。`settings.spec.ts` 在 Chromium/WebKit 覆盖分类导航、草稿取消/应用/重启、两种模式字体与撤销历史、75%/125%/200% 缩放、快捷键录制与编码 IPC，并验证高缩放下菜单内部滚动、窗口边缘调整区域及选区与文本的几何对齐。浏览器磁盘为 mock，实际字节格式由 Rust 测试验证。

手动检查：点击菜单栏“设置”直接打开浮窗，切换四个左侧分类并修改设置；取消后重开确认未应用。设置字号、字体、缩放后应用，检查正文、代码块、源码模式和浅色/暗色浮窗；撤销/重做应保持可用。使用 UTF-16 和 UTF-8 BOM 新建保存含中文/emoji 的文档，以其他编辑器确认编码，再修改默认编码后保存已打开文件，确认其原格式保留。缩小窗口后检查内部滚动、按钮可达、标题栏和状态栏位置；重新启动确认偏好保留。

浏览器截图与 trace 写入 `test-results/browser/`，浏览器 JUnit 写入 `test-results/browser.xml`。Playwright 清理自己的输出时不再删除同目录下的 `vitest.xml`，CI 会保留全部检查报告。

## 字数统计与文档大纲验收

`documentAnalysis.spec.ts` 验证汉字、英文、Unicode 字符、Markdown 格式、引用链接、表格、代码/公式、H1–H6、Setext、重复标题和源码行号；composable 同名测试覆盖输入合并、持续输入的更新上限、切换文档及销毁后的计时器清理。`documentOutline.spec.ts` 验证两种编辑模式的统计切换（鼠标/键盘、标点/空格、文档切换与撤销保留）和跳转、重复标题定位、编辑器实例与撤销历史保留、语言切换及高缩放下侧边栏独立滚动。

手动检查：打开含中文、英文及多级标题的文档，点击底部统计，在字数（不含标点和空格）和字符数（含标点和空格，不含换行）之间切换，再用 Enter/空格切换；确认切换不改变正文、未保存状态或撤销历史。点击底部“大纲”，核对层级缩进并跳转；切到源码模式增删标题，确认统计和大纲跟随更新。点击重复标题应分别定位；开关侧边栏后撤销/重做仍可用。新建文件应清空统计及大纲，切换语言只改变界面文字；缩小窗口并滚动长大纲时，标题栏与状态栏应保持原位。

## 外部修改保护与草稿恢复验收

`documentSafety.spec.ts` 单元测试验证保存时的磁盘版本保护、覆盖确认期间再次修改、检查结果晚到、排队保存版本、恢复副本和备份/清理队列。Rust 测试使用真实文件验证版本冲突、临时文件写入后的再次校验、恢复记录落盘、编码和损坏记录保留。浏览器同名用例验证完整 UI、取消确认、两种文档来源的重启恢复、恢复副本、保存后清理及尚未查看记录的保留；重启由页面重新加载和持久化原生 fixture 模拟。

大文件浏览器用例打开约 1.13 MB、5000 行的文档，再切换到源码模式，验证可视区渲染的行数小于 200、末尾编辑以及撤销后全文一致。测试输出文件长度、实际渲染行数和打开至切换完成的耗时；磁盘 IPC 使用 fixture，该耗时包含 Muya 初次渲染和测试操作，不代表 Tauri 实机加载时间。单元测试另验证元数据不变时不重复计算全文版本，已确认的外部版本也不重复读取或更新提示。

真实 Tauri 窗口按以下步骤验收：

1. 打开同一 Markdown 文件，用其他编辑器修改，再回到 MarkNext。分别检查有无本地修改的情况，都应先询问保留编辑器内容还是加载磁盘内容；关闭询问应保留内容。保留后反复切换窗口或等待多轮检查，同一外部版本不重复询问；再次外部修改后应重新询问。选择加载后内容更新，编辑模式保持不变；有未保存修改时询问应明确提醒将丢弃这些修改。
2. 在有冲突时直接保存，确认不会覆盖外部内容。测试“重新加载”的取消/不保存、“另存为”，以及“保存我的版本”的取消/确认；覆盖确认期间再外部修改，保存应再次停止。
3. 外部删除文件，再在 MarkNext 保存，确认普通保存不自动重建文件，编辑仍可另存为。
4. 分别编辑已有文件和未命名文档，停止输入至少 1 秒后强制终止应用进程，再启动。通过提示或“文件 → 恢复未保存文档”恢复，检查内容、编码、模式和光标；恢复操作本身不写原文件。
5. 强制退出后先在外部改变或删除原文件，再恢复。确认以未保存副本打开，普通保存进入另存为流程。
6. 保存或选择“不保存”后正常关闭，再启动应不再出现当前草稿；未查看的其他记录仍然可恢复。删除恢复记录必须确认，原文件保持原样。
7. 在应用数据目录的 `recovery-v1` 中放入损坏 JSON，启动后其他正常记录仍可恢复，损坏文件保留并提示。备份失败时显示重试入口；恢复存储后重试应写入最新内容。
8. 使用大 Markdown 文件分别检查所见即所得和源码模式的打开、滚动、末尾编辑、搜索和撤销；静置时后台检查不应每 5 秒读取全文。区分普通长文本与大量公式/图表，后者还有独立的预览渲染成本；源码可视区渲染不代表 Muya 已实现全文虚拟化。

突然终止进程前尚未完成的备份无法保证落盘，持续输入时最多约 5 秒的最近改动可能尚未记录。跨进程写入不受应用内部锁保护；最后版本检查与重命名间的极短竞争窗口仍需注意，不宣称提供跨应用事务锁。


## 历史检查点与渲染器生命周期验收

`src/editor/__tests__/historyAdapters.spec.ts` 使用真实 Muya/CodeMirror，验证捕获后销毁实例，在全新实例中恢复 undo/redo、结构状态、换行配置和多选区；同时检查无效身份、操作、解析配置及视图降级。`editorSession.spec.ts` 验证源码桥接、整个会话组件重建、输入法等待、异步编辑等待、连续模式切换及陈旧修订拒绝。

`tests/e2e/editorSession.spec.ts` 使用独立的真实组件测试入口，验证正文最后一次输入、源码模式仅重建当前渲染器、跨组件历史往返、主选区、真实滚动容器及重复销毁后的监听清理。测试入口不属于生产 main.ts。现有文件动作、设置、大纲等浏览器用例同时作为 App 接入后的回归保护。

手动检查正常界面：在所见即所得中编辑，再切到源码模式进行多次编辑并撤销/重做，返回所见即所得后，应能一步撤销源码阶段的内容，再继续撤销更早的编辑。未修改正文的模式切换不能增加撤销步骤；保存、关闭取消、外部修改确认及字体/语言设置仍应正常。挂起/恢复 API 当前用于未来多文件接入，没有额外的用户界面按钮。
