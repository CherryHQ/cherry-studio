# Agent Note: Regional MiniApp session ownership

Status: proposed

English | [中文](2026-11-14-regional-mini-app-sessions.zh.md)

## Problem

Website MiniApps share the default session and have no per-app country profile. Regional sessions need a contract for host authorization, stored sign-in data, and global proxy transitions. Proxy changes can leave existing connections on the previous route.

## Proposal

Add optional country profiles for website MiniApps. This proposal is awaiting upstream review. The feature remains disabled by default and requires developer mode.

Each website MiniApp can select one country. A persistent partition uses the country and a fixed-length SHA-256 digest of the MiniApp ID in its original case. Windows that use the same MiniApp and country share that partition. IDs that differ only by case use separate partitions.

Country selections from earlier experimental builds carry over. The new partitions start with fresh storage, so users may need to sign in again. An explicit reset or deletion can clear a legacy case-folded partition only if no other saved website MiniApp shares its legacy name.

A preparation lease binds a managed host window, an existing website MiniApp, and its selected country. Attachment requires a current lease. Releasing the last lease removes runtime registrations and closes regional guests. Revocation preserves persistent login data. Local packaged MiniApps retain their separate sandbox and network policy.

An explicit reset closes guests and blocks preparation. It clears web storage, worker registrations, HTTP and code caches, and cached HTTP credentials. It checks for remaining IndexedDB files before it allows preparation again. A failed or interrupted reset keeps preparation blocked across restarts until a reset succeeds. Deleting a custom website MiniApp clears its regional data before removing the row. The shared default session and other MiniApps keep their data.

Regional sessions inherit the global proxy. During a change, the gate holds requests that Electron intercepts for the session, within its time and queue limits. The gate reopens when the configuration applies and pooled connections close. Configuration errors reject waiting requests. Explicit direct mode and user bypass rules remain valid. The global proxy and its routing rules determine the public IP.

## Alternatives considered

- Automatically delete data on disable: rejected because users must retain their login state when switching profiles.
- Use one partition for each proxy: rejected because two MiniApps can require separate accounts on the same route.
- Query an external IP service on every proxy change: rejected because availability of that service must not control all website access.

## Acceptance criteria

- AC1 — Two website MiniApps can use different countries. Earlier experimental choices carry over. IDs that differ only by case use different partitions (verification: unit, renderer, Electron)
- AC2 — Unmanaged hosts, another host window, revoked leases, and local packaged MiniApps cannot attach regional sessions (verification: unit, Electron)
- AC3 — Closing or disabling a regional MiniApp releases runtime registrations while preserving login data (verification: unit, Electron)
- AC4 — Reset and deletion block attachment and clear regional data through session APIs. The default session and other MiniApps keep their data. A failed cleanup stays blocked across restarts (verification: unit, renderer, Electron)
- AC5 — Proxy transitions hold intercepted requests until configuration and pooled connection closure succeed. A configuration error blocks those requests (verification: unit, Electron)
- AC6 — Proxy changes preserve the local MiniApp deny-all policy and honor explicit direct and bypass settings (verification: unit, Electron)
- AC7 — Changed-file tests, type checks, formatting, lint, translations, and documentation checks pass (verification: docs gate, unit, renderer)

## Risks

Closing pooled connections can interrupt streams. WebSocket handshakes from workers with no associated frame bypass the gate. Already-upgraded WebSockets can stay on the previous route. A request that started before the change may already have reached the old route. System PAC rules and explicit bypass rules can select direct access. Reset uses Electron session APIs to clear data and preserves live partition directories.

A SharedWorker starts with the selected region's `navigator.language`. If another client keeps the worker alive after the original client closes, its `Intl` locale and time zone can change.

System proxy configuration follows the existing one-minute refresh. Changes inside a PAC script or a remote proxy node can escape configuration comparison. The feature does not promise immediate detection of those changes.
