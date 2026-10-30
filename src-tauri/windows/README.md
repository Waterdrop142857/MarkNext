# Windows NSIS integration

NSIS 安装器在安装目录、快捷方式页面之后提供中/英文的“添加到打开方式”复选框，
支持 `.md`、`.markdown`、`.txt`。新安装默认不勾选，升级保留已保存的选择；
取消勾选会移除之前注册的 MarkNext 打开方式。

注册使用独立的 `com.marknext.app.Markdown` / `com.marknext.app.Text` ProgID、
`OpenWithProgids` 和 `RegisteredApplications` / `Capabilities`。
不会覆盖扩展名的当前默认程序，也不会修改 Windows 保护的 `UserChoice`。
在 Windows 的“打开方式”或“默认应用”中选择 MarkNext 后，文档图标来自安装目录的
`markdown.ico`，软件及安装器图标仍来自软件 EXE。只添加候选打开方式时，文件继续
显示当前默认程序的图标。

安装命令支持 `/OPENWITH=1`、`/OPENWITH=0`，可与 `/S` 或 `/P` 一起使用；
静默首次安装未指定该参数时不注册，`/UPDATE` 使用已保存的选择。
命令和图标路径均加引号以支持含空格的安装路径。
卸载移除本程序的 ProgID、候选项、Capabilities 和文件图标，不删除其他候选项。
旧版 Tauri 的通用关联只在打开命令仍指向本安装目录时清理；扩展名仍指向旧关联时，
才恢复其备份默认值。MSI、Linux 和 macOS 继续使用原有 Tauri 配置。

`installer.nsi` 基于已锁定的 **Tauri CLI v2.11.4** 官方模板：
<https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi>
采用上游 MIT / Apache-2.0 双重许可，MIT 许可见 `TAURI-LICENSE-MIT`。
本项目的差异均标记 `MARKNEXT`：插入安装页、初始化选择、替换注册和卸载逻辑。
升级 Tauri CLI 时必须对照新模板合并上游变更；不要重新引入默认 `APP_ASSOCIATE`，
该宏会覆盖扩展名默认值并使用 EXE 图标。

## 验证

在 Windows 的一次性用户账户或虚拟机内，用实际生成的 NSIS 安装包运行：

```powershell
pwsh -NoProfile -File scripts/test-windows-installer.ps1 -Installer path/to/MarkNext_x64-setup.exe
```

脚本操作当前用户注册表和临时安装目录，拒绝已有 MarkNext 安装/关联的账户。
覆盖：静默默认不注册、显式启用/禁用、升级保留选择、含空格及中文路径、独立图标
字节一致、完整引号、默认程序及其他候选项保留、旧关联迁移、卸载清理。

另外手动检查：安装器前进/后退不丢失勾选状态；中文和英文文案可见；在资源管理器
为 `.md` / `.markdown` 选择 MarkNext 默认打开后显示文件图标，双击可打开文档，
已有窗口时复用现有窗口。系统图标缓存更新由 `SHChangeNotify` 通知。

Linux 上可通过 Tauri 的 Windows target 和 NSIS 编译器交叉验证模板编译及 ICO 打包；
若使用占位 PE 文件，该结果只证明安装器脚本可编译，不证明 Windows 程序或安装交互正常。
