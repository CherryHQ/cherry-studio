# Params Pipeline

## What it is

`buildAgentParams` (`src/main/ai/runtime/aiSdk/params/buildAgentParams.ts`) is the
single function that turns a (request, provider, model, assistant) tuple
into everything `Agent.stream()` needs:

```ts
interface BuiltAgentParams {
  sdkConfig: SdkConfig             // providerId + providerSettings + modelId
  tools: ToolSet | undefined        // active + meta-tools after defer
  plugins: AiPlugin<any, any>[]     // model-adapter plugins (ordered)
  system: string | undefined        // assembled system prompt
  options: AgentOptions             // headers, providerOptions, stopWhen, repair, telemetry
  hookParts: ReadonlyArray<Partial<AgentLoopHooks>>
}
```

It is a pure async function — no class, no shared state. Callers (chat,
agent session, translate, prompt-only) shape their own `AiBaseRequest` and
hand it in.

## RequestFeature

The composition unit is `RequestFeature`
(`src/main/ai/runtime/aiSdk/params/feature.ts`):

```ts
interface RequestFeature {
  readonly name: string
  applies?(scope: RequestScope): boolean
  contributeModelAdapters?(scope: RequestScope): AiPlugin<any, any>[]
  contributeHooks?(scope: RequestScope): Partial<AgentLoopHooks>
}
```

`collectFromFeatures(scope, features)` calls each feature's `applies`
(default `true`), then collects its model adapters and hook parts. The
result feeds `plugins` and `hookParts` in `BuiltAgentParams`.

Order matters because AI SDK plugin order is significant. The list lives
in `src/main/ai/runtime/aiSdk/params/features/index.ts`:

```ts
export const INTERNAL_FEATURES = [
  devtoolsFeature,
  gatewayUsageNormalizeFeature,
  modelParamsFeature,
  pdfCompatibilityFeature,        // must run before anthropicCacheFeature
  reasoningExtractionFeature,     // must run before simulateStreamingFeature
  simulateStreamingFeature,
  anthropicCacheFeature,
  anthropicHeadersFeature,
  openrouterReasoningFeature,
  noThinkFeature,
  qwenThinkingFeature,
  skipGeminiThoughtSignatureFeature,
  providerWebSearchFeature,
  providerUrlContextFeature
]
```

Callers can append per-request `extraFeatures`; those run after the
internal set. (AiService's analytics is *not* one of these — it is injected
separately as a `hookParts` entry, not a `RequestFeature`.)

## RequestScope

All features receive the same read-only scope object built in
`buildAgentParams`:

```ts
interface RequestScope extends ToolApplyScope {
  request, signal, registry, assistant, model, provider,
  capabilities,            // resolveCapabilities — see capabilities.ts
  sdkConfig, endpointType, aiSdkProviderId,
  requestContext,          // RequestContext for tool execute()
  mcpToolIds
}
```

Features must never mutate the scope. The scope IS shared across all
features for a single request, so any added field becomes part of the
contract — keep it minimal.

## Pipeline order

```
buildAgentParams(input)
  ├─ resolveSdkConfig         → providerToAiSdkConfig + modelId
  ├─ canModelConsumeTools?    → resolveTools (registry sync + defer)
  │     └─ syncMcpToolsToRegistry  (only servers owning a selected tool)
  │     └─ registry.selectActive   (per-entry applies)
  │     └─ applyDeferExposition    (defer pool → meta-tools + system section)
  ├─ resolveCapabilities      → enableWebSearch / enableUrlContext / …
  ├─ resolveEffectiveEndpoint → endpointType (model > provider default)
  ├─ resolveAiSdkProviderId   → adapter-family routing (see adapter-family.md)
  ├─ collectFromFeatures      → plugins + hookParts
  ├─ assembleSystemPrompt     → assistant prompt + deferred-tools header
  └─ buildAgentOptions        → providerOptions + customParameters split
                                + headers + stopWhen + repair + telemetry
```

## customParameters split

User-supplied `assistant.customParameters` may contain AI-SDK standard
params (temperature, topP, etc.) **and** provider-scoped overrides.
`extractAiSdkStandardParams` separates them; standard params land on the
top-level `AgentOptions` (AI SDK forwards them to the model), provider
params merge into `providerOptions[aiSdkProviderId]` (after a
`mergeCustomProviderParameters` pass that respects existing capability
options).

## Where to read more

- Code: `src/main/ai/runtime/aiSdk/params/`
- Tests: `src/main/ai/runtime/aiSdk/params/__tests__/` (`assembleSystemPrompt`,
  `collectFromFeatures`, `composeHooks`),
  `src/main/ai/runtime/aiSdk/params/features/__tests__/`
- Tool defer: [Tool Registry](./tool-registry.md)
- Endpoint routing: [Adapter Family](./adapter-family.md)
- Hooks: [Agent Loop](./agent-loop.md)
