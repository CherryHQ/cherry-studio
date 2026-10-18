# Agent Note: Permission modes for interactive Agent delegation

Status: implemented

English | [中文](2026-10-18-agent-delegation-approval.zh.md)

## Problem

`session_create` and `session_send` required approval on every call, even in Smart Approval or Full Access. The same exception also prevented unattended delegation, so removing it wholesale would enable additional delegation hops.

## Decision

The central builtin-tool policy classifies these two tools as `delegation`. Claude hooks and permission callbacks, and Pi's native and nested Code Mode authorization, share the same decision: deny headless turns or unavailable responders; otherwise allow `auto` and `bypassPermissions`, and ask in other modes.

Tool disabling and existing safety denials take precedence. The execution-layer authorization and target visibility checks remain in place. Permission-mode changes retain the existing next-turn boundary.

## Alternatives considered

- A separate message setting or directed Agent-pair allowlist would introduce another authorization configuration; this repair reuses the existing permission modes.
- Allowing unattended multi-hop delegation would require explicit delegation authorization, trusted ancestry, cycle/depth checks, and budgets; it remains outside this change.

## Consequences

Existing Agents in Smart Approval or Full Access now send interactive delegation requests without an approval prompt, including the first request. Users who want per-call approval must choose a mode that asks. No stored setting, migration, public tool parameter, or target Agent permission is added or changed.

The [runtime reference](../../../../docs/references/ai/agent-session-runtime.md) documents the permission and single-hop boundaries. This addresses the repeated-prompt portion of [#21927](https://github.com/CherryHQ/cherry-studio/issues/21927), without implementing its independent message setting or pair authorization.

## Verification

- Regression — `guardRules.test.ts`, `settingsBuilder.test.ts`, and `approvalExtension.test.ts`: automatic modes allow interactive delegation, other modes ask, and disabled or unattended calls stay blocked.
- Regression — `PiRuntimeConnection.test.ts`, `piNativeTools.test.ts`, `piVcc.test.ts`, `agentTools.test.ts`, and `cherryAutonomyTools.test.ts`: runtime wiring, nested authorization, mode updates, and execution boundaries.
- Regression — Windows Electron with a local simulated provider: both runtimes send without approval in automatic modes; default mode waits for Allow; creating a target Session and returning its completion succeed. This does not establish production-provider or native macOS/Linux coverage.
