# Agent Note: Defer oversized Claude child archives during restore

Status: implemented

English | [中文](2026-11-26-claude-child-archive-deferral.zh.md)

## Problem

Eager restore read all accumulated subagent transcripts and retained their normalized history in the Electron main process. Inline images made those histories large enough to drive the main-process heap into multiple gigabytes. The reported session had about 534 MB across 54 child transcripts with 1,758 inline images. The app exited with `0xE0000008` on every restart. [Issue #25038](https://github.com/CherryHQ/cherry-studio/issues/25038)

## Decision

Root restore admits up to 24 MiB per child and 32 MiB across all eagerly loaded children. A targeted refresh reads only the requested child, with a 64 MiB budget. The worker checks transcript size before reading the body and charges admitted history at the larger of its on-disk size and the total serialized size of its messages and reconciliation entries. [Archive reader and budgets](../../../../packages/agent-runtime-claude-code/src/archive.ts)

Deferral is atomic for each child. The worker validates the whole child before sending any of its entries or messages. If a budget is exceeded or an individual serialized record exceeds the 16 MiB transfer limit, the worker sends a deferred marker and any available sidecar metadata for that child. Root history and eligible siblings still restore. The runtime logs one summary warning per thread per owner lifetime when that thread's refresh defers history. [Archive worker](../../../../packages/agent-runtime-claude-code/src/archiveWorker.mjs) · [Archive owner](../../../../packages/agent-runtime-claude-code/src/owner.ts)

## Alternatives considered

- Rely on byte-bounded transfer frames alone. Each frame is small, but the main process still accumulates all admitted messages.
- Read a prefix of an oversized child. A partial transcript can omit retractions or other reconciliation evidence, so the worker defers the whole child.

## Consequences

A deferred child keeps its persisted rows and native transcript. Calling `archive()` on that child's handle can hydrate it if the transcript fits the targeted budget and record limit. The desktop child panel reads with `archive({ refresh: false })` and does not request a targeted refresh. Reopening a deferred child currently shows only its saved rows. [Desktop runtime driver](../../../../src/main/ai/runtime/claudeCode/ClaudeCodeRuntimeDriver.ts)

The child budgets limit the history admitted by a root restore. The root transcript continues through the existing worker transfer and copy path. [Archive-transfer note](2026-11-14-claude-archive-transfer.md)

## Verification

- Regression — `pnpm test:agent-runtime-claude-code packages/agent-runtime-claude-code/tests` passed 135 tests, including eager budgets, targeted refresh, atomic deferral for an oversized record, and warning deduplication.
- Regression — `pnpm test:main src/main/ai/agentSession/__tests__/ChildThreadProjection.test.ts src/main/ai/runtime/claudeCode/__tests__/desktopRuntime.integration.test.ts` passed 80 tests, covering saved rows during deferral, diagnostic clearance after recovery, and desktop runtime integration.
- Regression — `pnpm test:main src/main/ai/agentSession/__tests__/ChildThreadProjection.test.ts src/main/ai/runtime/claudeCode/__tests__/ClaudeCodeRuntimeDriver.test.ts` passed 72 tests, including the child projection and native fork suite.
- Regression — The 534 MB-class fixture grew the main heap by about 527.6 MB at `HEAD` and 29.7 MB with the fix, with 51 of 54 children deferred and root history intact. The 1.9 GB fixture retained about 1.91 GB at `HEAD` and 154 KB with the fix. Windows packaged-app startup was outside the verification scope.
