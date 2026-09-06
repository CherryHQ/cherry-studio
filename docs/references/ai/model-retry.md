---
description: User-configurable same-model retry plus fallback models via ai-retry wrapModel, driven by chat.retry.* preferences
sources:
  - src/main/ai/runtime/aiSdk/retry
  - src/renderer/pages/settings/ModelSettings/ModelSettings.tsx
---

# Model Retry & Fallback

## What it is

User-configurable retry for model calls, built on
[`ai-retry`](https://github.com/zirkelc/ai-retry) (v1.x, AI SDK v6). When a
call fails with 401/429 and another enabled API key is available, the wrapper
first rotates to that key. Other retryable API errors (503 / 529 and other
`isRetryable` errors, honoring `Retry-After` headers with optional exponential
backoff — `TimeoutError`s are deliberately not retried, see below) retry the
**same model**, then **fall back** to the user's configured fallback models in
order. Retry happens at the model layer — below the agent loop, so tool state
and hook composition are untouched.

```text
AiService.streamText/generateText
  └─ createRetryableWrap()              src/main/ai/runtime/aiSdk/retry/
       └─ wrapModel: (model) => createRetryableModel({ model, retries: [...] })
            └─ passed via AgentLoopParams.wrapModel
                 └─ createAgent() applies it AFTER pluginEngine.resolveModel
                      (middlewares already applied → retryable is outermost)
```

## Configuration (global Preference)

| Key | Default | Meaning |
|---|---|---|
| `chat.retry.enabled` | `false` | Enables transient chat retry, cross-model fallback, and the embedding/rerank retry policy; API-key failover remains independent |
| `chat.retry.max_attempts` | `3` | Retry count, normalized to the integer range 1–10 at the request boundary |
| `chat.retry.backoff_enabled` | `true` | Exponential backoff (2s, 4s, 8s… with the library's attempt-count exponent) |
| `chat.retry.fallback_model_ids` | `[]` | `UniqueModelId[]` tried in order after same-model retry is exhausted |

Settings UI lives in `src/renderer/pages/settings/ModelSettings/ModelSettings.tsx`
(toggle + max attempts + backoff + multi-model picker via `ModelSelector`
with `multiple` / `selectionType="id"`).

These keys are generated from `v2-refactor-temp/tools/data-classify/data/target-key-definitions.json`
— edit there and regenerate, never edit `preferenceSchemas.ts` by hand.

## How it plugs in

### Chat models — two pieces

**Fallbacks are rebuilt per-model** (`src/main/ai/runtime/aiSdk/retry/buildFallbackModels.ts`).
A fallback must carry **its own** feature middleware and params, not the
primary's — ai-retry swaps the model but replays one set of call options, and
the feature plugins are model-specific (built per `(assistant, model, provider)`
in `buildAgentParams`, closed over that model). So for each configured fallback
`UniqueModelId`, `buildFallbackModels`:

1. Returns `[]` when retry is disabled; rejects malformed ids and skips the
   active model and duplicates, with diagnostics for each skipped entry.
2. **Capability-gates** native image, PDF, audio, and video input plus active
   tools. A fallback reuses the primary's request shape and tools/system, so it
   must support everything that the primary preserved natively.
3. Runs the **same `buildAgentParams` pipeline** as the primary for that model →
   `{ sdkConfig, plugins, options }`, resolves it via
   `resolveLanguageModel(providerId, settings, modelId, plugins)` (the `plugins`
   arg applies the fallback's own middleware), and lifts its own
   sampling/`providerOptions`/`headers` as a per-fallback call-option override.
4. A deleted provider/model (`NOT_FOUND`) is logged + skipped. Abort,
   configuration, authentication, plugin, and other unexpected errors propagate
   instead of being silently converted into "no fallback".

**`createRetryableWrap`** (`createRetryableWrap.ts`) then just assembles the
ai-retry policy from the pre-built fallbacks (no provider/model loading in this
leaf). It returns `undefined` only when model retry is disabled and no eligible
API-key fallback exists; otherwise it returns a `wrapModel` closure. Key rotation
is attempted first for 401/429 responses. When model retry is enabled, a selected
replacement key still receives the configured same-model retry for other
retryable errors (such as 503/529) before cross-model fallback begins.

```ts
// ai-retry's condition-based API (ai-retry/language-model). The retry STRATEGY
// (which conditions retry vs fall back) is a fixed internal policy — not exposed.
createRetryableModel({
  model: base,
  retries: [
    // API-key failover consumes 401/429 first; same-model retry handles the
    // remaining retryable errors (such as 503/529). maxAttempts =
    // max_attempts + 1 (ai-retry counts the original call, so the pref reads as
    // the number of RETRIES); backoffFactor only when backoff_enabled. Honors Retry-After.
    error.isRetryable(true).retry({ maxAttempts: max_attempts + 1, delay: 1_000, /* backoffFactor: 2 */ }),
    // fallbacks are lazy, error-only Retryable fns. Successful resolution is
    // memoized; a null result is retried on a later failure.
    ...fallbackResolvers.map((resolve) => errorOnlyLazyRetryable(resolve))
  ],
  onRetry,   // logs + onRetryEvent callback
  onFailure  // logs terminal failure
})
```

`AiService.streamText` / `generateText` build the fallbacks + wrap after
`buildAgentParamsFor` and pass the wrap as `AgentLoopParams.wrapModel`;
`Agent.buildAiSdkAgent` forwards it to `createAgent`, which applies it to the
resolved model right before constructing the `ToolLoopAgent`.

> **Limitation:** fallbacks get their own middleware and their own
> sampling / `providerOptions` / `headers`, but reuse the **primary's tools +
> system** (the agent loop is built around them and ai-retry can't re-shape them
> mid-call) — the capability gate compensates by skipping fallbacks that can't
> handle the request shape. Per-fallback tools/system without a separate
> `buildAgentParams` recompute would need the context-driven feature refactor
> tracked in #16197.

The `wrapModel` hook input is typed `LanguageModelV3` on purpose. The plugin
engine validates the resolved value at its public `resolveModel` boundary
before applying middleware, so callers never need a V3 assertion.

### Retry events → renderer

`onRetryEvent` is wired by `AiService.streamText` to
`agent.write({ type: 'data-retry', id: 'retry', data: event })`
— a **stable-id, non-transient** data part, so it rides `message.parts` and the
renderer renders it as a "retrying…" status line (`RetryStatusBlock`). The
stable `id` makes repeated retries reconcile into one part (latest wins), and
the wrapper publishes `{ state: 'settled' }` after success or terminal failure,
which clears the live spinner. `PersistenceListener` calls
`stripTransientStatusParts` before every terminal write, so retry status is
live-only and never persisted. Cross-model fallback is logged at warning level
with both failed and fallback ids; terminal logs preserve the original error
and per-attempt diagnostics. All logging goes through
`loggerService.withContext('ModelRetry')`.

### Embeddings & Rerank — no ai-retry

Neither uses the ai-retry model wrapper. There is no cross-model fallback for
embeddings (vectors from different models live in incompatible spaces and would
corrupt the index) or rerank (`ai-retry` has no `RerankingModelV3` support), so
the wrapper adds no value — and AI SDK's built-in retry already does the right
thing per batch (respects `Retry-After` + exponential backoff). Both
`AiService.embedMany` and `AiService.rerank` therefore derive the SDK's
`maxRetries` from the retry preference, preserving each path's pre-feature
default when retry is off (embedMany `2` = the SDK default, rerank `0`); an
explicit `requestOptions.maxRetries` still wins.

When retry is enabled, embeddings additionally cap fan-out. `embedMany` splits a long document into
many `doEmbed` batches and defaults to **unbounded** parallelism
(`maxParallelCalls: Infinity`) — firing them all at once is the main embedding
rate-limit trigger. `AiService.embedMany` sets `maxParallelCalls`
(`EMBEDDING_MAX_PARALLEL_CALLS = 5`) to bound concurrency only while the retry
feature is enabled; disabled mode preserves the prior SDK default. The
per-batch retry handles residual 429s. The degrade-to-vector-results fallback in
`knowledge/utils/indexing/rerank.ts` is unchanged.

## Interaction with other retry knobs

- **AI SDK `maxRetries`** is forced to `0` whenever the chat wrapper is active,
  so ai-retry alone owns retries and attempts cannot multiply. With the global
  feature disabled, an explicit non-zero per-request value uses the SDK's native
  retry behavior unless API-key failover activates the wrapper; in that case the
  wrapper applies the same retry count without enabling configured model fallbacks.
- **Per-request opt-out:** an explicit `requestOptions.maxRetries === 0` on a
  chat request disables the entire ai-retry wrapper for that request (no API-key
  failover, same-model retry, or cross-model fallback), so the per-request
  contract stays authoritative — the same way embedding/rerank honor an explicit
  override.
- **`AgentLoopHooks.onError`** handlers are all invoked and their decisions are
  composed (`retry` wins over `abort`). The current agent loop still terminates
  after notification; call-level retry/fallback belongs to this model wrapper,
  while restarting a whole turn is the stream manager's concern.

## Limitations

- **Streaming:** retries/fallbacks only apply before the first content chunk
  is emitted. Once content streams, the response is committed to the current
  model; mid-stream errors surface as stream errors (existing behavior).
- **Abort:** abort signals pass through untouched; aborts are not retried.
- Fallbacks can override the supported call-option subset documented above,
  but cannot replace the already-built primary tools or system prompt.

## Tests

- `src/main/ai/runtime/aiSdk/retry/__tests__/createRetryableWrap.test.ts` —
  same-model retry ordering, ordered fallback, lazy/memoized resolution,
  retry events and settlement, and original error preservation.
- `src/main/ai/runtime/aiSdk/retry/__tests__/buildFallbackModels.test.ts` —
  malformed/duplicate ids, deleted-model handling, unexpected-error
  propagation, model-specific options/plugins, and tool/media gates.
- `src/main/ai/__tests__/AiService.test.ts` — request policy snapshot wiring,
  native attachment detection, explicit opt-out, and embed/rerank semantics.
- Persistence and renderer tests verify retry parts never reach storage and
  the live spinner disappears after settlement.
- `packages/aiCore/src/core/agents/__tests__/createAgent.test.ts` —
  `wrapModel` receives the resolved model and its return value is used.
