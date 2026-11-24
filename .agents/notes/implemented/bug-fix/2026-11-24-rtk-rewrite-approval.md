# Agent Note: Require approval for RTK Ask rewrites

Status: implemented

English | [中文](2026-11-24-rtk-rewrite-approval.zh.md)

## Problem

Cherry treated RTK exit `3` as successful output and applied the rewrite before obtaining approval. RTK uses that exit code when the host needs to ask, including the default verdict in versions that report it as Ask. [Issue #25227](https://github.com/CherryHQ/cherry-studio/issues/25227)

## Decision

Carry the approval requirement with the rewritten command. Claude Code requests permission in `PreToolUse` and supplies the rewrite through `canUseTool` after approval. Pi and Pi Durable pass the same requirement to the shared approval gate. Full Access still requires a decision for this rewrite.

## Alternatives considered

- Automatically applying exit `3` would override the RTK Ask verdict.
- Keeping the original command on every exit `3` would discard a rewrite the existing approval flow can present to the user.

## Consequences

The user sees the proposed command before approving it. RTK emits the Ask diagnostic at debug level. Exit `0` continues to offer a rewrite without an RTK approval requirement. Exit `1` continues to pass through silently and exit `2` continues to discard the rewrite and warn.

## Verification

- Regression — `src/main/utils/__tests__/rtk.test.ts`: mocked process results cover exit codes `0`–`3`, including empty and unchanged stdout for Ask and its debug log level.
- Regression — `src/main/ai/runtime/claudeCode/__tests__/settingsBuilder.test.ts` and `src/main/ai/runtime/pi/piApprovalFacts.test.ts`: rewrites reach per-call approval under Auto and Full Access, and the approval request carries the proposed command.
