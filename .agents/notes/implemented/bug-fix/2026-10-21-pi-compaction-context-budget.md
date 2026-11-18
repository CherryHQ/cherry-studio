# Agent Note: Pi compaction context budgets

Status: implemented

English | [中文](2026-10-21-pi-compaction-context-budget.zh.md)

## Problem

Pi's character-based history estimate can undercount multilingual text and tool output on small custom contexts. Its stock retained tail can leave a compaction request too large. Catalog output limits equal to the context can also consume almost all conversation space. Desktop Pi generates summaries through native model requests, so the protection must preserve native request metering and usage ownership.

## Decision

Cherry caps the catalog-derived output reservation at one quarter of the context. Small contexts compact earlier and retain a smaller tail; contexts of at least 100,000 tokens retain the stock 20,000-token tail. Gateway bindings supply these settings for each model. Behavior child sessions may override their parent's numerical compaction settings, while the Pi adapter keeps ownership of summary execution.

For behavior-backed Pi sessions below 100,000 tokens, a native compaction extension bounds summary input and output. It combines the prepared history and turn prefix and calls the session's current native stream, preserving request metering, session identity and usage ownership. Each admitted small-context summary makes at most one model request. Overflow, unsuccessful responses and cancellation fail without retry or native-summary fallback. Large contexts retain native Pi summaries, which may make separate history and turn-prefix requests; each is metered. The gateway route and credentials remain unchanged, successful usage is returned for summary accounting, and the gateway remains the sole writer of provider billing.

Input fitting reserves the complete instructions and independently preserves the beginning and end of the combined conversation and previous summary. It measures the final JSON length, including escaping, rather than slicing assembled JSON or interpreting delimiters in untrusted text. If instructions and minimum history cannot fit, it fails before making a model request. Empty or unsuccessful responses never create a compaction checkpoint.

## Alternatives considered

- Reserving the entire advertised output limit can leave no useful conversation budget.
- Truncating all large-context prompts upfront discards history the provider can accept.
- Adapting the removed host summarizer hook would not protect the current native summary path.
- Retrying a summary or falling back after a failed bounded request would issue an additional request; small-context compaction instead cancels without creating a checkpoint.
- Slicing the assembled prompt can discard original task anchors, latest progress or full instructions.
- Inheriting a large parent's token budgets can overflow a child using a smaller model.

## Consequences

The bound is a conservative character heuristic, not exact tokenization. Input fitting can omit middle history. Failures remain visible and do not clear the conversation; a provider can still reject the bounded request. Pi Durable uses its own native compaction path and does not receive these bounds. This change does not alter the standalone native-session API or native branch-summary behavior.

## Verification

- Regression — `packages/agent-runtime-pi/tests/compactionSummary.test.ts` uses native scripted model calls to check bounded input/output, source anchors, JSON escaping, complete instructions, usage, overflow, empty/unsuccessful responses and cancellation.
- `PiRuntimeConnection.test.ts` exercises the desktop manual compaction path and instruction forwarding; small-context summary failures must not write an invalid checkpoint.
- `packages/agent-runtime-pi/tests/sessionEvents.test.ts` distinguishes cancellation that prevents native-summary fallback after a failure from a user abort, and clears the saved failure so later events do not inherit it.
- `gatewayModelBinding.test.ts` checks root/child model-specific settings alongside real loopback gateway routing.
- `piCompactionRecovery.test.ts` checks model-specific thresholds; `piCompactionBudget.test.ts` checks that output estimates ignore assistant usage from before the compaction summary.
- `packages/agent-runtime-pi/tests/behaviorRuntime.test.ts` checks child budget overrides and bounded native summary execution with the behavior adapter. The [desktop Pi runbook](../../../../src/main/ai/runtime/pi/README.md#manual-small-context-pi-check) describes separate live-provider acceptance; automated regressions do not establish that it has passed.
