# Agent Note: Preserve tool approval decisions after runtime results

Status: implemented

English | [中文](2026-11-07-tool-denial-projection.zh.md)

## Problem

Regression MP-51 denied a Pi file write and confirmed that no file was created, but the completed tool card showed a generic error instead of the user's rejection. The runtime emitted an error result after the host had resolved the approval. That later SDK snapshot retained the approval identifier but lost its decision, replacing the denied state in both the live projection and the final message.

## Decision

Apply the host's recorded approval decision to subsequent snapshots of that tool. Native root-message projections can omit approval metadata entirely, so the root projection also retains the real host approval identifier and restores decisions from persisted parts when reconnecting. A refusal remains `output-denied`; an allowed call retains its execution result, including real errors. Pending allowed calls still advance to `approval-responded` immediately.

## Alternatives considered

- Inferring denial from error text would confuse runtime failures with explicit user decisions.
- Patching the card label would leave the persisted message and other consumers inconsistent.
- Dropping runtime errors globally would hide legitimate failures after permission was granted.

## Consequences

The stream execution and native root projection retain the decision at their respective message boundaries; no new storage format or approval flow is introduced. The user's refusal remains visible after the tool finishes, while allowed calls can still report failures. Tool execution and permission enforcement are unchanged.

## Verification

- Regression — `src/main/ai/streamManager/__tests__/AiStreamManager.test.ts`: a real UI message stream receives a request, host decision and later runtime error. Both final persistence input and the subscribed projection preserve the refusal; the allowed variant preserves the execution error. The refusal case failed before the fix.
- Regression — all 165 tests in the affected stream manager test file passed.

- Regression — `AgentSessionRuntimeService.projection.test.ts` drives the registry response, native result, SQLite persistence and reloaded projection. Denial survives missing native approval metadata, while an allowed call retains its real execution error; both cases failed before the root-projection fix.
