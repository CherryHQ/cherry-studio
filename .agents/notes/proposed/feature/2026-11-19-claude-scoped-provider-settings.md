# Agent Note: Claude scoped provider settings

Status: proposed

English | [中文](2026-11-19-claude-scoped-provider-settings.zh.md)

## Problem

Cherry-managed Claude Code provider settings in `~/.claude/settings.json` also affect plain `claude`, preventing users from independently using their own login.

## Proposal

Add an opt-in tool-wide mode for Claude Code only. The default remains off and uses the global `~/.claude/settings.json`. When enabled, managed provider settings move to a Cherry-owned 0600 file under the app data directory. Normal and own-login launches use `--settings <absolute path>`; login-flow launches never do. Missing or malformed scoped settings explicitly fail launch instead of falling back to the user's own login.

Enabling removes Cherry-managed keys from the global file. Disabling writes the active provider back globally and hard-deletes the scoped file. Both transitions preserve unrelated user keys and permission rules. Gateway reconciliation rewrites the scoped file while the mode is on.

## Alternatives considered

- Continue writing globally: plain Claude inherits the selected provider.
- Copy all global settings into the overlay: unrelated user settings gain higher precedence.

## Acceptance criteria

- AC1 — The mode defaults to off, retaining global settings (verification: `src/renderer/hooks/__tests__/useCodeCli.test.ts`)
- AC2 — Enabling with an active provider removes managed global keys, preserves unrelated keys and permissions, creates the scoped file with mode 0600 on POSIX, and commits the preference only on success (verification: `src/main/services/codeCli/__tests__/configWriter.test.ts`, `src/renderer/pages/code/cliConfig/__tests__/scopeTransition.test.ts`)
- AC3 — A scoped normal launch passes a quoted absolute settings path without credentials in argv (verification: `src/main/services/codeCli/__tests__/CodeCliService.test.ts`)
- AC4 — Disabling restores the active provider globally, preserves unrelated keys and permissions, and hard-deletes the scoped file (verification: `src/renderer/pages/code/cliConfig/__tests__/scopeTransition.test.ts`)
- AC5 — Own-login launches use scoped settings while enabled; login-flow launches omit `--settings` (verification: `src/main/services/codeCli/__tests__/CodeCliService.test.ts`, `src/renderer/pages/code/cliConfig/__tests__/scopeTransition.test.ts`)
- AC6 — Missing or malformed scoped settings explicitly fail launch (verification: `src/main/services/codeCli/__tests__/CodeCliService.test.ts`)
- AC7 — Gateway reconciliation rewrites only scoped settings while enabled, and drafts prepared for the other destination are rejected (same-destination stale contents are not detected) (verification: `src/renderer/pages/code/hooks/__tests__/useLaunchDialogController.test.ts`, `src/main/services/codeCli/__tests__/configWriter.test.ts`)
- AC8 — Documentation and translations satisfy their checks (verification: `pnpm docs:check-notes`, `pnpm i18n:check`)

## Risks

Transitions roll back caught failures on a best-effort basis; restore failures are logged rather than thrown, and transitions are not crash-atomic across files and preference. Scoped launches depend on the file. Enabling changes where Cherry stores provider configuration, so plain `claude` returns to the user's own login. Windows argument delivery, real authenticated provider routing, and plain-`claude` recovery after disable remain unverified.

- Cross-window: existing preference plumbing writes the whole configs object from the renderer, so an edit to another tool from a stale window can overwrite `claudeScopedSettings` too (pre-existing behavior). A duplicate transition from a stale window is a no-op and does not mutate the file again.
- A toggle before Claude reads settings at startup can change what that launch uses; the global file already has the same exposure window.
- The switch is tool-level and lives on the tool panel, outside provider dialogs, so it cannot be toggled while a provider modal editor is open.
