# Agent Note: Agent session steer freeze, replay gaps, and stale resume recovery

Status: implemented

English | [中文](2026-11-04-agent-steer-replay-stale-resume.zh.md)

## Problem

Long agent sessions (Claude Code runtime) froze when the replay ring overflowed: `reasoning-delta` / `tool-input-delta` arrived without their `*-start` openers, `attach: replay has gaps due to buffer overflow` was logged, and the live view stalled with no error card (issue #23421). Using Steer mid-turn made the freeze visible. Restarting left `Error occurred` rows, and the next send failed with `No conversation found with session ID`, so the session could not continue. Shutdown also timed out (`AgentSessionRuntimeService stop timed out`) while `closeQuery` / subprocess exit / pending connects overran the 5s budget.

## Decision

- Attach replay repair lives in Main's `AiStreamManager.attach` via `buildCompactReplay`, scoped per execution. It synthesizes a missing `tool-input-start` for orphan `tool-input-delta` / `tool-input-available` / `tool-output-*` / `tool-approval-request`, preserving surviving `toolName` / `dynamic` / metadata so static parts keep their `tool-<name>` identity instead of sticking at `unknown-tool`, with patch-once repair when `tool-input-available` lands later. This keeps raw `ai.stream.attach` replay parseable by the real `readUIMessageStream`; desktop views run no renderer-side repair.
- Renderer desktop views consume Main-owned message projections (`ai.projection.attach` → `MessageProjectionService` → `ExecutionStreamOverlayService` → `useExecutionOverlay`), rendering `CherryUIMessage` snapshots produced by Main's `pipeStreamLoop` accumulator. The overlay performs no chunk parsing and tracks no degraded turns; Main's tee-accumulated persistence stays authoritative.
- Shutdown bounds `closeAll` at 4s (both `onStop` and `onDestroy`), skips poisoning `failedClosures` on shutdown-budget timeouts, and bounds in-flight connects at 1.5s instead of dropping them.
- Stale resume clears the in-memory token, persisted `runtimeResumeToken` / `nativeSessionId` bindings scoped to the failed conversation, the matching in-flight `closingSessions.resumeToken`, and stale-token mappings in `failedClosureResumeTokens` while retaining `failedClosures` ownership for edit gating and archive retry. A branch-specific reset boundary on the failed branch head blocks ancestor fallback so that branch reconnects fresh while healthy siblings keep their identities. Matching lives in shared `staleResume.ts` and the driver projects `data-conversation-reset` before surfacing the error.
- Rapid steers accumulate (`[...prev, ...inputs]`) instead of overwriting the armed boundary.

## Alternatives considered

- Pin `*-start` openers in the ring (never evict): rejected because it evicts middle deltas and breaks text contiguity plus `replayFrom` guarantees; synthesis preserves the tail.
- Raise `maxBufferChunks` only: rejected because unbounded agent turns (new id per step/tool) outgrow any fixed ring.
- Manual retry after stale failure: rejected because every subsequent turn failed identically, leaving the session dead.

## Consequences

Raw replay of evicted prefixes now parses through the real `readUIMessageStream`; static tool parts keep their names when `tool-input-available` survives, and raw consumers only see a transient `unknown-tool` placeholder until the surviving name/dynamic patch lands. Desktop projection views render Main snapshots directly and need no reload to heal. Shutdown settles within the Lifecycle budget. A stale CLI-side conversation recovers on the next turn instead of failing forever.

## Verification

- Regression — `pnpm vitest run src/main/ai/streamManager/__tests__/buildCompactReplay.test.ts src/main/ai/streamManager/__tests__/AiStreamManager.test.ts`: orphan tool-start synthesis and patch-once behavior covered.
- Regression — `pnpm vitest run src/main/ai/runtime/claudeCode/__tests__/ClaudeCodeRuntimeDriver.test.ts`: stale-token projects `data-conversation-reset`; `tool_use` duplicate does not.
- Regression — `pnpm vitest run src/main/ai/runtime/__tests__/staleResume.test.ts`: SDK wording, wrapped `errors`/`cause`, plain payloads, negatives.
- Regression — `pnpm vitest run src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.pause.test.ts src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.subagentWake.test.ts`: shutdown, stale clearing, steer paths.
- `pnpm typecheck:web`, `pnpm typecheck:node`, `oxlint`, `oxfmt --check` clean.
