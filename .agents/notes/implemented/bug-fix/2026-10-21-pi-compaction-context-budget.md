# Agent Note: Pi compaction context budgets

Status: implemented

English | [中文](2026-10-21-pi-compaction-context-budget.zh.md)

## Problem

Pi's character-based history estimate can undercount multilingual text and tool output on small custom contexts. Its stock retained tail can leave a compaction request too large. Catalog output limits equal to the context can also consume almost all conversation space. Desktop Pi now uses a host summarizer, so patching the SDK's native summary function would not protect that request.

## Decision

Cherry caps the catalog-derived output reservation at one quarter of the context. Small contexts compact earlier and retain a smaller tail; contexts of at least 100,000 tokens retain the stock 20,000-token tail. Gateway bindings supply these settings for each model. Behavior child sessions may override their parent's numerical compaction settings, while the adapter keeps ownership of the summarizer.

The desktop host summarizer bounds input and output on small contexts. Large-context summaries keep their full input. Each admitted summary makes at most one model request. Overflow, unsuccessful responses and cancellation fail without retry, preserving the behavior adapter's request cap. The existing gateway route and credentials remain unchanged. Successful response usage is returned for summary accounting; the gateway remains the sole writer of provider billing.

Input fitting reserves the complete instructions and independently preserves the beginning and end of the conversation and previous summary. It measures the final JSON length, including escaping, rather than slicing assembled JSON or interpreting delimiters in untrusted text. If instructions and minimum history cannot fit, it fails before making another request. Empty or unsuccessful responses never create a compaction checkpoint.

## Alternatives considered

- Reserving the entire advertised output limit can leave no useful conversation budget.
- Truncating all large-context prompts upfront discards history the provider can accept.
- Retaining a patch to an unused SDK summarizer would leave desktop requests unprotected after the host migration.
- Retrying inside a single metered host summary would bypass the behavior adapter's child request cap, so the old SDK retry patch is not carried into this path.
- Slicing the assembled prompt can discard original task anchors, latest progress or full instructions.
- Inheriting a large parent's token budgets can overflow a child using a smaller model.

## Consequences

The bound is a conservative character heuristic, not exact tokenization. Input fitting can omit middle history. Failures remain visible and do not clear the conversation; a provider can still reject the bounded request. The desktop behavior host is also shared by Pi Durable, so its summary requests receive the same bounds; Durable's own context thresholds remain unchanged. This change does not alter the SDK's standalone native branch-summary behavior.

## Verification

- Regression — `piCompactionRecovery.test.ts` uses native scripted Pi model calls to cover small/large contexts, source anchors, JSON escaping, full instructions, usage, explicit/silent overflow, empty/unsuccessful responses and cancellation.
- `PiRuntimeConnection.test.ts` exercises real desktop manual compaction: one model call per summary and no invalid checkpoint on overflow.
- `gatewayModelBinding.test.ts` checks root/child model-specific settings alongside real loopback gateway routing.
- `packages/agent-runtime-pi/tests/behaviorRuntime.test.ts` checks child budget overrides at actual native session construction.
