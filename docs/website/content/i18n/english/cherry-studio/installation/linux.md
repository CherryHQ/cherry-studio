---
description: Linux version installation tutorial
icon: linux
---
# Linux

## 1. Download the Installer

Open the [official download page](https://cherryai.com/download) and select **Linux**. The website provides installers in different formats based on your system and architecture:

| Use Case | Recommendation |
| ------------------------ | ----------------------- |
| Ubuntu, Debian, Linux Mint | Select the `.deb` package matching your architecture. |
| Fedora, RHEL, openSUSE | Select the `.rpm` package matching your architecture. |
| Other distributions or portable usage | Select the `.AppImage` package matching your architecture. |

For Intel / AMD devices, typically select the x64 (or x86\_64) version; for ARM devices, select the ARM64 (or aarch64) version. If you are unsure of your architecture, run `uname -m` in the terminal: `x86_64` corresponds to x64, while `aarch64` or `arm64` corresponds to ARM64.

## 2. Install and Launch

* `.deb` and `.rpm`: Prefer using your distribution's software installer or package manager to open the installer, then launch Cherry Studio from the application menu.
* `.AppImage`: Grant execute permissions to the file and double-click to run; alternatively, run `chmod +x filename.AppImage` in the terminal to launch it.

## Unable to Launch

First, ensure the installer matches your system architecture. If the AppImage fails to launch and displays errors related to `FUSE` or `libfuse`, install the corresponding compatibility components according to your distribution's official documentation.

If it still fails to launch, please include your distribution, desktop environment, device architecture, installer name, and the full error message in your feedback.

## Next Steps

Once you see the Cherry Studio main interface, proceed to complete the Quick Start.
