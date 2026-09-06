---
description: How clients check for updates through the managed release service, with channels and the release history feed
sources:
  - src/main/services/AppUpdaterService.ts
  - resources/cherry-studio/release-history.json
  - electron-builder.yml
  - electron-builder.cn.config.cjs
  - dev-app-update.yml
  - package.json
---

# App Update Architecture

## Overview

Cherry Studio clients check for updates through the managed release service at `https://releases.cherry-ai.com`. The client selects an edition-specific update channel and sends application, edition, client, platform, and region metadata. The release service owns target-version selection, regional mirrors, rollout policy, and required upgrade gateways.

The in-app release history follows the same managed path. Stable release preparation updates `resources/cherry-studio/release-history.json`, the release workflow publishes that generated file as a release asset, and clients fetch `/release-history.json` through the managed release service. The service selects GitHub or GitCode according to the request region. Each build also bundles the file as an offline fallback.

## Update Feed Configuration

- Packaged builds use `publish.url` from `electron-builder.yml`. electron-builder writes this value to the packaged `app-update.yml`.
- Packaged metadata sets `cherryEdition: global` for global packages and `cherryEdition: cn` for China edition packages. Packages built before edition metadata was introduced may omit the marker; the client treats a missing marker as `global` for compatibility.
- Development builds set `forceDevUpdateConfig = true`, so electron-updater reads `dev-app-update.yml` from the repository root. The default development feed is `http://127.0.0.1:3378`.
- `CHERRY_EDITION` selects the main-process and renderer edition during development. Use `pnpm dev:cn` for China edition development, or run `pnpm build:cn` followed by `pnpm start:cn` to preview a China renderer build; matching the build and start commands keeps both processes on the same edition.
- `global` and `cn` are the only supported explicit edition values. For any other `cherryEdition` or development `CHERRY_EDITION` value, the application logs the configuration error and exits during startup instead of falling back to another edition.
- Production base URL changes take effect through the build configuration in newly produced application builds. The client does not override the packaged feed URL at runtime.

## Channels

The global and China editions use separate electron-updater channels:

- `latest` / `latest-cn`: stable release channels.
- `rc` / `rc-cn`: release candidate channels.
- `beta` / `beta-cn`: beta release channels.

When the test plan is disabled, the client selects its edition's stable channel. When it is enabled, the client uses the edition-specific RC or Beta channel selected in settings. Edition comes from packaged metadata and is independent of `X-Region`, so changing network region cannot move an installation between product update channels.

## Request Contract

Before each update check, the client preserves existing updater headers and sets these values:

| Header | Value |
| --- | --- |
| `Client-Id` | Persistent client identifier |
| `App-Name` | Application name |
| `App-Version` | Installed version with a `v` prefix |
| `OS` | `process.platform` value |
| `X-Edition` | `cn` for the China package, otherwise `global` |
| `X-Region` | `cn` for China, otherwise `global` |
| `User-Agent` | Generated Cherry Studio user agent |
| `Cache-Control` | `no-cache` |

The selected electron-updater channel determines which edition-specific manifest the client requests; no separate release-channel header is sent.

## Check Lifecycle

Manual checks are available in development and packaged, non-portable builds. Portable builds do not perform update checks. Packaged, non-portable builds also schedule automatic checks in the main process. Successful checks return to the normal cadence, while failed scheduled checks use exponential backoff before retrying. Update events and download progress continue to reach the main window through IpcApi.

A managed-feed HTTP 503 with the structured code `manifest_missing` keeps the normal four-hour schedule (with ±15% jitter), reducing repeated requests while a release manifest is unavailable. The check remains an error, and manual retry remains available; manual checks show the existing unpublished-update explanation instead of a generic error. Other failures, including `edition_mismatch` and 404 responses, retain their existing handling. Automatic discovery after the feed is repaired may take up to 4.6 hours; this does not repair release-service routing or rollout configuration.
