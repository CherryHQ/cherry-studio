---
rich: true
icon: desktop-arrow-down
---

# Installation Tutorial

First, download the installer that matches your operating system and chip from the [official download page](https://cherryai.com/download/v2).

## Choose Your System

{% tabs %}
{% tab title="Windows" %}

Most Intel / AMD PCs should choose the standard Windows build; Windows on ARM devices should choose the build marked ARM. Check **Settings → System → About → System type** if you are unsure of the architecture.

[Windows installation guide](windows.md)

{% endtab %}
{% tab title="macOS" %}

Choose the Apple Silicon installer for an Apple M-series chip, or the Intel installer for an Intel Mac. Check ** → About This Mac** if you are unsure. Open the downloaded file and drag Cherry Studio into the Applications folder.

[macOS installation guide](macos.md)

{% endtab %}
{% tab title="Linux" %}

Choose `.deb` for Ubuntu, Debian, or Linux Mint; `.rpm` for Fedora, RHEL, or openSUSE; or `.AppImage` for other distributions or portable use. Match the package to your device architecture.

To check the architecture in a terminal:

```bash
uname -m
```

`x86_64` corresponds to x64; `aarch64` or `arm64` corresponds to ARM64.

[Linux installation guide](../../cherry-studio/installation/linux.md)

{% endtab %}
{% endtabs %}

## Installation Complete

{% hint style="success" %}

If Cherry Studio opens normally, the client is installed. Next, continue with [Quick Start](../../getting-started/quick-start.md) to configure a model service and send your first message.

{% endhint %}

***

### 💡 Get Help and Submit Feedback

If you run into problems during installation, configuration or use, or have suggestions for improvement, please submit them through the official channels listed in [Feedback and Suggestions](../../question-contact/suggestions.md).

When reporting an installation problem, please include your OS version, chip architecture, installer file name and the full error message so we can pinpoint the issue.
