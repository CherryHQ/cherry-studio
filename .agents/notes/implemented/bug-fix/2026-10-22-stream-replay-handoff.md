# Agent Note: Stream replay and live delivery handoff

Status: implemented

English | [中文](2026-10-22-stream-replay-handoff.zh.md)

## Problem

`TopicStreamSubscription` installs IPC listeners before requesting `ai.stream.attach`. A window may already receive live chunks through the listener registered by stream open. Attach returns a compact replay containing the same chunks. Feeding both into `readUIMessageStream` creates duplicate text parts; persistence can still contain one correct copy, so refresh hides the defect.

Replay compaction and live coalescing have different chunk boundaries. Comparing text or chunk counts cannot reliably identify overlap. A pending coalesced delta can also cross the replay boundary unless Main flushes it during attach.

## Decision

`AiStreamManager` numbers source chunks within each execution attempt. A coalesced payload carries the last covered `sequence`, and attach returns `replayThrough[attemptId]` alongside replay. It flushes the previous `WebContentsListener` before replacing it, preserving output for other consumers in the same window and keeping each live payload on one side of the cutoff.

The renderer queues live chunks and terminal events while attach is pending. Attach also reports `replayFrom[attemptId]`, preserving a merged payload's first source sequence even after ring eviction or splitting. If queued live delivery covers the entire retained replay interval, the renderer consumes that live sequence once instead of replay; otherwise it applies replay before consuming live chunks beyond the cutoff. Seeing any live data alone is not enough to skip replay. Late covered IPC deliveries are rejected.

Terminal attach responses and rejected attach requests drain queued output before settling branches. A queued native terminal takes precedence over the attach fallback, so completion is reported once. A turn completed before any reader attaches settles directly from its queued events; disposal clears the queue.

This metadata belongs to Cherry's ephemeral stream transport. It does not change harness interfaces, native sessions, or message persistence. See [Stream Manager](../../../../docs/references/ai/stream-manager.md) and [Execution Overlay](../../../../docs/references/ai/execution-overlay.md) for the current contract.

## Alternatives considered

- Text-based deduplication loses legitimate repeated output.
- Ignoring all replay after seeing any live data loses the prefix when attaching mid-stream.
- Deduplicating by raw chunk count fails when replay compaction and live coalescing group different source chunks.

## Consequences

Initial overlay consumption waits for attach to resolve. Pending events temporarily occupy renderer memory; subsequent streaming retains the existing coalescing behavior. Sequence values restart per attempt, and the cutoff map uses `attemptId` so parallel executions and later turns remain independent. The existing bounded replay buffer can still lose older history on overflow; this repair does not make replay a durable log.

## Verification

- Regression — `TopicStreamSubscription.test.ts`: live/replay overlap before registration, during attach, and after replay; late attachment; identical new deltas; terminal events during attach.
- Regression — `AiStreamManager.test.ts`: replay cutoffs and pending-delta flush across repeated attachment preserve existing consumers' output.
- Regression — `TopicStreamSubscription.test.ts`: terminal attach responses and request rejection preserve queued answer text; live coverage of truncated replay retains the evicted prefix without duplicating the suffix, using the real SDK reader.
- Regression — `AiStreamManager.test.ts`: retained replay coverage starts at the original source sequence after merging and at the surviving source sequence after split-delta eviction.
- Regression — focused Main and Renderer suites also cover compaction, listener coalescing, pause, execution overlay, continuation, and transport consumers.
- Regression — local Electron with native Pi and a local HTTP/SSE fixture: two natural fast-response rounds and one delayed-attach round have overlapping delivery but one live text part, one rendered body, and one persisted text part; refreshing the held stream adds no model request.
