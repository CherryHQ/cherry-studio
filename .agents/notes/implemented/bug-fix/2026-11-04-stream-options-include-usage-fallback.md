# Agent Note: stream_options include_usage fallback for incompatible hosts

Status: implemented

English | [中文](2026-11-04-stream-options-include-usage-fallback.zh.md)

## Problem

Custom OpenAI-compatible chat endpoints may reject `stream_options.include_usage` with `400 Unknown parameter`, failing the whole request in normal chat and in Pi agent turns routed through the internal gateway (#23368, same signature as #11652). The per-provider `streamOptions` toggle exists for `openai-compatible` paths, but the Pi gateway injection never consulted it, and neither path recovered automatically.

## Decision

`buildPiModelConfig` maps `resolveEndpointDialect(provider, endpointType).streamOptions` to Pi `compat.supportsUsageInStreaming` for `openai-completions` only; Responses and other protocols never carry `stream_options`. Defaults stay `true` (`Absent ⇒ true`), preserving usage telemetry where supported.

Provider execution wraps the chat-completions fetch outermost in `resolveProviderAiSdkConfig`: an explicit `streamOptions: false` dialect strips `stream_options` upfront in one request; otherwise the first attempt keeps usage telemetry and a matching 400 retries once stripped. The retry matches only status 400 bodies mentioning `stream_options`/`include_usage` with an error signal, strips only the top-level field, and never loops. Non-chat endpoints are unwrapped.

## Alternatives considered

- Manual toggle only: leaves Pi agents broken and forces every affected user to discover the provider API option.
- Changing the custom-provider default to `false`: avoids the 400 but silently drops usage telemetry for hosts that support it.
- Persisting `streamOptions: false` after a successful retry: avoids one 400 per stream but mutates user config silently; deferred in favor of stateless retry plus upfront omission only when explicitly disabled.

## Consequences

Hosts that support `stream_options` keep usage reporting on the first attempt. Incompatible hosts succeed after one stripped retry, or in one request when explicitly disabled. `openai`-family chat paths that send the field unconditionally are covered by the same wrappers. Message-less or non-400 rejections still surface without retry.

## Verification

- Regression — `src/main/ai/provider/__tests__/streamOptionsFallback.test.ts`: matching 400 retries once stripped; unrelated 400s, missing field, and non-400s pass through; upfront omission strips in one call.
- Regression — `src/main/ai/provider/__tests__/config.test.ts`: DashScope keeps `includeUsage:true` with wrapped fetch; `openai`-family chat is wrapped; explicit `streamOptions:false` omits upfront in one `net.fetch` call; Responses stays unwrapped.
- Regression — `src/main/ai/runtime/pi/modelInjection.test.ts`: `streamOptions:false` maps to `supportsUsageInStreaming:false` with no `stream_options` on the wire; true/absent stays enabled; non-completions protocols set no such key.
