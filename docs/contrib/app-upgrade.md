---
description: How clients check for updates through the managed release service, with channels and the release history feed
sources:
  - src/main/services/AppUpdaterService.ts
  - resources/cherry-studio/release-history.json
  - electron-builder.yml
  - dev-app-update.yml
---

# App Update Architecture

## Overview

Cherry Studio clients check for updates through the managed release service at `https://releases.cherry-ai.com`. The client selects an update channel and sends application, client, platform, and region metadata. The release service owns target-version selection, regional mirrors, rollout policy, and required upgrade gateways.

The in-app release history follows the same managed path. Stable release preparation updates `resources/cherry-studio/release-history.json`, the release workflow publishes that generated file as a release asset, and clients fetch `/release-history.json` through the managed release service. The service selects GitHub or GitCode according to the request region. Each build also bundles the file as an offline fallback.

## Update Feed Configuration

- Packaged builds use `publish.url` from `electron-builder.yml`. electron-builder writes this value to the packaged `app-update.yml`.
- Development builds set `forceDevUpdateConfig = true`, so electron-updater reads `dev-app-update.yml` from the repository root. The default development feed is `http://127.0.0.1:3378`.
- Production base URL changes take effect through the build configuration in newly produced application builds. The client does not override the packaged feed URL at runtime.

## Channels

The client requests one of these electron-updater channels:

- `latest`: stable release channel.
- `rc`: release candidate channel.
- `beta`: beta release channel.

When the test plan is disabled, the client selects `latest`. When it is enabled, the client uses the RC or Beta channel selected in settings. electron-updater requests the corresponding channel manifest from the managed feed.

## Request Contract

Before each update check, the client preserves existing updater headers and sets these values:

| Header | Value |
| --- | --- |
| `Client-Id` | Persistent client identifier |
| `App-Name` | Application name |
| `App-Version` | Installed version with a `v` prefix |
| `OS` | `process.platform` value |
| `X-Region` | `cn` for China, otherwise `global` |
| `User-Agent` | Generated Cherry Studio user agent |
| `Cache-Control` | `no-cache` |

The selected electron-updater channel determines whether the client requests the `latest`, `rc`, or `beta` manifest; no separate release-channel header is sent.

## Check Lifecycle

Manual checks are available in development and packaged, non-portable builds. Portable builds do not perform update checks. Packaged, non-portable builds also schedule automatic checks in the main process. Successful checks return to the normal cadence, while failed scheduled checks use exponential backoff before retrying. Update events and download progress continue to reach the main window through IpcApi.
