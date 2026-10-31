---
icon: download
---

# Download and installation

Always use the [mobile option on the official download page](https://cherryai.com/download?platform=mobile). Do not install packages from unknown sources.

## Android

Install Cherry Studio from [Google Play](https://play.google.com/store/apps/details?id=com.cherryai.cherrystudio_app) for store-managed updates.

1. In the Android column of the mobile download page, scan the QR code or select the **Google Play** button.
2. Select **Install** in Google Play.

### Alternative: APK

If you cannot use Google Play, switch the Android column on the download page to **APK**. The international site downloads APKs from GitHub; the [China site](https://cherryai.com.cn/download?platform=mobile) defaults to APK downloads from GitCode. The current APK is provided for ARM64 devices.

1. Switch the Android column on the download page to **APK**, then scan the QR code or select the download button.
2. Open the APK from your browser downloads or file manager.
3. If Android blocks the installer, follow the system prompt to temporarily allow your browser or file manager to install unknown apps.
4. Return to the installer and finish installation.

You can revoke the “install unknown apps” permission after installation. When a new version is released, download the new APK from the official page and install it over the existing app. Review the release notes before upgrading.

## iPhone and iPad

Install Cherry Studio from the [App Store](https://apps.apple.com/us/app/cherry-studio-ai-anywhere/id6809783714). The international site links to the US storefront; the China site links to the [China mainland storefront](https://apps.apple.com/cn/app/cherry-studio-%E5%85%A8%E8%83%BD-ai-%E5%B7%A5%E4%BD%9C%E7%AB%99/id6809783714). Requires iOS or iPadOS 17.0 or later.

1. In the iPhone / iPad column of the mobile download page, scan the QR code or select the **App Store** button.
2. Select **Get** in the App Store and finish installation.

### Alternative: TestFlight beta

To try beta builds, switch the iPhone / iPad column on the download page to **TestFlight**.

1. Install Apple **TestFlight** from the App Store.
2. Switch the iPhone / iPad column on the mobile download page to **TestFlight**, then scan the QR code or select the button to open the invitation.
3. Accept the invitation in TestFlight and select **Install**.

Test capacity and build expiration are managed by Apple’s beta system. If the invitation is temporarily unavailable, try again later or follow the official release channels.

## Updates and version differences

These guides describe 0.3.0. Check your installed version in **Settings → About**. Google Play, App Store, APK, and TestFlight availability depends on each channel's publication schedule and may differ.

For APK installations, follow app update notices or the official download page; use the relevant store for store installations. Compatible code and resource updates can download in the background and apply on a later launch. Native capability changes still require a new App package: an older package cannot gain 0.3.0 health support through code updates alone.

Create a [full backup](backup-and-restore.md) before upgrading or changing devices. Restoring a backup differs from updating in place; do not uninstall the app just to update it.

## After installation

Continue with the [quick start](quick-start.md) to add a model service and send your first message.
