# Agent Note: Pi compaction context budgets

Status: implemented

English | [中文](2026-10-21-pi-compaction-context-budget.zh.md)

## Problem

Pi's character-based history estimate can undercount multilingual text and tool output on small custom contexts. Its stock retained tail can leave a compaction request too large. Catalog output limits equal to the context also make output reservation consume almost all conversation space, causing repeated compaction. Pi 1.0 normalizes system messages into the transcript, so assuming the first message contains the summary prompt bypasses input protection.

## Decision

Cherry caps the catalog-derived output reservation at one quarter of the context. Small contexts compact earlier and retain a smaller tail; contexts of at least 100,000 tokens retain the stock 20,000-token tail.

The version-pinned SDK patch finds the user summary message by role and reads either string or text-block content through Pi's text helper. It preserves the system message and caller routing. Small-context summaries have a bounded input and output budget. Large-context summaries keep their original input and output until Pi identifies an overflow. A retry halves the input budget, with at most four overflow attempts. The SDK's transient retry policy and cancellation checks remain in use. Persistent overflow fails instead of checkpointing an invalid summary.

Summary construction supplies conversation and previous-summary sections separately, without parsing delimiters in untrusted text. Input fitting reserves the complete instructions, then shares the remaining budget between sections while retaining each section's beginning and end. This also applies to turn-prefix and branch summaries. If the instructions and minimum section context cannot fit, summarization fails visibly before the request instead of silently dropping instructions or checkpointing lost task/progress anchors.

Pi's transient-error classifier excludes deterministic context-overflow errors, even when a provider wraps them in generic error text. This prevents transient retries from multiplying overflow attempts; genuine transient failures retain the configured retry budget and callbacks.

## Alternatives considered

- Reserving the entire advertised output limit can leave no useful conversation budget.
- Truncating all large-context prompts upfront discards history that the provider can accept.
- Retrying only error responses misses silent overflow and zero-output length stops recognized by Pi.
- Slicing the assembled update prompt can discard the original task in the previous summary and the latest progress in the new conversation simultaneously.

## Consequences

The bound is a conservative character heuristic, not exact tokenization. Overflow recovery can omit middle history while retaining the original request and latest work. Persistent failures remain visible and do not clear the user's conversation. SDK upgrades require re-deriving the version-pinned patch and rerunning its integration tests.

## Verification

- Regression — `src/main/ai/runtime/pi/piCompactionRecovery.test.ts`: output limits approaching or exceeding context leave room for another turn; update summaries preserve task/progress anchors and full instructions even with literal delimiters, on both small contexts and large-context overflow retries; history, turn-prefix and branch summaries are bounded; oversized instructions fail before a request; system-first string/block input, retry exhaustion, cancellation and unrelated errors preserve their contracts.
- Regression — `src/main/ai/runtime/pi/PiRuntimeConnection.test.ts`: runtime settings pass the model-specific compaction policy alongside trusted-workspace and tool settings.
