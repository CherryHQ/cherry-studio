# Agent Note: Recover chat context overflow

Status: proposed

English | [中文](2026-11-13-chat-context-overflow.zh.md)

## Problem

Persistent Chat estimates its context before a request and compacts at the configured threshold. Provider token accounting, tool schemas, media, and tool results can make the actual input exceed the limit even when that estimate fits. The AI SDK's normal retry does not change the input and a context-limit HTTP 400 is not normally retryable. Cherry's loop error hook does not currently implement retry.

The summarizer is also a model request. Its current budget uses an estimate, stubs large tool results, and, if necessary, drops middle messages with an omission marker. Its first message and instruction can still exceed the budget. If the summarizer fails, Chat serves the previous context and the model request may fail too.

## Proposal

Keep the existing proactive compaction and its user settings. For an enabled persistent Chat, recognize an actual context-limit rejection from provider status and structured error details, with provider-compatible message patterns when necessary. A generic HTTP 400, authentication, quota, tool, cancellation, or unrelated error must retain its existing outcome. Preserve the original provider error when recovery cannot proceed.

On a recognized overflow, compact the model-facing history for the failed model request and retry that request with the smaller context. Recovery must occur before any output of that request is committed and must not replay completed tool calls, prior output, or an entire turn. Preserve tool-call/result pairing, system instructions, the current user input, cancellation, and existing retry and fallback behavior. Bound recovery attempts and stop if compaction makes no progress. Respect disabled compaction and the existing exclusions for temporary chats and caller-owned or Agent sessions.

For summarization, use the compressor model's own input and output budgets. Process oversized history in ordered, bounded chunks and roll the resulting summaries forward; when an estimate is wrong and the compressor rejects a chunk for context overflow, reduce the chunk and retry within a bounded limit. Split an individually oversized text input where feasible. Do not publish a completed summary that silently excludes input merely to fit: where a non-text item, instruction, or minimum chunk cannot fit safely, fail explicitly and retain the prior context. Existing intentional attachment and tool-result reduction must remain identifiable as such. Empty or failed summaries do not advance the persistent boundary or masquerade as successful compaction.

Keep original conversation records unchanged; only a successfully completed durable summary may update its existing boundary. In-loop compaction remains scoped to the active request. Observability must distinguish attempted, successful, skipped, and failed compaction without claiming a successful recovery prematurely.

## Alternatives considered

- Retry the entire Chat turn after a 400: this can repeat already executed tools and duplicate visible output.
- Retry every HTTP 400 or resend the same input: this misclassifies unrelated failures or repeats a request that cannot fit.
- Drop older history until the summary request fits: this can produce an incomplete summary while advancing the durable boundary.

## Acceptance criteria

- AC1 — An underestimated persistent Chat request rejected with a recognized context-limit HTTP 400 compacts and retries the failed model request, then continues with the compressed context. (verification: AI SDK runtime integration — implementation owner)
- AC2 — A tool-loop overflow preserves prior visible output and completed tool results without executing a completed tool twice; recovery is bounded and cancellation stops it. (verification: AI SDK runtime integration — implementation owner)
- AC3 — Unrelated 400 errors, authentication and quota failures, disabled compression, and unsupported Chat scopes do not trigger overflow recovery; an unrecoverable failure preserves the original error. (verification: AI SDK runtime integration — implementation owner)
- AC4 — Summarization processes multi-chunk history in order, handles an underestimated chunk through bounded reduction, and does not silently omit covered messages; an unfit minimum chunk or failed summary leaves the persistent boundary unchanged. (verification: ai-core and real SQLite Chat context — implementation owner)
- AC5 — Compaction lifecycle reports and retained history distinguish success from failure or no-op, including after reopening the conversation. (verification: Main consumers and real SQLite — implementation owner)

## Risks

Provider error formats vary, and an imprecise match can trigger an unsafe retry or miss a real overflow. Multimodal payloads and tool schemas can dominate the limit outside the history that can be compacted. Multiple summary calls add latency and cost, and summaries are inherently lossy even when every chunk is represented. A minimum viable prompt may not fit a configured compressor, so recovery cannot guarantee success or uninterrupted operation.
