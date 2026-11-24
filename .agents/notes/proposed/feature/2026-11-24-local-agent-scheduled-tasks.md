# Agent Note: Scheduled tasks for local agents

Status: proposed

English | [中文](2026-11-24-local-agent-scheduled-tasks.zh.md)

## Problem

The scheduled-task selector and creation service reject every local Agent. The runtime already passes an unattended flag to the selected driver, but the native connection does not use it.

## Proposal

Enable configured local agents in the existing scheduler and run history. Codex uses a read-only sandbox and disables native integrations. The Claude SDK receives only read tools with ambient settings and MCP disabled. The host passes through the configured provider endpoint, model, and credentials. The ACP host limits file reads to the workspace and denies writes, terminals, approvals, and elicitation. Connections rebuild when switching between interactive and unattended execution. Reuse the existing database fields.

Suspend active schedules in the same transaction as a local enablement change. Preserve individually paused schedules and apply the existing missed-run rules when an owner becomes available again. A partial ACP reply remains in the conversation when an output or request limit fails the run. Busy sessions yield a skipped run with no result notification. Existing scheduled notifications recover run identity from their deduplication key.

## Alternatives considered

Using a second CLI runner would duplicate session, cancellation, and result handling. Inheriting interactive permissions would let a saved session setting expand the scope of a recurring task.

## Acceptance criteria

- AC1 — Enabled local agents can own scheduled tasks. Disabled agents are rejected. (verification: service and renderer; owner: implementation)
- AC2 — Every local protocol starts and resumes unattended turns without replaying saved interactive permissions. Host-mediated requests requiring interaction settle without a prompt. (verification: protocol fixture; owner: implementation)
- AC3 — A scheduled execution records its reply in the task conversation. Cancellation and execution errors settle and remain visible in run history. (verification: Electron and service; owner: implementation)

## Risks

The local CLI must be available and authenticated when the task fires. ACP agents may execute tools inside their own CLI process. Their native permission settings apply to those tools.
