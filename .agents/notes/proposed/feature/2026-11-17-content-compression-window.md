# Agent Note: Content Compression Window

Status: proposed

English | [中文](2026-11-17-content-compression-window.zh.md)

## Problem

Chat context is all-or-nothing. `maxMessages` (`applyMaxMessagesWindow`, `src/main/data/services/MessageService.ts:130`) keeps the last N messages and drops everything older. When it is set, `PersistentChatContextProvider` serves that raw window and skips compaction entirely (`src/main/ai/streamManager/context/PersistentChatContextProvider.ts:958-962`). Budget compaction runs only when `maxMessages` is unset, and fires only when the estimate crosses `compress.thresholdPercent` of the input budget (default 80%). Users who want older rounds kept as context must either send every round verbatim, which is costly for long or reasoning-heavy conversations, or lose them. Issue #19711 asks for a middle tier between these two.

## Proposal

Add a persistent Chat setting `compressWindow` (round count B, or unset = off). It is a global preference with a per-assistant override, following the existing `chat.context_settings` layering.

When `compressWindow` is set, it replaces `maxMessages` as the served-history limit for that request. Counting in conversation rounds (a user message plus the assistant turn that answers it), with A = `maxMessages`:

1. Rounds 1..A are sent verbatim.
2. Rounds A+1..B are replaced by one compressed block produced by the resolved compression model (`compress.modelId`, falling back to the request model), using the existing summarizer path (`summarizeModelMessages`).
3. Rounds older than B are not sent, and `read_file` / `fs_read` access to them is revoked, as `retainedForWindow` already does for `maxMessages`.

Validation: B must be greater than A. A configuration with B ≤ A, or with `compressWindow` set and `maxMessages` unset, is rejected in the settings UI with an explicit message. At request time it is treated as off and the existing `maxMessages` behavior applies.

Compression failure is explicit. If the compression model is unavailable or summarization fails, the request is sent with the A-round window only and the failure is logged. The request is never sent with rounds silently missing from the compressed zone while presented as compressed.

Original message rows are not modified. Only the served context differs.

Open questions for approval: whether compressed-zone summaries are cached durably per boundary or recomputed per request; and whether the Settings UI ships in the same layer as the backend, or in a later layer.

## Alternatives considered

- Keep `maxMessages` and tune `thresholdPercent`: this cannot express "summarize the middle, drop the rest" and does not address the issue's cost case, because compaction only fires near the budget.
- Local rule-based extraction for the compressed zone: cheaper but lower quality; the issue's preferred strategy is the compression model, so this is deferred.
- Truncating tool outputs only: this reduces tool-result size but does not bound the number of rounds.
- Compression window alongside a hard `maxMessages` cap: this keeps two competing limits and makes the B zone ambiguous; the chosen design lets B define the window.

## Acceptance criteria

- AC1 — With `maxMessages` = A and `compressWindow` = B > A, the request contains the last A rounds verbatim, one compressed block for rounds A+1..B, and no content from rounds older than B. (verification: unit)
- AC2 — `compressWindow` unset, or B ≤ A, or `compressWindow` set without `maxMessages`, leaves the existing `maxMessages` behavior unchanged and the settings UI rejects the invalid configuration. (verification: unit)
- AC3 — When the compression model is unavailable or summarization fails, the request is sent with the A-round window only and no compressed block is presented as successful. (verification: unit)
- AC4 — Rounds older than B have their `read_file` / `fs_read` access revoked, and attachments within the served window remain accessible. (verification: unit)
- AC5 — Original message rows are unchanged after a request with a compression window, verified against real SQLite. (verification: unit)
- AC6 — The settings UI exposes the compression-window toggle and round input with the validation message from AC2. (verification: renderer)

## Risks

Summarizing B−A rounds on each request adds latency and cost unless the summary is cached; the caching decision is open above. Summary quality depends on the chosen compression model, and summaries are lossy even when every round is represented. The compressed zone's summarizer requests can themselves overflow; they inherit the summarizer budgets. Related: `proposed/bug-fix/2026-11-13-chat-context-overflow.md` owns overflow recovery and summarizer budgets; this Spec consumes that summarizer and does not change its recovery semantics.
