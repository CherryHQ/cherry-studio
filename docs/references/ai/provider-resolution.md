---
description: Endpoint resolution chain from provider.endpointConfigs and adapterFamily to the AI SDK provider id and variants
sources:
  - src/main/ai/provider/endpoint.ts
  - src/main/ai/provider/config.ts
  - packages/provider-registry/src/registry-utils.ts
  - packages/aiCore/src/core/providers/core/initialization.ts
---

# Provider Resolution

## The problem this solves

A request needs to know which `@ai-sdk/*` package to import, with which
settings, hitting which URL. Three pieces of state determine that:

| Field | Lives on | Example |
|---|---|---|
| `provider.id` | `Provider` row | `minimax`, `silicon`, `my-relay` |
| `endpointType` | resolved from runtime constraints, model preference/capabilities, and provider routes | `openai-chat-completions`, `anthropic-messages` |
| `adapterFamily` | `provider.endpointConfigs[endpointType].adapterFamily` | `openai-compatible`, `anthropic`, `azure-responses` |

`adapterFamily` is the actual SDK selector. `provider.id` is the user-facing
identity. `endpointType` is the protocol family. The mapping is written
once at provider-creation time; runtime resolution is read-only.

See [Adapter Family](./adapter-family.md) for the full design.

## Resolver

`src/main/ai/provider/endpoint.ts` exposes four pure helpers:

```ts
resolveEffectiveEndpoint(provider, model, { operationCapability, requiredEndpointType? }): {
  endpointType,
  baseUrl,
  providerOptionsKey?
}
resolveProviderVariant(baseProviderId, endpointType): AppProviderId
resolveAiSdkProviderId(provider, endpointType): AppProviderId
resolveProviderOptionsKey(aiSdkProviderId, context): string
```

Every request supplies its operation capability (`text-generation`, `embedding`, `rerank`,
`image-generation`, `audio-transcript`, `audio-generation`, or `video-generation`). The endpoint
operation contract in provider-registry defines which protocols can carry each operation. For that
operation, `resolveEffectiveEndpoint` resolves candidates in this order:

1. A compatible, configured caller requirement for a runtime that speaks exactly one protocol.
2. The model's compatible, configured `preferredEndpointType`.
3. `provider.defaultChatEndpoint`, when the model declares it and the provider still serves it. It is
   a setting the user chose; the declaration order below is only the order a catalog or an upstream
   `/models` happened to list.
4. The first compatible model-declared endpoint with a configured provider route.
5. If compatible declarations exist but none is configured, retain the first one and fail closed with
   an empty URL.
6. Only for `text-generation`, a registered per-model gateway route or `provider.defaultChatEndpoint`
   — the last-ditch form of step 3, for models that declare no protocol at all.
7. For other operations, a compatible endpoint explicitly configured by the provider; otherwise the
   operation is not routable.

`endpointTypes` is a protocol restriction, not a second model-type system. A model may support
multiple operations and multiple endpoints; it does not have to declare one endpoint for every
capability. Invalid or operation-incompatible preferences are ignored for that request. A configured
adapter-only endpoint can inherit the provider's shared host, while an undeclared adapter or an
unconfigured protocol does not borrow another protocol's host.

`resolveAiSdkProviderId` is the runtime hot-path entry. It reads
`provider.endpointConfigs[endpointType].adapterFamily`, applies the
variant suffix if the endpoint type has one, falls back to
`openai-compatible` when no family is set.

`resolveEffectiveEndpoint` also resolves registered multi-backend gateway routes
(AiHubMix and DMXAPI) once. The route supplies both the wire endpoint and the
`providerOptions` namespace used by that gateway's concrete model. The result is
carried through `SdkConfig`; reasoning encoders consume the resolved namespace
and never inspect provider or model ids themselves.

```ts
// Full resolver — 6 lines
export function resolveAiSdkProviderId(provider, endpointType) {
  const adapterFamily = endpointType
    ? provider.endpointConfigs?.[endpointType]?.adapterFamily
    : undefined
  if (adapterFamily && adapterFamily in appProviderIds) {
    return resolveProviderVariant(appProviderIds[adapterFamily], endpointType)
  }
  return appProviderIds['openai-compatible']
}
```

## Variants

Some bases expose variant ids (a different endpoint on the same base).
`resolveProviderVariant` knows two suffix rules and applies one only when
the resulting `<base>-<suffix>` id is actually registered — otherwise it
returns the base unchanged:

| Endpoint type | Suffix tried |
|---|---|
| `openai-chat-completions`, `ollama-chat` | `-chat` |
| `openai-responses` | `-responses` |

