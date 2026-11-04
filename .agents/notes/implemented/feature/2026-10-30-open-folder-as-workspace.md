# Agent Note: Open a folder as an Agent workspace

Status: implemented

English | [中文](2026-10-30-open-folder-as-workspace.zh.md)

## Problem

Opening Cherry Studio with a folder did not register or select it as an Agent workspace. Agents entry could resume a remembered session, while workspace controls required a session.

## Decision

An absolute directory operand, a directory file URL, or `cherrystudio://open?path=…` registers an Agent workspace or reuses its existing identity and name. Main opens `/app/agents?workspaceId=<id>`. The landing fetches the workspace by id and checks the existing visible-workspace list, then shows its name, path, and selected state through `AgentChat`'s session-independent `centerSurface`, across session-list layouts and with the sidebar hidden. Existing session, prepared-intent, and agent identities retain precedence; bare Agents entry still resolves the recent session.

Opening the folder creates no session, starts no conversation runtime, and executes nothing. The workspace becomes the default when the user explicitly starts a new task or picks an agent. Selecting a session replaces the landing identity. A missing, deleted, invisible, or unavailable workspace settles into normal empty Agents UI without a modal, renderer error, or recent-session activation. Superseded asynchronous work cannot activate a session; work awaiting workspace resolution stops before session creation. Rejected launch input still opens the app normally.

Windows installers write the Explorer folder verb `Directory\shell\CherryStudio` under `Software\Classes` in HKCU for per-user installation or HKLM for per-machine installation, and remove it on uninstall. This is not a default association. Windows 11 may put it under Show more options; top-level menu placement is not guaranteed. Portable builds get no verb.

Linux packaging adds `inode/directory` to the packaged desktop file, making Cherry Studio an Open With candidate. The AppImage runtime helper is deliberately unchanged; automatic discovery from an unintegrated AppImage is not claimed.

macOS supports argv entry with `open -b com.kangfenmao.CherryStudio --args <path>` and the `cherrystudio://open?path=…` deep link. There is no `public.folder` declaration, Services integration, or Quick Action. Hot `open --args` on a running instance is not a promised transport.

## Alternatives considered

- Creating an empty session on folder open violates the session-free contract and could start a runtime before user action.
- Highlighting only a workspace group hides the selection in other layouts or with the sidebar closed; the existing center slot covers those cases.
- Default folder associations, macOS folder declarations or Services, and AppImage runtime integration broaden the platform contract beyond this feature.
- Replacing lexical workspace identity with realpath changes existing registration semantics. Quiet rejection instead handles input whose normalization changes filesystem identity.

## Consequences

Existing workspace storage, visibility, and DataApi contracts suffice; no schema, endpoint, store, or preference is added. Visibility checking requires the existing list read alongside the by-id read. Explicit user-workspace creation defaults still win; the selected landing workspace replaces a generic system-workspace default. A session-create request already issued before navigation cannot be undone by the renderer, but its late completion cannot replace the landing. Installer and desktop metadata need platform testing to establish actual file-manager behavior.

## Verification

Windows and Linux machines are still needed for installation, upgrade/uninstall, Explorer menu placement, desktop entry discovery, and actual folder launches. Real Electron GUI observation and screenshots remain unverified in this delivery.

- Regression — `src/main/services/protocol/__tests__/launchInput.test.ts`: run on macOS in slice A; covers operand selection, file URLs, protocol precedence, and argument boundaries.
- Regression — `src/main/services/protocol/handlers/__tests__/openWorkspace.test.ts`: run on macOS in slice A with real filesystem and SQLite fixtures; covers workspace reuse, validation, normalization identity, and absence of session rows.
- Regression — `src/main/services/protocol/__tests__/ProtocolService.test.ts`: run on macOS in slice A; covers launch/deep-link delivery, readiness, renderer loss, FIFO requests, and malformed input.
- Regression — `src/main/data/services/__tests__/AgentWorkspaceService.test.ts`: run on macOS in both slices; covers registration and path identity, with the existing singleton assertion restored in slice B.
- Regression — `src/renderer/pages/agents/__tests__/routeSearch.test.ts`: run on macOS in slice B; covers workspace retention and existing identity precedence.
- Regression — `src/renderer/routes/app/__tests__/conversation-entry.test.ts`: run on macOS in slice B; covers workspace-only bypass and unchanged bare or agent-scoped resolution.
- Regression — `src/renderer/pages/agents/__tests__/AgentPage.test.tsx`: run on macOS in slice B; covers visible name/path across layouts, quiet empty fallback, session selection, explicit workspace defaults, and suppression of session creation and stale activation.
- Regression — `scripts/__tests__/folder-opening-packaging.test.ts`: run on macOS in slice A as static inspection of NSIS ownership, hive selection, quoting, uninstall hooks, and desktop MIME configuration; it does not verify installer or desktop runtime behavior.
