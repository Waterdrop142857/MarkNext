# 开发、构建与发布

[返回项目介绍](../README.md)

MarkNext 使用 Tauri 2、Vue 3 和 TypeScript。编辑与渲染核心来自 MarkText 的 Muya / Muyajs，本地代码位于 `src/muya`。

## 技术栈

- [Tauri 2](https://tauri.app/)
- [Vue 3](https://vuejs.org/) + TypeScript + [Vite](https://vitejs.dev/)
- Muya / Muyajs（本地代码位于 `src/muya`）
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
pnpm install --frozen-lockfile
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

### Arch Linux 安装包

[packaging/arch/PKGBUILD](../packaging/arch/PKGBUILD) 可将 Release 中的 DEB 重打包为
`marknext-bin`，当前支持 x86_64。将 PKGBUILD 复制到独立目录后以普通用户运行
`makepkg -si`，无需编译应用源码。依赖、校验和更新说明见
[Arch 打包指南](../packaging/arch/README.md)。

### 从 main 构建 Artifacts

在 GitHub 仓库的 **Actions → Build main artifacts → Run workflow** 手动启动构建，无需创建版本标签。工作流读取远端 `main` 的最新提交并固定其 SHA，四个平台构建同一份代码。

进入该次运行的 **Artifacts**，即可下载 Linux x64、Windows x64、macOS Apple Silicon / Intel 安装包。Artifacts 名称形如 `main-<提交前12位>-<目标平台>`，保留 14 天；某个平台失败时，其他成功平台的产物仍可下载。该工作流不创建标签或 GitHub Release，也不会随普通提交自动运行。

main 构建与 Release 共用 [安装包构建工作流](../.github/workflows/build-installers.yml)，使用 Node.js 24 LTS、冻结的 pnpm/Cargo 锁文件，以及相同的平台依赖和签名配置。新工作流需先推送到默认分支，才会出现在 Actions 的手动运行入口。

### GitHub Release 自动发布

[`Build and publish release`](../.github/workflows/release.yml) 在推送 `v*` 标签时自动构建并发布；也可在 Actions 中手动运行，填写已存在的版本标签。手动输入 `0.2.0` 会自动规范为 `v0.2.0`，但不会自动创建标签。普通提交和 Pull Request 不再自动运行质量检查，可按需在本地执行 `pnpm check`。

发布前将 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 和 `src-tauri/Cargo.lock` 中 MarkNext 自身的版本同步，并提交。例如当前版本为 `0.2.0`：

```bash
git tag -a v0.2.0 -m "MarkNext v0.2.0"
git push origin v0.2.0
```

标签必须先创建并推送到远端，且与应用版本完全一致。运行界面选择 `main` 不等于创建版本标签；缺少标签时工作流会在 checkout 前给出明确错误。`v0.2.0-beta.1` 等带预发布后缀的标签会创建 Prerelease；稳定版本发布后标记为 Latest。

构建环境固定为 Node.js 24 LTS，先安装 Node.js 再安装 pnpm，并在构建前检查实际版本。JavaScript Actions 自身也使用 Node.js 24 运行时；修改工作流后，应先推送修复提交再发起新运行，直接重跑旧运行仍会使用旧版工作流。

工作流分别生成 Linux x64 的 `.deb` / `.AppImage`、Windows x64 的 NSIS `.exe`，以及 macOS Apple Silicon / Intel 的 `.dmg`。所有平台成功后上传五个安装包、生成 `SHA256SUMS.txt` 并公开 Release。上传失败会留下草稿，可用同一标签重跑。

发布使用内置 `GITHUB_TOKEN` 的 `contents: write` 权限，无需额外 PAT。当前 Windows 安装包未配置代码签名；macOS 使用 ad-hoc 签名，未做 Apple 公证，下载后系统可能要求确认。签名与公证方式可参阅 [Tauri 官方说明](https://v2.tauri.app/distribute/sign/macos/)。

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

## 测试与实现说明

按改动范围选择测试。用户报错先在独立会话运行完整 Tauri 程序复现，再定位修复，最后重放原生失败场景。具体要求见 [测试流程](../tests/README.md)。

- [架构与开发方向](../ARCHITECTURE.md)
- [多文件与桌面集成](multi-file.md)
- [编辑器会话与历史](editor-session-history.md)
- [启动显示与编辑器加载](startup.md)
- [跨平台文档图标](document-icons.md)
