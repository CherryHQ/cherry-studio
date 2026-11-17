# Agent Note: Claude Code acceptEdits leaves Bash approval to the SDK

Status: implemented

English | [中文](2026-11-16-claude-accept-edits-bash-approval.zh.md)

## Problem

In `acceptEdits`, the Claude Code `canUseTool` resolver auto-approved any Bash call whose first word was `mkdir`, `touch`, `mv`, or `cp`. The SDK only invokes `canUseTool` after its own rules decide a call needs a user decision, so this check turned SDK escalations into silent approvals: `mkdir x && rm -rf ~` ran without a prompt. The Pi runtime's `acceptEdits` rule auto-approves only edit-class tools, so its shell calls always prompt.

## Decision

Cherry's tool policy does not pre-approve Bash in `acceptEdits`. The SDK owns auto-approval of its filesystem commands in that mode: it parses compound commands, confines paths to the working directory and additional directories, and checks symlinks and protected paths before the callback. A Bash call that reaches `canUseTool` stays on the approval path. The policy snapshot's `resolve()` takes no tool input, so no approval decision depends on the command text.

## Alternatives considered

- Splitting the command on `&&`, `;`, and `|` and checking each segment duplicates the SDK's parser with weaker path, symlink, and substitution handling.
- Applying the destructive-command detector would still auto-approve unlisted harmful forms; that detector is a usability prompt, not a boundary.

## Consequences

Commands the SDK auto-approves in `acceptEdits` never reach the callback, so they still run without a prompt. Commands the SDK escalates now always prompt or, without a responder, follow the existing headless denial.

## Verification

- Regression — `src/main/ai/runtime/claudeCode/__tests__/settingsBuilder.test.ts`: with the real policy snapshot in `acceptEdits`, `mkdir x && rm -rf ~` waits for approval instead of being allowed; the test fails on the first-word resolver.
- Regression — a local probe drove the SDK 0.3.311 CLI in `acceptEdits` through the native fixture: `mkdir sub` ran without invoking `canUseTool`, while `mkdir y && rm -rf ../outside` invoked it and the outside directory survived the denial.
