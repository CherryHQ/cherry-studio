# Agent Note: Response identity and context reading freshness

Status: implemented

English | [中文](2026-11-09-agent-response-identity-context-reading.zh.md)

## Problem

Gemini responses omit the gateway's response identity. Native clients therefore cannot connect a completed provider charge to its product message, although the charge itself is retained.

Claude stream deltas fall back to the configured model after an unknown response model invalidates the context reading. They can confirm input usage against the wrong capacity. Failed context reads return unknown without updating observers, leaving existing and late subscribers with stale confirmed data.

## Decision

Gemini's terminal SSE frame and complete JSON response expose the adapter's existing billing identity as the standard [responseId](https://ai.google.dev/api/generate-content#GenerateContentResponse). Main continues to associate usage from evidenced native identity; it does not infer the current reply.

Claude deltas use the saved active stream model. Context reads publish valid confirmed and unknown outcomes through one path. Model/context epochs fence reads across reset, model changes and shutdown. A separate read generation also prevents an earlier read's late success or failure from overwriting a newer read in the same epoch. It is a freshness comparison, not another pending queue. This preserves the existing [passive context contract](../../proposed/architecture/2026-10-30-agent-context-usage.md).

## Alternatives considered

- Guess usage ownership from the active reply: a late root or child response can charge the wrong message.
- Reuse configured capacity after an unknown stream model: the input count and window can refer to different models.
- Return unknown only to the caller: existing observers and future snapshots retain stale confirmation.
- Fence reads only by model epoch: two concurrent reads in the same epoch can still complete out of order.

## Consequences

Gemini adds existing protocol metadata without another ID map or migration. Claude can display unknown context when the active model's window is unavailable or a valid read fails. Superseded reads return `context-changed` without publishing. Observation remains passive and starts no model request or subprocess.

## Verification

- Regression — `AiSdkToGeminiSse.test.ts`: terminal SSE and complete JSON retain the billing response ID for empty and non-empty output.
- Regression — `gatewayIntegration.test.ts`: the production gateway, installed Google clients and migrated SQLite database associate distinct response IDs with separate root/child message owners, in both response forms, without duplicate charges.
- Regression — `contextUsage.test.ts` with the real SDK transport: an unknown active model stays unknown through output-only deltas; valid read failure and unknown window reach current and late observers; late failed reads cannot overwrite a newer model epoch or read.
- Regression — `runtime.test.ts -t 'does not spawn a CLI for context reads'`: the real Claude CLI reports context after a controlled native turn; reading context starts neither an extra process nor another provider request.

The targeted Google client identity checks and four Claude wire cases fail on the previous implementation. Controlled transport and provider fixtures do not constitute a real provider outage or a claim that every desktop model-switch path is supported.
