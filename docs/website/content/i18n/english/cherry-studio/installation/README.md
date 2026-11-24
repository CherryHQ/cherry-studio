---
rich: true
icon: desktop-arrow-down
---

# Installation Tutorial

Download the installer matching your OS and chip from the [official download page](https://cherryai.com/download/v2).

## System Requirements

| OS | Minimum Version | Notes |
| ---- | -------- | ---- |
| Windows | Windows 10 1809 (build 17763, 64-bit) or later, including Windows 11; x64 / ARM64 | Windows 7, 8, and 8.1 are not supported |
| macOS | Recent mainstream releases; pick the Intel or Apple-silicon installer matching your chip | See the [macOS installation tutorial](macos.md) |
| Linux | Mainstream distributions; x64 / ARM64 matched to your architecture and package format | See the [Linux installation tutorial](linux.md) |

{% hint style="warning" %}

Windows 7, 8, and 8.1 cannot run current Cherry Studio releases, including launches through third-party compatibility layers. The installer and the app check the OS version and exit with a message when it is too old — no files are installed or changed. Past installers remain available on [GitHub Releases](https://github.com/CherryHQ/cherry-studio/releases) for reference only and receive no support or security updates.

{% endhint %}

## Choose Your OS

{% tabs %}
{% tab title="Windows" %}

On Intel / AMD PCs, choose the standard Windows build; on Windows ARM devices, choose the build marked ARM. If you are unsure of your architecture, check "Settings → System → About" for the "System type".

[Windows installation tutorial](windows.md)

{% endtab %}
{% tab title="macOS" %}

Apple-silicon (M-series) Macs use the ARM64 build; Intel Macs use the Intel-chip build. Confirm your chip via " → About This Mac". Open the downloaded `.dmg` file and drag the app into Applications.

[macOS installation tutorial](macos.md)

{% endtab %}
{% tab title="Linux" %}

Ubuntu, Debian, and Linux Mint can use `.deb`; Fedora, RHEL, and openSUSE can use `.rpm`; other distributions or portable use can use `.AppImage`. Installers must also match your device architecture.

If you are unsure of your architecture, check in a terminal:

```bash
uname -m
```

`x86_64` corresponds to x64; `aarch64` or `arm64` corresponds to ARM64.

[Linux installation tutorial](linux.md)

{% endtab %}
{% endtabs %}

## Installation Complete

{% hint style="success" %}

If Cherry Studio opens normally, the client installation is complete. Continue with the [Quick Start](../../getting-started/quick-start.md) to configure a model service and send your first message.

{% endhint %}

***

### 💡 Getting Help and Submitting Feedback

If you run into problems during installation, configuration, or use, or have feature suggestions, please reach out through the official channels in [Feedback & Suggestions](../../question-contact/suggestions.md).

When submitting installation issues, please include your OS version, chip architecture, installer file name, and the full error message to help locate the problem.
