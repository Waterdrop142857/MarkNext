# Arch Linux 二进制包

`PKGBUILD` 从 GitHub Release 的 DEB 构建 `marknext-bin`，当前固定为
`v0.2.0`，仅支持上游已发布的 `x86_64`。不从源码编译，不需要 Node.js、
pnpm、Rust 或 dpkg；解包使用 Arch 自带 libarchive 的 `bsdtar`。

## 构建与安装

先确保安装 Arch 的 `base-devel`。将本目录的 `PKGBUILD` 复制到独立构建目录，
以普通用户运行：

```bash
makepkg -si
```

`makepkg` 下载 DEB 和对应标签的 MIT LICENSE，校验固定 SHA-256，安装缺少的
依赖并生成 `.pkg.tar` 包（压缩格式遵循本机 makepkg 配置）；最后通过 pacman 请求安装权限。只构建不安装可用
`makepkg -s`。不要以 root 运行 makepkg。

包内保留 `marknext` 命令、桌面入口、软件图标及 Markdown MIME 回退图标。
只安装 DEB 的数据归档，不执行 Debian 的安装/卸载脚本。桌面数据库及图标缓存
由 Arch 对应依赖包的 pacman hooks 更新，不手动设置用户的默认打开方式。

依赖根据发布 ELF 的直接共享库引用和外部打开功能列出。`webkit2gtk-4.1` 是
运行时依赖，不会随这个重打包流程编译或私自捆绑。此包使用上游预编译程序，
二进制兼容性仍受上游构建环境与本机系统库影响。

## 更新版本

1. 等待对应 Release 公开并确认有 Linux x86_64 DEB；保持资源名与实际发布一致。
2. 修改 `pkgver`，将 `pkgrel` 重置为 `1`。
3. 从该 Release 的 `SHA256SUMS.txt` 核对 DEB 哈希，再计算对应标签 LICENSE 的哈希，
   更新 `sha256sums`；不要改为 `SKIP`。若同版本包内容变动，也要核对来源并递增 `pkgrel`。
4. 运行 `makepkg --verifysource`、`makepkg -s`，检查生成的包及安装行为。

本文件不表示已发布到 AUR。若维护 AUR 条目，还需生成并提交 `.SRCINFO`：

```bash
makepkg --printsrcinfo > .SRCINFO
```
