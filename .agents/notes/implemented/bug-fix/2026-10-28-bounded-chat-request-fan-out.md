# Agent Note: Unbounded per-call request multiplication

Status: implemented

English | [中文](2026-10-28-bounded-chat-request-fan-out.zh.md)

## Problem

[#22572](https://github.com/CherryHQ/cherry-studio/issues/22572) reported roughly US$200 of API spend in half an hour of ordinary use, with no reproduction sequence. The report could not be attributed to one code path, and auditing the request-producing paths found three that multiplied one user action without any bound the user could see:

- Disabling an assistant's "Max tool call rounds" set the step cap to `DEFAULT_ASSISTANT_SETTINGS.maxToolCalls` (100), the largest ordinary value, instead of removing a smaller cap or falling back to the SDK default of 20. The tool loop is the largest per-message multiplier, so "off" quietly meant "the most expensive option".
- `createAiRepair` issued its follow-up repair call without `maxRetries`, inheriting the AI SDK default of 2. One malformed tool call could therefore cost three requests, inside every step of the loop, outside both the retry preference and the request's own `maxRetries: 0`.
- `chat.retry.fallback_model_ids` had no length limit, so a configured list of N models added N billable attempts to every call that failed, and the settings selector let the list grow without bound.

## Decision

Each multiplier gets an explicit bound at the point that owns it:

- `resolveToolCallLimit` returns the SDK default step count (20) when `enableMaxToolCalls` is false. The configured maximum is used only when the assistant explicitly turns the limit on and supplies a valid `maxToolCalls`.
- The tool-call repair call passes `maxRetries: 0`, matching every other side request in `AiService` (`generateImage`, `embedMany`, `rerank`, `checkModel`).
- `MAX_RETRY_FALLBACK_MODELS` lives in `@shared/ai/retry`: `readRetryPolicy` truncates the stored list to it and the settings selector refuses to store more, so the two layers cannot disagree.

## Alternatives considered

- Removing the step cap entirely when the limit is disabled: rejected because `stepCountIs` is the only thing that stops a tool loop; no cap means an unpaid-for indefinite loop.
- Adding a per-conversation or per-session spend budget: this is what the reporter would benefit from most, but it is a product decision spanning model pricing data, the usage view, and a new preference. It is not a bug fix and needs its own proposal.
- Capping API-key failover at the same limit: rejected because key rotation is what recovers a 401/429 on a provider with several keys, and each key is tried once by design. It remains unbounded in key count, documented in `docs/references/ai/model-retry.md`.
- Capping the configured `maxToolCalls` upper bound (`MAX_TOOL_CALLS = 1000`): rejected because that bound is an explicit, visible user choice on the assistant, unlike the three above.

## Consequences

An assistant with the tool-call limit disabled now stops at 20 steps instead of 100, and reports the existing `tool_call_limit_reached` error. Users who relied on "off" for genuinely long tasks must enable the limit and set the value they need. A repair never retries on its own; a failed repair is returned unrepaired as before. Only the first five configured fallback models are tried, and the settings selector stops accepting a sixth. None of these change streaming behaviour, key failover, or the `chat.retry.*` defaults.

The Claude Agent SDK runtime still sets neither `maxTurns` nor `maxBudgetUsd`, so agent sessions driven by that runtime remain uncapped. That is a separate, larger decision.

## Verification

- Regression — `pnpm test:main src/main/ai/runtime/aiSdk/params/__tests__/buildAgentParams.test.ts`: a request with the limit disabled resolves to 20, not the configured maximum. Reverting the resolver fails this test.
- Regression — `pnpm test:main src/main/ai/tools/adapters/aiSdk/__tests__/repair.test.ts`: the repair call is issued with `maxRetries: 0`. Reverting the parameter fails this test.
- Regression — `pnpm test:main src/main/ai/runtime/aiSdk/retry/__tests__/retryPolicy.test.ts`: a nine-model fallback list is truncated. Reverting `readRetryPolicy` fails this test.
- Regression — `pnpm test:main src/main/ai/runtime/aiSdk/retry/__tests__ src/main/ai/tools/adapters/aiSdk/__tests__/repair.test.ts src/main/ai/runtime/aiSdk/params/__tests__/buildAgentParams.test.ts`: 192 tests across 8 files pass, covering key failover, fallback ordering, and retry events.
