# Agent Note: Require approval for RTK Ask rewrites

Status: implemented

English | [中文](2026-11-26-rtk-rewrite-approval.zh.md)

## Problem

`rtkRewrite()` treated RTK exit code `3` as an unconditional success while logging a per-command warning. Under RTK's exit-code protocol, exit `3` (`Ask` verdict) means the rewrite requires user approval rather than auto-applying. [Issue #25227](https://github.com/CherryHQ/cherry-studio/issues/25227)

## Decision

Return `{ command, approvalRequired }` from `rtkRewrite()` so exit `0` keeps `approvalRequired: false` and exit `3` sets `approvalRequired: true` at `debug` log level. In Claude Code, `PreToolUse` returns `permissionDecision: 'ask'` together with `updatedInput` so native Claude Code deny rules still evaluate the rewritten command, and `canUseTool` holds per-call approval across modes (including `auto` and `bypassPermissions`). Pi and Pi Durable forward `approvalRequired` and `nonBypassable` into the shared approval gate.

## Alternatives considered

- Auto-applying exit `3` at a lower log level would silently execute commands that RTK classified as needing approval.
- Dropping exit `3` rewrites would throw away valid rewrites instead of presenting them through the existing approval flow.
- Substituting the rewritten command only inside `canUseTool` would bypass Claude Code's native project deny check on the rewritten command.

## Consequences

The user sees and approves the rewritten command before execution across interactive modes, while unattended turns reject Ask rewrites. Exit `0` continues to auto-apply, exit `1` stays silent, and exit `2` discards stdout and logs a warning.

## Verification

- Regression — `src/main/utils/__tests__/rtk.test.ts`: covers exit codes `0`–`3`, blank/unchanged exit `3` output, and `debug` vs `warn` logging.
- Regression — `src/main/ai/runtime/claudeCode/__tests__/settingsBuilder.test.ts` and `src/main/ai/runtime/pi/piApprovalFacts.test.ts`: covers `PreToolUse` `permissionDecision: 'ask'` + `updatedInput`, per-call approval under `auto` and `bypassPermissions`, and unattended denial.
