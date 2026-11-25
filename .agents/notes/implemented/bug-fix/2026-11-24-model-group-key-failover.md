# Agent Note: Match New API chat models to eligible API keys

Status: implemented

English | [中文](2026-11-24-model-group-key-failover.zh.md)

## Problem

A provider can have API keys that serve different model sets. Round-robin selection sometimes sends a chat request to an API key whose group cannot serve the selected model. The gateway explicitly rejects that model for the group with HTTP 404, and the existing key failover for 401/429 leaves the reply failed.

## Decision

For standard New API Chat Completions, check each enabled key's model list and rotate among the keys that advertise the requested model. Cache the per-key lists in the main process. If the lists cannot identify a usable key, preserve normal rotation. Use existing same-model failover on an explicit group-specific 404 to handle stale or incomplete lists.

## Alternatives considered

- Trying another key on every HTTP 404 would repeat requests to missing routes and obscure configuration errors.
- Waiting for the first generation to fail would waste a chat request when the model list can identify a compatible key ahead of time.

## Consequences

A cold lookup can wait up to two seconds for the model lists. Later requests reuse the lists for one minute. Explicit key overrides, custom headers and other endpoints bypass the lookup. An unrelated 404 does not switch keys, and exhaustion still surfaces an error.

## Verification

- Regression — `createRetryableWrap.apiKeyFailover.test.ts`: the group-specific 404 test failed before the fix, then recovered the original model's stream; a generic 404 still propagated.
- Regression — `createRetryableWrap.test.ts` and `createRetryableWrap.apiKeyFailover.test.ts`: 29 focused Vitest tests passed using fixture responses.
- Regression — `config.test.ts` and `ProviderService.apiKeys.test.ts`: 163 tests passed, including initial key selection, cache reuse, and respecting an explicit override.
