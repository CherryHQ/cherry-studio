# Agent Note: Estimate chat context from the outgoing request

Status: proposed

English | [中文](2026-11-28-chat-context-request-footprint.zh.md)

## Problem

Persistent Chat reuses the preceding response's token usage as a context estimate. A supplier can report cumulative usage for multiple internal inferences in one response. Replayed history can also differ from the previous prompt after a model change, branch switch, history fold, or tool-result transformation. The input meter can show an inflated count, and automatic compaction can trigger too soon.

## Proposal

Estimate context from the content selected for the outgoing request. Durable compaction estimates the history selected for replay, including the effective summary. Before each model call, the runtime estimates the assembled candidate prompt, including system instructions and active tool definitions where available, and checks it against the model's input budget after reserving output. A successful fold is followed by an estimate of the reduced candidate. Reuse the existing message footprint estimator and preserve the existing compaction boundaries, exclusions and overflow recovery.

The Chat composer shows an estimate for the active conversation path and model. Feed it a projection of the same request-side accounting. Invalidate stale results when the selected path, model, or prompt inputs change. A preview must not dispatch a model request, execute tools, or mutate conversation state. If the inputs cannot be resolved, leave occupancy unknown.

Keep the provider usage and cost ledger authoritative for consumption. Stop using legacy message context counts as compaction or display inputs. Existing message data remains readable.

## Alternatives considered

- Discard usage whenever a server-executed tool returns a result. This covers the observed inflation but cannot establish which content a later request will include.
- Recover the count from the provider's final internal inference. This can describe that inference but cannot account for changes in the next replay.
- Ask the provider to count every draft and tool step. This adds network latency and is unavailable for some adapters.

## Acceptance criteria

- AC1 — Identical outgoing content produces the same compaction decision when prior reported usage differs, both at turn start and between tool steps. (verification: Main integration tests)
- AC2 — An increase in the assembled input can trigger compaction even if reported usage is unchanged, and successful compaction reports the reduced input estimate. (verification: Main integration tests)
- AC3 — The composer displays an estimate tied to the active replay and model, and does not show an earlier replay's count after either changes. (verification: renderer tests and Electron)
- AC4 — Cumulative provider usage and its billing breakdown survive unchanged when the response includes server tool activity. (verification: Main usage tests)

## Risks

Local counts approximate provider framing, media encoding, and hidden server-side inputs. Keep overflow recovery for those differences. Keep counting bounded on long tool loops and avoid decoding media on the synchronous path.
