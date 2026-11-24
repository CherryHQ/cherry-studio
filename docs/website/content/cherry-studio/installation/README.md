---
rich: true
icon: desktop-arrow-down
---

# 安装教程

请先从 [官方下载页](https://cherryai.com.cn/download/v2) 下载与系统和芯片匹配的安装包。

## 系统要求

| 系统 | 最低版本 | 说明 |
| ---- | -------- | ---- |
| Windows | Windows 10 1809（内部版本 17763，64 位）或更高版本（含 Windows 11），x64 / ARM64 | Windows 7、8、8.1 不受支持 |
| macOS | 近期主流版本，Intel / Apple 芯片按架构选择对应安装包 | 详见 [macOS 安装教程](macos.md) |
| Linux | 主流发行版，x64 / ARM64 按架构和包格式选择 | 详见 [Linux 安装教程](linux.md) |

{% hint style="warning" %}

Windows 7、8、8.1 无法运行当前版本 Cherry Studio，通过第三方兼容层启动也不属于官方支持。安装程序与应用启动时都会检查系统版本，不满足要求时会直接提示并退出，不会安装或更改任何文件。历史安装包仅可在 [GitHub Releases](https://github.com/CherryHQ/cherry-studio/releases) 存档查看，不再提供支持与安全更新。

{% endhint %}

## 选择系统

{% tabs %}
{% tab title="Windows" %}

Intel / AMD 电脑通常选择 Windows 标准版；Windows ARM 设备选择带有 ARM 标记的版本。不确定架构时，在“设置 → 系统 → 系统信息”中查看“系统类型”。

[Windows 安装教程](windows.md)

{% endtab %}
{% tab title="macOS" %}

Apple 芯片（M 系列）选择 ARM64 版本，Intel Mac 选择 Intel 芯片版本。可通过“ → 关于本机”确认芯片类型；打开下载的 `.dmg` 文件后，将应用拖到 Applications 文件夹。

[macOS 安装教程](macos.md)

{% endtab %}
{% tab title="Linux" %}

Ubuntu、Debian、Linux Mint 可选择 `.deb`；Fedora、RHEL、openSUSE 可选择 `.rpm`；其他发行版或便携使用可选择 `.AppImage`。安装包还需匹配设备架构。

不确定架构时，可以在终端查看：

```bash
uname -m
```

`x86_64` 对应 x64；`aarch64` 或 `arm64` 对应 ARM64。

[Linux 安装教程](linux.md)

{% endtab %}
{% endtabs %}

## 安装完成

{% hint style="success" %}

能够正常打开 Cherry Studio，即表示客户端安装完成。随后继续完成[快速开始](../../getting-started/quick-start.md)，配置模型服务并发送第一条消息。

{% endhint %}

***

### 💡 获取帮助与提交反馈

如果在安装、配置或使用过程中遇到问题，或有功能改进建议，请通过 [反馈与建议](../../question-contact/suggestions.md) 中提供的官方渠道提交。

提交安装问题时，请附上操作系统版本、芯片架构、安装包名称和完整错误提示，便于定位问题。
