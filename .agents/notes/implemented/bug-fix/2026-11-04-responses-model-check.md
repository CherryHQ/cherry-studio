# Agent Note: Stream Responses model checks to a complete terminal result

Status: implemented

English | [中文](2026-11-04-responses-model-check.zh.md)

## Problem

The text branch of `AiService.checkModel()` sends a non-streaming request. A compatible endpoint that serves OpenAI Responses only with `stream: true` therefore fails the settings check even when ordinary streamed conversations work, as reported in [Issue #22784](https://github.com/CherryHQ/cherry-studio/issues/22784).

Receiving a stream or its first text chunk does not prove that the model check succeeded: an endpoint can fail or disconnect after partial output.

## Decision

Text checks use streaming when the model's resolved endpoint is `openai-responses`. Selection follows the effective model endpoint, including model overrides, rather than the provider's name. Other endpoint checks retain their existing transport.

The check consumes the stream to completion and requires a recognized terminal finish reason before returning latency. The normal reasons `stop`, `length`, `content-filter`, and `tool-calls` are accepted; `error`, `other`, or a missing finish reason fail the check. A stream error or abort also fails it, even if text has already arrived. Empty text is allowed after normal completion, preserving the previous check's contract. Latency measures the whole probe, not time to first token.

The existing request path retains the caller's API-key override, timeout and cancellation signals, and the prevention of sleep while work is active. Probe reasoning parameters are unchanged; the separate reasoning-parameter policy is outside this repair.

## Alternatives considered

- Keep non-streaming Responses checks: this preserves a false failure for endpoints that only accept streamed Responses requests.
- Stream every text endpoint: this changes unrelated provider behavior without evidence that those transports need repair.
- Try non-streaming first and retry with streaming: this adds a failed request and possible billing before a transport that the resolved endpoint already identifies.
- Accept the first output chunk: partial output would hide late failures and truncated streams.

## Consequences

Streaming-only Responses endpoints can pass the same check as other usable model routes. A slow or incomplete stream remains bounded by the existing timeout. This check verifies a complete small request; it does not establish long-conversation reliability or provider-specific capabilities beyond that request.

## Verification

- Regression — `pnpm test:main src/main/ai/__tests__/AiService.modelCheck.integration.test.ts`: 9 tests passed. The real SDK path covers a stream-only Responses endpoint, model endpoint selection, the selected API key, HTTP errors, failure after partial text, truncated streams, timeout, caller cancellation, and unchanged non-streaming Chat Completions checks. Before the repair, the stream-only endpoint rejected the probe with HTTP 400 (`stream must be true`).
- Regression — `pnpm test:renderer src/renderer/pages/settings/ProviderSettings/utils/__tests__/healthCheck.test.ts src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/useHealthCheck.test.tsx`: 26 tests passed for the health-check consumers.
- Regression — `pnpm typecheck:node` and `pnpm i18n:check` passed.

Live-provider acceptance and packaged-platform behavior have not been verified for this change.
