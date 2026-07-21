# App Update Architecture

## Overview

Current Cherry Studio clients check for updates through the managed release service at `https://releases.cherry-ai.com`. The client selects an update channel and sends application, client, platform, and region metadata. The release service selects the concrete version, rollout audience, regional mirror, required upgrade gateway, and manifest returned to electron-updater.

The client does not fetch `app-upgrade-config.json`, calculate upgrade paths, or construct GitHub or GitCode download URLs.

## Update Feed Configuration

- Packaged builds use `publish.url` from `electron-builder.yml`. electron-builder writes this value to the packaged `app-update.yml`.
- Development builds set `forceDevUpdateConfig = true`, so electron-updater reads `dev-app-update.yml` from the repository root. The default development feed is `http://127.0.0.1:3378`.
- `AppUpdater` does not call electron-updater's runtime feed-switching API. Changing the production base URL requires updating the build configuration and producing a new application build.

## Channels

The client requests one of these electron-updater channels:

- `latest`: stable releases only.
- `rc`: the highest visible RC or stable release selected by the release service.
- `beta`: the highest visible Beta, RC, or stable release selected by the release service.

A test channel represents the least stable build a user accepts. It does not permanently pin the user to a prerelease suffix.

## Request Contract

Before each update check, the client sets these request headers:

| Header | Value |
| --- | --- |
| `Client-Id` | Persistent client identifier |
| `App-Name` | Application name |
| `App-Version` | Installed version with a `v` prefix |
| `OS` | `process.platform` value |
| `X-Region` | `cn` for China, otherwise `global` |
| `User-Agent` | Generated Cherry Studio user agent |
| `Cache-Control` | `no-cache` |

The client does not send `X-Release-Channel`. The selected electron-updater channel determines whether it requests the `latest`, `rc`, or `beta` manifest.

## Update Check Flow

1. Use `latest` unless the test plan is enabled; a test plan uses the saved test channel and defaults to `rc` when none is saved.
2. Resolve the request region from IP geolocation.
3. Apply the request headers and electron-updater channel.
4. Call `checkForUpdates()`.
5. Let electron-updater process the manifest returned by the release service and download the referenced artifact when an update is available.

The release service is responsible for compatibility gates, staged rollout, target-version selection, and mirror selection. Release artifacts and manifests referenced by the service must remain reachable, but the client does not require them to be hosted by a specific provider.

## Error Handling

- Windows portable builds skip update checks.
- If the release service reports no available version, electron-updater follows its normal “update not available” path.
- A network or service error is logged and ends the current check. The next scheduled or manual check uses the same configured feed.
- IP lookup fallback behavior determines the region header; it does not change the update feed URL.

## Release Operations

- Configure versions, compatibility gates, rollout rules, and mirrors in the managed release service.
- Ensure every manifest returned by the service references an available release artifact.
- Use the local release service on port `3378` to exercise development update checks.
- Do not add client-side version-routing rules or runtime feed URLs for release-policy changes.

## Legacy Configuration

`app-upgrade-config.json` is retained only as a compatibility artifact for already-released clients. Current clients do not read it, and this repository no longer contains automation for updating it. Its schema, versions, and gateway examples must not be treated as the current release strategy. Retiring the legacy artifact requires a separate migration plan for clients that still depend on it.
