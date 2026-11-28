# Agent Note: stream_options include_usage fallback for incompatible hosts

Status: implemented

English | [中文](2026-11-04-stream-options-include-usage-fallback.zh.md)

## Problem

Custom OpenAI-compatible chat endpoints may reject `stream_options.include_usage` with `400 Unknown parameter`, failing the whole request in normal chat and in Pi agent turns routed through the internal gateway (#23368, same signature as #11652). The per-provider `streamOptions` toggle exists for `openai-compatible` paths, but the Pi gateway injection never consulted it, and neither path recovered automatically.

## Decision

Pi's gateway binding maps the Chat Completions dialect's `streamOptions` value to `compat.supportsUsageInStreaming`. An endpoint that explicitly disables stream usage omits `stream_options` from the first request, including when the OpenAI SDK would otherwise send it.

For Chat and trusted desktop gateway calls, model retry observes the serialized request. On a 400 explicitly rejecting a `stream_options` field that was sent, it retries once without the top-level field. The repair participates in the model attempt budget and can run before any content is emitted. Public Gateway calls follow their own retry policy.

## Alternatives considered

- Manual toggle only: leaves Pi agents broken and forces every affected user to discover the provider API option.
- Changing the custom-provider default to `false`: avoids the 400 but silently drops usage telemetry for hosts that support it.
- Persisting `streamOptions: false` after a successful retry: avoids one 400 per stream but mutates user config silently; deferred in favor of stateless retry plus upfront omission only when explicitly disabled.

## Consequences

Providers that support the field retain usage reporting. A compatible response after omitting the field may lack streaming token usage. The omission applies to one model call and use of the field resumes on the next call unless the dialect explicitly disables it.

## Verification

- Regression — `src/main/ai/runtime/pi/gatewayIntegration.test.ts` covers both Chat SDK adapters, one-time recovery for Pi work, subsequent call isolation, and public Gateway error propagation.
- Regression — `src/main/ai/provider/__tests__/config.test.ts` covers upfront omission when the endpoint disables stream usage.
- Regression — `src/main/ai/runtime/pi/gatewayModelBinding.test.ts` covers stream usage compatibility for Chat Completions and other Pi protocols.
