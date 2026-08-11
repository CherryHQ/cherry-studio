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

It is a standalone async orchestrator — no class or retained request state.
Callers (chat, agent session, translate, prompt-only) shape their own
`AiBaseRequest` and hand it in. The pipeline refines the request-local
`sdkConfig.providerSettings.fetch` when HTTP tracing or custom-parameter body
passthrough is required.

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
in `src/main/ai/runtime/aiSdk/params/features/internalFeatures.ts`:

```ts
export const INTERNAL_FEATURES = [
  devtoolsFeature,
  gatewayUsageNormalizeFeature,
  deepseekDsmlParserFeature,
  reasoningExtractionFeature,     // must run before simulateStreamingFeature
  simulateStreamingFeature,
  anthropicCacheFeature,
  anthropicHeadersFeature,
  openrouterReasoningFeature,
  noThinkFeature,
  qwenThinkingFeature,
  skipGeminiThoughtSignatureFeature,
  providerWebSearchFeature,
  providerUrlContextFeature,
  terminalToolFailureFeature,
  steerYieldFeature
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

Features must never mutate the scope. The scope IS shared across all features
for a single request, so any added field becomes part of the contract — keep it
minimal. After feature collection, the pipeline may still refine the
request-local `sdkConfig.providerSettings.fetch` before returning it.

## Pipeline order

```
buildAgentParams(input)
  ├─ resolveSdkConfig         → providerToAiSdkConfig + modelId
  ├─ applyHttpTrace           → optional request-local fetch wrapper
  ├─ canModelConsumeTools?    → resolveTools (registry sync + defer)
  │     └─ syncMcpToolsToRegistry  (only servers owning a selected tool)
  │     └─ registry.selectActive   (per-entry applies)
  │     └─ applyDeferExposition    (defer pool → meta-tools + system section)
  ├─ resolveCapabilities      → enableWebSearch / enableUrlContext / …
  ├─ resolveEffectiveEndpoint → endpointType (model > provider default)
  ├─ resolveAiSdkProviderId   → adapter-family routing (see adapter-family.md)
  ├─ extractAiSdkStandardParams → standard params + provider-scoped params
  ├─ resolveRequestedMaxOutputTokens → raw output limit before reasoning adjustment
  ├─ resolveReasoningInvocation → reasoning wire + explicit thinking budget
  ├─ collectFromFeatures      → plugins + hookParts
  ├─ assembleSystemPrompt     → assistant prompt + deferred-tools header
  └─ buildAgentOptions        → standard params + providerOptions + call overrides
                                + reasoning-adjusted output limit
                                + optional body-passthrough fetch wrapper
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

Standard sampling params are assembled directly in `buildAgentOptions`;
they are not contributed by a `RequestFeature`. Assistant `temperature`
and `topP` values are capability-filtered, then custom standard params
override them, and per-call overrides apply last.

`maxOutputTokens` uses a separate raw-limit resolution before reasoning:

1. `request.callOverrides.maxOutputTokens`
2. `assistant.customParameters.maxOutputTokens`
3. the enabled assistant max-token setting
4. `model.maxOutputTokens`, only for an `anthropic-messages` endpoint
5. `undefined`

The resolved raw limit is also used to resolve the reasoning invocation;
when it is undefined, `model.maxOutputTokens` remains a budget-sizing
fallback without being forced into `AgentOptions`. For an
`anthropic-messages` request, `buildAgentOptions` reads the effective thinking
mode after per-call provider-option overrides. It subtracts an explicit additive
budget exactly once before passing the non-thinking remainder to the SDK (with a
minimum of one token). Adaptive or disabled thinking has no explicit budget and
is not subtracted. An undefined raw limit remains omitted, so unknown
Anthropic-compatible non-Claude models can defer to the endpoint instead of
inheriting an SDK fallback; unrecognized Claude aliases retain the SDK's Claude
fallback because Anthropic requires `max_tokens`.

Flat provider params also pass through a request-local fetch wrapper after the
AI SDK serializes its JSON POST body. This preserves provider-defined wire names
such as `snake_case` keys that an adapter schema does not recognize. Provider
namespace bags remain exclusive to `providerOptions`, non-JSON requests are
left unchanged, and SDK-produced body fields take precedence over custom
parameters.

## Where to read more

- Code: `src/main/ai/runtime/aiSdk/params/`
- Tests: `src/main/ai/runtime/aiSdk/params/__tests__/` (`assembleSystemPrompt`,
  `collectFromFeatures`, `composeHooks`),
  `src/main/ai/runtime/aiSdk/params/features/__tests__/`
- Tool defer: [Tool Registry](./tool-registry.md)
- Endpoint routing: [Adapter Family](./adapter-family.md)
- Hooks: [Agent Loop](./agent-loop.md)
