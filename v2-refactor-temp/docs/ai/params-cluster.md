# Params Pipeline — Reviewer Cluster

## Scope

| Subpath | Files | Role |
|---|---|---|
| `runtime/aiSdk/params/` | `buildAgentParams.ts` (222), `feature.ts` (24), `scope.ts` (44), `capabilities.ts` (128), `assembleSystemPrompt.ts`, `collectFromFeatures.ts`, `composeHooks.ts`, `buildTelemetry.ts` | The orchestrator + scope + feature interface |
| `runtime/aiSdk/params/features/` | `index.ts` + 16 feature files (~50 LOC each) | The internal `RequestFeature` set |
| Tests | `params/__tests__/`, `params/features/__tests__/` | Per-file coverage |

## Intent

v1's `PluginBuilder` had a giant if/else tree that selected plugins by
sniffing provider id, model name, and assistant settings. v2 expresses
the same matrix as a list of `RequestFeature`s, each with its own
`applies` gate and contribution methods. Same decision tree — table-
driven instead of branch-assembled.

Architecture: [`docs/references/ai/params-pipeline.md`](../../../docs/references/ai/params-pipeline.md).

## Key changes

### `RequestFeature` interface

```ts
interface RequestFeature {
  readonly name: string
  applies?(scope: RequestScope): boolean
  contributeModelAdapters?(scope: RequestScope): AiPlugin<any, any>[]
  contributeHooks?(scope: RequestScope): Partial<AgentLoopHooks>
}
```

Each feature contributes plugins (AI SDK middlewares) and/or hooks
(Agent loop callbacks). `applies` errors are caught and treated as
`false`.

### `INTERNAL_FEATURES` list (order matters)

Listed in `features/index.ts`. Mirrors the prior `PluginBuilder.buildPlugins`
ordering — important pairs:

- `pdfCompatibilityFeature` before `anthropicCacheFeature` (cache marker
  must not see file parts that PDF conversion will rewrite).
- `reasoningExtractionFeature` before `simulateStreamingFeature`.

Caller-supplied `extraFeatures` (e.g. AiService analytics) run after
the internal set.

### Per-feature complexity

| Feature | What it does |
|---|---|
| `devtools` | Inject the OTel dev-tools span hook in dev mode |
| `gatewayUsageNormalize` | Normalise `@ai-sdk/gateway` usage fields back to `inputTokens` / `outputTokens` |
| `modelParams` | Pass top-K, top-P, temperature, etc. into providerOptions |
| `pdfCompatibility` | PDF file parts → extracted text for providers that reject `file` type |
| `reasoningExtraction` | DeepSeek-style `<think>…</think>` extraction into a reasoning UIMessagePart |
| `simulateStreaming` | For non-streaming endpoints, simulate token-by-token via in-memory chunking |
| `anthropicCache` | Add `cacheControl: { type: 'ephemeral' }` markers on system + trailing messages |
| `anthropicHeaders` | Per-model beta headers (e.g. `prompt-caching-2024-07-31`) |
| `openrouterReasoning` | OpenRouter-specific reasoning effort knobs (gated on model id) |
| `noThink` | `/no_think` system suffix for Qwen-omni-style models |
| `qwenThinking` | `enableThinking` providerOption for Qwen reasoning models |
| `skipGeminiThoughtSignature` | Drop Gemini's `thoughtSignature` from history when the model doesn't accept it back |
| `providerWebSearch` | Activate the provider's built-in web search tool via `toolFactories` |
| `providerUrlContext` | Activate the provider's URL-context tool |
| `promptToolUse` | XML-prompt fallback for tool use when the model doesn't support function calling |

Each file averages ~50 LOC; the gate and the contribution are short.

### `RequestScope`

```ts
interface RequestScope extends ToolApplyScope {
  request, signal, registry, assistant, model, provider,
  capabilities, sdkConfig, endpointType, aiSdkProviderId,
  requestContext, mcpToolIds
}
```

Pre-computed once at the top of `buildAgentParams` and passed read-only
to every feature. Adding a new field is a contract change; review any PR
that adds one.

### `assembleSystemPrompt`

Composes:

1. `assistant.prompt` (variable-replaced via `replacePromptVariables`).
2. The `<DEFERRED_TOOLS>` system-prompt section enumerating namespaces
   that `tool_search` covers — added only when `tool_search` is in the
   final tool set.

### `buildAgentOptions`

Assembles `AgentOptions` (per-request AI SDK settings). Notable bits:

- `customParameters` are split via `extractAiSdkStandardParams` into:
  - AI-SDK standard params (top-level on `AgentOptions`)
  - Provider-scoped params (merged into
    `providerOptions[aiSdkProviderId]` via `mergeCustomProviderParameters`)
- `stopWhen` is `stepCountIs(N)` where `N` reads
  `assistant.settings.maxToolCalls` clamped to `[MIN_TOOL_CALLS, MAX_TOOL_CALLS]`.
- `repairToolCall` is built from `createAiRepair(...)` — see
  [tool-cluster.md](./tool-cluster.md).

## Invariants

- Features never mutate `RequestScope`.
- Feature order in `INTERNAL_FEATURES` is significant — don't reorder
  without testing the pairs called out above.
- `applies` predicates are synchronous; async gating happens elsewhere
  (e.g. registry sync).

## Validation

- `params/__tests__/composeHooks.test.ts` (167)
- `params/__tests__/assembleSystemPrompt.test.ts` (107)
- `params/__tests__/collectFromFeatures.test.ts` (123)
- `params/features/__tests__/internalFeatures.test.ts` (201) — gates
  fire on the right shapes
- `params/features/__tests__/deepseekDsmlParserPlugin.test.ts` (462) —
  reasoning-extraction parser

## Follow-ups (out of scope)

- Some features still consult `assistant?.settings?.toolUseMode === 'prompt'`
  outside of `RequestScope.capabilities` — folding into `capabilities` is a
  cleanup pass.
- See also [Present-tense consumers only](../../../) memory: don't add
  feature-level config fields without a real call site.
