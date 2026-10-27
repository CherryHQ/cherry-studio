# Agent Note: Agent tools can rename Sessions

Status: implemented

English | [中文](2026-10-26-agent-session-rename.zh.md)

## Problem

Agents could name a new Session but could not change an existing Session's title through Cherry's tools. The Session data service already supports explicit renames and protects them from automatic naming.

## Decision

Expose `session_rename` on `cherry-tools` with a required `title` and optional `session_id`. Omitting the ID selects the trusted current Session. An explicit ID can select another Agent's Session. Names are trimmed and limited to 1–255 characters; missing or trashed targets fail.

The tool uses the existing interactive Session authorization gate and is auto-approved by the shared runtime policy. It delegates to `AgentSessionService.update`, preserving manual-name protection and read-model notifications without starting another turn.

## Alternatives considered

- Add a Session action to `config`: rejected because that tool manages the Agent identity and channels, while Session tools own Session operations.
- Restrict renames to the current Agent: rejected because the requested capability includes explicitly selected Sessions across Agents, within the existing interactive user authorization boundary.
- Write the name directly to SQLite: rejected because it bypasses manual-name protection and read-model notifications.

## Consequences

Both runtime adapters consume the shared approval policy. The operation requires an interactive responder, including when renaming the current Session. Target selection is not restricted by Agent ownership; the caller must still own its trusted current Session. No database migration or new IPC endpoint is required.

## Verification

- Regression — `pnpm test:main src/main/ai/mcp/servers/__tests__/cherrySessionRename.integration.test.ts`: verifies persisted current, same-Agent, and cross-Agent renames, input validation, manual-name protection, and rejection of invalid callers, missing or trashed targets, and non-interactive calls.
- Regression — `pnpm test:main src/main/ai/toolApproval/__tests__/builtinToolPolicy.test.ts`: verifies automatic approval is scoped to a mounted `cherry-tools` server.
