# Agent Note: Estimate chat context from the outgoing request

Status: implemented

English | [中文](2026-11-28-chat-context-request-footprint.zh.md)

## Problem

Persistent Chat reuses the preceding response's token usage as a context estimate. A supplier can report cumulative usage for multiple internal inferences in one response. Replayed history can also differ from the previous prompt after a model change, branch switch, history fold, or tool-result transformation. The input meter can show an inflated count, and automatic compaction can trigger too soon.

## Decision

Persistent Chat estimates context from the content selected for the outgoing request. Durable compaction estimates the history selected for replay, including the effective summary. Before each model call, the runtime estimates the assembled candidate prompt, including system instructions and active tool definitions where available, and checks it against the model's input budget after reserving output. A successful fold is followed by an estimate of the reduced candidate. These paths reuse the message footprint estimator and preserve the existing compaction boundaries, exclusions and overflow recovery.

The Chat composer shows an estimate for the active conversation path and model. A read-only preview estimates the selected replay and assistant prompt. Its key follows the selected path, model, and available prompt inputs. If the inputs cannot be resolved, leave occupancy unknown.

The provider usage and cost ledger remains authoritative for consumption. Compaction and display derive their counts from request content. Existing message data remains readable.

## Alternatives considered

- Discard usage whenever a server-executed tool returns a result. This covers the observed inflation but cannot establish which content a later request will include.
- Recover the count from the provider's final internal inference. This can describe that inference but cannot account for changes in the next replay.
- Ask the provider to count every draft and tool step. This adds network latency and is unavailable for some adapters.

## Consequences

The composer estimates the replay and assistant prompt available before dispatch. Draft content and request-time additions can change the final input. Local counts approximate provider framing, media encoding, and hidden server-side inputs. Overflow recovery handles discrepancies, while the in-loop counter reuses stable message counts and leaves media payloads undecoded.

## Verification

- AC1 — `PersistentChatContextProvider.compaction.test.ts`, `inLoopCompaction.test.ts`, and `middleware.test.ts` verify that replay and compaction decisions are independent of prior cumulative usage.
- AC2 — `inLoopCompaction.test.ts` verifies that growing tool results trigger compaction under the same reported usage and that successful compaction reports a lower estimate.
- AC3 — `ChatContent.test.tsx` verifies the model switch and stale history behavior. Electron with a loopback provider shows 19 and 836 tokens for the respective conversation paths and restores each estimate when switching between them.
- AC4 — `usage.test.ts` verifies that aggregated server-tool usage retains the cache breakdown. Electron persists 640,208 tokens for each of two loopback responses.
