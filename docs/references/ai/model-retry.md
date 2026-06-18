# Model Retry & Fallback

## What it is

User-configurable retry for model calls, built on
[`ai-retry`](https://github.com/zirkelc/ai-retry) (v1.x, AI SDK v6). When a
call fails, the wrapper first retries the **same model** on retryable API
errors (429 / 503 / 529 and other `isRetryable` errors, honoring `Retry-After`
headers with optional exponential backoff — `TimeoutError`s are deliberately
not retried, see below), then **falls back** to the user's configured fallback
models in order. Retry happens at the model layer — below the agent loop, so
tool state and hook composition are untouched.

```text
AiService.streamText/generateText
  └─ createRetryableWrap()              src/main/ai/runtime/aiSdk/retry/
       └─ wrapModel: (model) => createRetryable({ model, retries: [...] })
            └─ passed via AgentLoopParams.wrapModel
                 └─ createAgent() applies it AFTER pluginEngine.resolveModel
                      (middlewares already applied → retryable is outermost)
```

## Configuration (global Preference)

| Key | Default | Meaning |
|---|---|---|
| `chat.retry.enabled` | `false` | Master switch — when off, every wrap helper returns `undefined` |
| `chat.retry.max_attempts` | `3` | Same-model retry attempts for transient errors |
| `chat.retry.backoff_enabled` | `true` | Exponential backoff (base 1s, factor 2) between attempts |
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
`UniqueModelId`, `AiService.buildFallbackModels`:

1. Returns `[]` when retry is disabled / unconfigured; skips a fallback equal to
   the **stored** primary `UniqueModelId` (not `sdkConfig.modelId` = apiModelId).
2. **Capability-gates**: skips a non-vision fallback when the request has image
   input, or a non-function-calling fallback when the request has active tools
   (the fallback reuses the primary's tools/system, so it must be able to handle
   them). Logged + skipped, never failing the request.
3. Runs the **same `buildAgentParams` pipeline** as the primary for that model →
   `{ sdkConfig, plugins, options }`, resolves it via
   `resolveLanguageModel(providerId, settings, modelId, plugins)` (the `plugins`
   arg applies the fallback's own middleware), and lifts its own
   sampling/`providerOptions`/`headers` as a per-fallback call-option override.
4. An unresolvable fallback (deleted provider/model) is logged + skipped.

**`createRetryableWrap`** (`createRetryableWrap.ts`) then just assembles the
ai-retry policy from the pre-built fallbacks (no provider/model loading in this
leaf): returns `undefined` when disabled, else a `wrapModel` closure:

```ts
createRetryable({
  model: base,
  retries: [
    // maxAttempts = max_attempts + 1 (ai-retry counts the original call, so the
    // pref reads as the number of RETRIES); backoffFactor only when backoff_enabled.
    retryAfterDelay({ maxAttempts: max_attempts + 1, delay: 1_000, /* backoffFactor: 2 */ }),
    // fallbacks are lazy, error-only Retryable fns (resolve on first failure, memoized)
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

The `wrapModel` hook input is typed `LanguageModelV3` on purpose: the value
has already been resolved by the plugin pipeline (`executor.resolveModel`
rejects V2 models and resolves string ids), so implementations never see the
wide `LanguageModel` union.

### Retry events → renderer

`onRetryEvent` is wired by `AiService.streamText` to
`agent.write({ type: 'data-retry', id: 'retry', data: { modelId, attempt, reason } })`
— a **stable-id, non-transient** data part, so it rides `message.parts` and the
renderer renders it as a "retrying…" status line (`RetryStatusBlock`). The
stable `id` makes repeated retries reconcile into one part (latest wins), and
`PersistenceListener.stripTransientStatusParts` removes it before the message is
saved (live-only, never persisted). All logging goes through
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

Embeddings additionally cap fan-out. `embedMany` splits a long document into
many `doEmbed` batches and defaults to **unbounded** parallelism
(`maxParallelCalls: Infinity`) — firing them all at once is the main embedding
rate-limit trigger. `AiService.embedMany` sets `maxParallelCalls`
(`EMBEDDING_MAX_PARALLEL_CALLS = 5`) to bound concurrency; the per-batch retry
handles the residual 429s. The degrade-to-vector-results fallback in
`knowledge/utils/indexing/rerank.ts` is unchanged.

## Interaction with other retry knobs

- **AI SDK `maxRetries`** stays `0` for chat calls (`buildAgentParams`) —
  ai-retry owns retries; enabling both would multiply attempts.
- **Per-request opt-out:** an explicit `requestOptions.maxRetries === 0` on a
  chat request disables the ai-retry wrapper for that request (no same-model
  retry, no fallback), so the per-request contract stays authoritative — the
  same way embedding/rerank honor an explicit override.
- **`AgentLoopHooks.onError`** is a notification hook only; the loop always
  aborts after it. There is no turn-level retry in the agent loop — call-level
  retry/fallback is this model wrapper, and restarting a whole turn is the
  stream manager's abort-and-restart concern.

## Limitations

- **Streaming:** retries/fallbacks only apply before the first content chunk
  is emitted. Once content streams, the response is committed to the current
  model; mid-stream errors surface as stream errors (existing behavior).
- **Abort:** abort signals pass through untouched; aborts are not retried.
- Fallback models get the same call options as the primary (no per-fallback
  parameter overrides).

## Tests

- `src/main/ai/runtime/aiSdk/retry/__tests__/createRetryableWrap.test.ts` —
  disabled → `undefined`; duplicate/unresolvable fallback filtering; 401 →
  immediate fallback; 429 → same-model retry + retry event; embedding retry
  never switches models.
- `packages/aiCore/src/core/agents/__tests__/createAgent.test.ts` —
  `wrapModel` receives the resolved model and its return value is used.
