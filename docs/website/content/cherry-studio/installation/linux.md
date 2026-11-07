---
description: Linux 版本安装教程
icon: linux
---

# Linux

## 1. 下载安装包

打开 [官方下载页](https://cherryai.com.cn/download/v2)，选择 **Linux**。官网会按系统和架构提供不同格式的安装包：

| 使用场景 | 选择建议 |
| ------------------------ | ----------------------- |
| Ubuntu、Debian、Linux Mint | 选择与架构匹配的 `.deb` 包。 |
| Fedora、RHEL、openSUSE | 选择与架构匹配的 `.rpm` 包。 |
| 其他发行版或需要便携运行 | 选择与架构匹配的 `.AppImage` 包。 |

Intel / AMD 设备通常选择 x64（或 x86\_64）版本；ARM 设备选择 ARM64（或 aarch64）版本。不确定架构时，在终端运行 `uname -m`：`x86_64` 对应 x64，`aarch64` 或 `arm64` 对应 ARM64。

## 2. 安装并启动

* `.deb` 和 `.rpm`：优先使用发行版的软件安装器或包管理器打开安装包，再从应用菜单启动 Cherry Studio。
* `.AppImage`：为文件授予可执行权限后，双击运行；也可以在终端运行 `chmod +x 文件名.AppImage` 后启动。

## 无法启动

先确认安装包与系统架构匹配。AppImage 无法启动且提示 `FUSE` 或 `libfuse` 相关错误时，请按当前发行版的官方文档安装相应兼容组件。

仍无法启动时，请在反馈中附上发行版、桌面环境、设备架构、安装包名称和完整错误提示。

## 下一步

看到 Cherry Studio 主界面后，继续完成快速开始。
