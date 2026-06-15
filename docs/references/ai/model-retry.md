# Model Retry & Fallback

## What it is

User-configurable retry for model calls, built on
[`ai-retry`](https://github.com/zirkelc/ai-retry) (v1.x, AI SDK v6). When a
call fails, the wrapper first retries the **same model** for transient errors
(429 / 503 / 529 / timeout, honoring `Retry-After` headers with optional
exponential backoff), then **falls back** to the user's configured fallback
models in order. Retry happens at the model layer — below the agent loop, so
tool state and hook composition are untouched.

```
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

### Chat models (`createRetryableWrap`)

`src/main/ai/runtime/aiSdk/retry/createRetryableWrap.ts`:

1. Reads the four preferences; returns `undefined` when disabled.
2. Resolves each fallback `UniqueModelId` → provider/model entities →
   `providerToAiSdkConfig` → `resolveLanguageModel` (exported by
   `@cherrystudio/ai-core`). A fallback equal to the primary model is
   skipped; an unresolvable one (deleted provider/model) is logged and
   skipped — fallback config never fails the request.
3. Returns a `wrapModel` closure:

```ts
createRetryable({
  model: base,
  retries: [
    retryAfterDelay({ maxAttempts, delay: 1_000, backoffFactor: 2 }), // same model
    ...fallbackModels                                                  // one attempt each
  ],
  onRetry,   // logs + onRetryEvent callback
  onFailure  // logs terminal failure
})
```

`AiService.streamText` / `generateText` build the wrap after
`buildAgentParamsFor` and pass it as `AgentLoopParams.wrapModel`;
`Agent.buildAiSdkAgent` forwards it to `createAgent`, which applies it to the
resolved model right before constructing the `ToolLoopAgent`.

The `wrapModel` hook input is typed `LanguageModelV3` on purpose: the value
has already been resolved by the plugin pipeline (`executor.resolveModel`
rejects V2 models and resolves string ids), so implementations never see the
wide `LanguageModel` union.

### Retry events → renderer

`onRetryEvent` is wired by `AiService.streamText` to
`agent.write({ type: 'data-retry', transient: true, data: { modelId, attempt, reason } })`,
so the renderer can show a "retrying…" status line. The chunk is transient —
nothing is persisted. All logging goes through
`loggerService.withContext('ModelRetry')`.

### Embeddings (`createEmbeddingRetryWrap`)

Same-model transient retry **only** — no cross-model fallback, because
vectors from different embedding models live in incompatible spaces and
mixing them would corrupt the index. Wired via the `wrapModel` field on
`EmbedManyParams` (`RuntimeExecutor.embedMany` applies it to the resolved
embedding model).

### Rerank

`ai-retry` does not support `RerankingModelV3`. Instead, `AiService.rerank`
defaults the AI SDK's built-in `maxRetries` (exponential backoff) from
`chat.retry.max_attempts` when retry is enabled; an explicit
`requestOptions.maxRetries` still wins. The existing degrade-to-vector-results
fallback in `knowledge/utils/indexing/rerank.ts` is unchanged.

## Interaction with other retry knobs

- **AI SDK `maxRetries`** stays `0` for chat calls (`buildAgentParams`) —
  ai-retry owns retries; enabling both would multiply attempts.
- **`AgentLoopHooks.onError` returning `'retry'`** is a separate (still
  unimplemented) loop-level mechanism and is orthogonal to this model-level
  wrapper.

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
