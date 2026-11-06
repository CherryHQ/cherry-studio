# Agent Note: Remote Desktop profile metadata synchronization

Status: proposed

English | [中文](2026-11-05-remote-desktop-profile.zh.md)

## Problem

When connecting to Desktop Cherry Studio from Mobile via Remote Access, users cannot distinguish multiple paired computers by their configured Desktop user profile:
1. During QR pairing, the mobile device records only the desktop machine hostname (`os.hostname()`) in `desktop_connection.name`.
2. Desktop stores the user's configured display name and avatar in local preferences (`app.user.name` and `app.user.avatar`), but `connection.authenticate`, `connection.refresh`, and `pairing.get` do not expose this metadata to authenticated mobile peers.
3. If a user customizes their profile name or avatar on Desktop or pairs multiple workstations sharing similar hostnames, Mobile continues displaying the static pairing-time hostname and a generic fallback icon.

## Proposal

Expose optional Desktop user profile metadata over authenticated Remote Access handshakes and pairing approvals:

### 1. Capability advertisement (`connection.hello`)
- `connection.hello` advertises `desktopProfileVersion: 1` so mobile clients can detect profile synchronization support.

### 2. Authenticated profile payload (`desktopProfileSchema`)
- `@cherrystudio/remote-protocol` defines `desktopProfileSchema` containing optional `name` (trimmed Unicode string, 1–256 chars) and optional `avatar` (Unicode string up to 65,536 chars supporting emoji glyphs or compact `data:image/...;base64,...` thumbnails).
- `connection.authenticate`, `connection.refresh`, and approved `pairing.get` responses include optional `desktopProfile`. Unauthenticated `connection.hello` responses and pending/rejected pairing polls omit profile data to prevent leaking user identity to unauthenticated network scanners.

### 3. Desktop profile resolution (`RemoteConnection.ts`)
- Desktop reads `app.user.name` and `app.user.avatar` from `PreferenceService`.
- When `app.user.avatar` references internal file storage (`file:<id>`), Desktop resolves the physical path via `FileManager` and encodes files within the 64 KiB wire budget as a base64 data URI; oversized or missing files are gracefully omitted without failing authentication.

## Alternatives considered

- Embedding profile avatar in the pairing QR code: Rejected. QR capacity is strictly bounded and cannot hold image data URIs, and static QR payloads would never reflect subsequent profile updates on Desktop.
- Returning profile metadata in unauthenticated `connection.hello`: Rejected. Any LAN peer able to reach the WebSocket port could scrape the desktop user's display name and avatar before authenticating.
- Creating a separate RPC query method for profile metadata: Rejected. Piggybacking on `connection.authenticate`, `connection.refresh`, and `pairing.get` synchronizes the profile atomically during connection establishment with zero extra round-trips.

## Acceptance criteria

- AC1 — `connection.hello` advertises `desktopProfileVersion: 1`, and `@cherrystudio/remote-protocol` validates `desktopProfileSchema` bounds on `connection.authenticate`, `connection.refresh`, and `pairing.get`. (verification: unit — remote-protocol test maintainers, `contracts.test.ts`)
- AC2 — Approved `pairing.get` and authenticated `connection.authenticate` / `connection.refresh` responses include the configured Desktop `name` and `avatar` without exposing profile metadata to unauthenticated callers. (verification: unit — remote-access test maintainers, `pairing.test.ts`)
- AC3 — Missing or oversized avatar files degrade gracefully by omitting `avatar` while preserving authentication and `name` delivery. (verification: unit — remote-access test maintainers, `pairing.test.ts`)

## Risks

- Oversized custom avatar files exceeding the 64 KiB JSON-RPC record limit: Mitigation: Desktop checks file byte length before encoding and omits avatars that would exceed the wire budget.
- Cross-computer profile leakage when switching active desktops on Mobile: Mitigation: Profile metadata is bound to each authenticated connection session and persisted per `connectionId`.
