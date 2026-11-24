---
description: Windows installation tutorial
icon: windows
---

# Windows Installation

## System Requirements

Cherry Studio requires **Windows 10 1809 (build 17763, 64-bit) or later**, including Windows 11. Most Intel / AMD PCs use the standard **Windows** build; Windows ARM devices use the build marked **ARM**. Portable builds that run without a system install come in matching architectures as well.

Windows 7, 8, and 8.1 are not supported, including launches through third-party compatibility layers. On an older system the installer shows a message and aborts without installing or changing any files; an installed copy on an unsupported system refuses to start and never offers an update beyond what the OS supports. Past installers remain available on [GitHub Releases](https://github.com/CherryHQ/cherry-studio/releases) for reference only and receive no support or security updates.

If you are unsure of your device architecture, open Windows "Settings → System → About" and check "System type".

## 1. Download the Installer

Open the [official download page](https://cherryai.com/download), select **Windows**.

![Cherry Studio official download page Windows options](../../../assets/7e7db39828c20e3db5210008.jpg)

_The Windows download options on the official website._

_Most Intel / AMD PCs use the standard Windows build; Windows ARM devices use the build marked ARM. For portable use without a system install, pick the portable build of the matching architecture._

## 2. Install and Launch

1. Double-click the downloaded installer;
2. When Windows shows a User Account Control prompt, confirm the file comes from an official source before continuing;
3. Follow the setup wizard to finish installation;
4. Launch Cherry Studio from the Start menu.

## Common Issues

### Missing runtime libraries

The installer detects the Microsoft Visual C++ runtime matching your device architecture and downloads and installs it automatically when missing.

If the automatic download or installation fails, open Microsoft's official download address from the error message, install it, then run the Cherry Studio installer again:

* [x64 runtime](https://aka.ms/vs/17/release/vc_redist.x64.exe)
* [ARM64 runtime](https://aka.ms/vs/17/release/vc_redist.arm64.exe)

### Unsupported system version

If the installer or startup reports an unsupported Windows version, your system is older than Windows 10 1809 (build 17763). Upgrade Windows before installing, or switch to a supported device. Windows 7, 8, and 8.1 are not supported, including launches through third-party compatibility layers; past installers are archived on [GitHub Releases](https://github.com/CherryHQ/cherry-studio/releases) for reference only.

### Unable to launch

First confirm the installer architecture matches your device, and check whether security software is blocking it. If it still fails to launch, include your Windows version, device architecture, installer file name, and the full error message in your feedback.

## Next Steps

Once you see the Cherry Studio main window, continue with the Quick Start.
