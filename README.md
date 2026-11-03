<p align="center">
  <img src="public/icons/marknext.svg" width="112" height="112" alt="MarkNext 软件图标" />
</p>

<h1 align="center">MarkNext</h1>

<p align="center">一个轻量级的极简主义Markdown编辑器</p>

> [!IMPORTANT]
> **AIGC 说明**
>
> 本项目使用生成式 AI 辅助开发（AIGC），包括代码与文档的编写和修改。

## 功能

### 专注编辑

- 所见即所得编辑与 Markdown 源码模式自由切换。
- 标题、粗体、斜体、删除线、表格、图片和超链接，按类别收纳在段落菜单中。
- 代码块语法高亮、任务列表、LaTeX 公式及 Mermaid 图表。
- 撤销、重做、查找与替换，支持整篇文档全选。

### 多文件与导航

- 多标签页编辑，每份文档独立保留编辑历史、编辑模式和滚动位置。
- 多选打开、全部保存、关闭所有文件，重复打开同一文件时激活已有标签。
- 从文件管理器打开文档，或将一个及多个 `.md`、`.markdown`、`.txt` 文件拖入窗口。
- H1–H6 文档大纲，点击标题跳转到对应段落。
- 底部状态栏可切换字数与字符数统计。

### 文件保护

- 关闭未保存文档时询问保存、丢弃或取消。
- 检测磁盘上的外部修改，提供保留编辑器内容或重新加载磁盘内容的选择。
- 保存时校验文件版本，处理外部修改冲突。
- 自动备份未保存草稿，重启后可在“文件 → 恢复未保存文档”中找回。

### 界面与个性化

- 简体中文与英文界面，支持亮色、暗色及跟随系统主题。
- 简洁的自绘标题栏、分类菜单与浮动设置窗口。
- 可设置编辑器字体、字号、代码字体及全局缩放比例。
- 可选择 UTF-8、UTF-8 BOM、UTF-16 LE/BE 默认文件编码。
- 可自定义快捷键，支持多组键位、冲突检测和恢复默认。

## 下载与使用

在 [GitHub Releases](https://github.com/Waterdrop142857/MarkNext/releases) 下载对应平台的安装包。

| 平台 | 安装包 |
| --- | --- |
| Linux x64 | DEB、AppImage |
| Windows x64 | NSIS EXE、MSI |
| macOS Apple Silicon / Intel | DMG |

常用默认快捷键包括新建 `Ctrl+N`、打开 `Ctrl+O`、保存 `Ctrl+S`、查找 `Ctrl+F` 和切换源码模式 `Ctrl+Shift+M`。macOS 使用 `Cmd` 替代 `Ctrl`。

统计口径、文档大纲、快捷键、设置、文件保护与恢复的详细说明见 [使用指南](docs/usage.md)。Arch Linux 用户可参考 [Arch 打包指南](packaging/arch/README.md)。

## 开发文档

- [开发环境、源码编译与 GitHub Actions 发布](docs/development.md)
- [测试流程与报错复现](tests/README.md)
- [架构与开发方向](ARCHITECTURE.md)
- [多文件与桌面集成](docs/multi-file.md)
- [跨平台文档图标](docs/document-icons.md)

## License

[MIT](LICENSE)。本项目包含来自 MarkText / Muya 的代码，按上游 MIT 许可保留相应版权声明。
