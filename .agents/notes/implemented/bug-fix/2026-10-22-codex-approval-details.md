# Agent Note: Codex approval details

Status: implemented

English | [中文](2026-10-22-codex-approval-details.zh.md)

## Problem

Codex App Server may send commands or file changes only in `item/started`. A subsequent approval request identifies that item without repeating its details. Replacing the tool input with the request hid the proposed action from the user.

## Decision

Retain command/file items by native item ID for the current connection and turn. Merge their details into approval input before the request's own fields and native decision options. Remove details on item completion and clear them before the next turn. Requests without a matching item keep their own parameters.

## Alternatives considered

- Use approval parameters alone: loses the action the user must review.
- Retain details across turns: risks displaying an old action when an item ID is reused.

## Consequences

No database, IPC or permission-policy changes are needed. Native approval decisions and their scope remain unchanged.

## Verification

- Regression — `src/main/ai/runtime/localAgent/__tests__/connections.test.ts`: command/file approvals retain operation details and native request fields, return the exact native decision and do not reuse details in a later turn; both new cases fail before the fix.
- Electron — Codex 0.162.1 shows the proposed file path/content, creates the exact approved file, leaves rejected/cancelled files absent and rejects a late approval after cancellation. Continuation succeeds.