Variants registered today (declared in each provider extension's
`variants` array, `packages/aiCore/src/core/providers/core/initialization.ts`):

| Base | Variant id(s) |
|---|---|
| `openai` | `openai-chat` (the base `openai` is itself the Responses API) |
| `azure` | `azure-responses`, `azure-anthropic` |
| `xai` | `xai-responses` |
| `cherryin` | `cherryin-chat` |

`ollama` has no registered variant, so an `ollama-chat` endpoint resolves
to the base `ollama`. Likewise there is **no `openai-responses` variant**
(the base already is) — and the standalone `open-responses` extension
(`@ai-sdk/open-responses`, the minimal dialect for subset Responses servers —
see [Adapter Family](./adapter-family.md)) is deliberately NOT named
`openai-responses`, or this suffix probe would silently reroute every
`adapterFamily: 'openai'` responses endpoint onto it. `azure-anthropic` is not reached through the suffix
rule — it is selected inside `buildAzureConfig` when the model is a Claude
model (see below). `resolveProviderVariant(baseId, endpointType)` is
idempotent when the base id is already a variant.

## Provider config

`providerToAiSdkConfig(provider, model, { resolvedEndpoint? })`
(`src/main/ai/provider/config.ts`) returns
`{ providerId: AppProviderId, providerSettings: AppProviderSettingsMap[id] }`.
The standard request path passes its already-resolved endpoint into this
function, which then calls `resolveAiSdkProviderId` and dispatches through an
ordered `{ match, build }` table to build the provider-specific settings
object (apiKey, baseURL, organization, headers, ...). Direct callers may omit
the option and let the function resolve the endpoint itself.

The builder table (`config.ts`, first match wins):

| Match | Builder | Notes |
|---|---|---|
| `id === copilot` | `buildCopilotConfig` | async — fetches a Copilot token |
| `id === 'cherryai'` | `buildCherryAIConfig` | |
| `isOllamaProvider` | `buildOllamaConfig` | |
| `isAzureOpenAIProvider` | `buildAzureConfig` | returns `azure` / `azure-responses` / `azure-anthropic` (Claude on Azure) |
| `id === 'bedrock'` | `buildBedrockConfig` | |
| `id === 'google-vertex'` | `buildVertexConfig` | returns `google-vertex` or `google-vertex-anthropic` for Claude; leaves `baseURL` undefined when no host is configured so the SDK derives the aiplatform host |
| `provider.id === 'cherryin'` | `buildCherryinConfig` | matches the **provider id**, not the resolved variant — the default chat endpoint resolves to `cherryin-chat`, so an `id === 'cherryin'` check never fires; async — resolves relay base URLs |
| `id === 'newapi'` | `buildNewApiConfig` | |
| `id === 'aihubmix'` | `buildAiHubMixConfig` | passes the Chat, Responses, Anthropic, and Gemini URLs independently |
| `id === 'dmxapi'` | `buildDmxapiConfig` | passes the Chat, Anthropic, and Gemini URLs independently |
| _(no match)_ | `buildGenericProviderConfig` / `buildOpenAICompatibleConfig` | generic fallback |

Several builders are `async` (Copilot token, CherryIN relay URLs), which is
why `providerToAiSdkConfig` returns a promise.

## Custom providers

`src/main/ai/provider/custom/`:

- **aihubmix** — multi-vendor relay. Its model-id router selects the
  Anthropic, Gemini, OpenAI Responses, or OpenAI-compatible model and consumes
  the matching endpoint URL from provider settings.
- **dmxapi** — multi-vendor relay. Its model-id router selects Anthropic,
  Gemini, OpenAI, or compatible models and consumes the matching endpoint URL.
- **newapi** — same shape, different relay.

All three register through `ProviderExtension.create(...)` with their own
`AppProviderSettings` shape.

## Provider extensions

`src/main/ai/provider/extensions.ts` registers every
`@ai-sdk/*` package Cherry uses with `ProviderExtension.create`. Each
extension declares:

- `name` (the `AppProviderId` for the base)
- `aliases` (alternate ids that normalize to `name`)
- `variants` (suffix entries — see above)
- `create` (the SDK's factory)
- `toolFactories` (per-capability factory functions for `webSearch` /
  `urlContext` etc.)
- `supportsImageGeneration` (boolean flag)

## Where to read more

- Code: `src/main/ai/provider/`
- Tests: `provider/__tests__/endpoint.test.ts` (54 cases)
- Migration of legacy provider rows: `src/main/data/migration/v2/migrators/mappings/ProviderModelMappings.ts`
- Catalog (new installs): `packages/provider-registry/data/providers.json`
- Design: [Adapter Family](./adapter-family.md)
