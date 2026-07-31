# App Update Architecture

## Overview

Current Cherry Studio clients check for updates through the managed release service at `https://releases.cherryai.com.cn`. The client selects an update channel and sends application, client, platform, and region metadata.

## Update Feed Configuration

- Packaged builds use `publish.url` from `electron-builder.yml`. electron-builder writes this value to the packaged `app-update.yml`.
- Development builds set `forceDevUpdateConfig = true`, so electron-updater reads `dev-app-update.yml` from the repository root. The default development feed is `http://127.0.0.1:3378`.
- Production base URL changes take effect through the build configuration in newly produced application builds.

## Channels

The client requests one of these electron-updater channels:

- `latest`: stable release channel.
- `rc`: release candidate channel.
- `beta`: beta release channel.

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

The selected electron-updater channel determines whether the client requests the `latest`, `rc`, or `beta` manifest.
