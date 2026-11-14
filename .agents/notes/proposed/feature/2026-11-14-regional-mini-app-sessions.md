# Agent Note: Regional MiniApp session ownership

Status: proposed

English | [中文](2026-11-14-regional-mini-app-sessions.zh.md)

## Problem

Website MiniApps share the default session and have no per-app country profile. Regional sessions need a contract for host authorization, stored sign-in data, and global proxy transitions. Proxy changes can leave existing connections on the previous route.

## Proposal

Add optional country profiles for website MiniApps. This proposal is awaiting upstream review. The feature remains disabled by default and requires developer mode.

Each website MiniApp can select one country. Persistent partitions are keyed by MiniApp ID and country. Compatibility for earlier experimental builds preserves their partition names and stored login data.

A preparation lease binds a managed host window, an existing website MiniApp, and its selected country. Attachment requires a current lease. Releasing the last lease removes runtime registrations and closes regional guests. Revocation preserves persistent login data. Local packaged MiniApps retain their separate sandbox and network policy.

An explicit reset closes guests and blocks preparation until storage, workers, HTTP cache, and code cache are cleared. Deleting a custom website MiniApp clears its regional data before removing the row. Reset never clears the shared default website session.

Regional sessions inherit the global proxy. During reconciliation, requests wait behind a bounded gate. Successful configuration and connection closure reopen that gate. Configuration errors reject waiting requests. Explicit direct mode and user bypass rules remain valid. The feature does not select an IP country or promise anonymity. Existing response bytes cannot be recalled.

## Alternatives considered

- Automatically delete data on disable: rejected because users must retain their login state when switching profiles.
- Use one partition for each proxy: rejected because two MiniApps can require separate accounts on the same route.
- Query an external IP service on every proxy change: rejected because availability of that service must not control all website access.

## Acceptance criteria

- AC1 — Two website MiniApps can retain different countries, and existing experimental selections retain their cookies (verification: unit, renderer, Electron)
- AC2 — Unmanaged hosts, another host window, revoked leases, and local packaged MiniApps cannot attach regional sessions (verification: unit, Electron)
- AC3 — Closing or disabling a regional MiniApp releases runtime registrations while preserving login data (verification: unit, Electron)
- AC4 — Reset and deletion block attachment and clear all regional data while preserving default data (verification: unit, renderer, Electron)
- AC5 — Proxy transitions hold requests until configuration and connection closure succeed. Configuration errors block requests (verification: unit, Electron)
- AC6 — Proxy changes preserve the local MiniApp deny-all policy and honor explicit direct and bypass settings (verification: unit, Electron)
- AC7 — Changed-file tests, type checks, formatting, lint, translations, and documentation checks pass (verification: docs gate, unit, renderer)

## Risks

Closing connections interrupts streams and WebSockets. Websites must reconnect according to their normal behavior. A request that started before the transition can already have reached the old route. System PAC rules and explicit bypass rules can select direct access. Session cleanup removes Chromium data through supported APIs instead of deleting live partition directories.

System proxy configuration follows the existing one-minute refresh. Changes inside a PAC script or a remote proxy node can escape configuration comparison. The feature does not promise immediate detection of those changes.
