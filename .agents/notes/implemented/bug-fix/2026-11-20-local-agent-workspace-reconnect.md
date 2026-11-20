# Agent Note: Reconnect local Agents after an empty session changes workspace

Status: implemented

English | [中文](2026-11-20-local-agent-workspace-reconnect.zh.md)

## Problem

Opening an empty session prewarms its CLI before the first message. Selecting another workspace updates the session and UI but previously left the prewarmed connection in its original directory. ACP, Codex and Claude local connections all reused this stale cwd; a connection completing after the workspace change had the same problem.

## Decision

Include the local working directory in the host's connection target and retain the directory associated with the current native connection. Check it before reuse, after awaited reconciliation and when a connect finishes. A mismatch closes the old connection and retries against the current workspace. Discard the old directory's prewarm resume token rather than restoring its native session. Do not inherit a closing entry's token across directories.

Keep this policy in AgentSessionRuntimeService rather than adding three protocol-specific invalidation paths. The workspace API still prohibits changes after any non-root message; unchanged directories keep normal connection reuse. Other runtime types are unchanged.

## Alternatives considered

- Rewrite prompt context: conceals the mismatch while processes and tools still use the old directory.
- Invalidate only on a workspace-change event: misses connects and reconciliations already in flight.
- Resume the old native session with a new cwd: protocol implementations may retain old context even when the new process starts in the desired directory.

## Consequences

Changing an empty local session's directory can start another CLI process and native session on its next use. The unused old native session may remain in the CLI's own history. No authentication, model configuration, workspace contents or existing conversation history is rewritten.

## Verification

- Regression — `AgentSessionRuntimeService.workspace.test.ts`, real migrated SQLite plus the local protocol process fixture: warmed ACP/Codex A-to-B switches, in-flight connect switches, a switch during awaited reconciliation, original native session non-resumption, unchanged-directory reuse, and rejection of workspace edits after messages.
- Without the implementation, five regression cases fail on the fixture's actual process cwd; with it, all six pass.
- Real macOS Qwen, Codex and Claude initialization in isolated test sessions: new process cwd equals B; Qwen/Codex old processes exit and native IDs change; Codex thread/read also reports B. Re-priming the same directory reuses the connection. No model turn or Downloads access was needed.
