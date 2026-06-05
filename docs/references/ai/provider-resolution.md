# Provider Resolution

## The problem this solves

A request needs to know which `@ai-sdk/*` package to import, with which
settings, hitting which URL. Three pieces of state determine that:

| Field | Lives on | Example |
|---|---|---|
| `provider.id` | `Provider` row | `minimax`, `silicon`, `my-relay` |
| `endpointType` | `model.endpointTypes[0]` or `provider.defaultChatEndpoint` | `openai-chat-completions`, `anthropic-messages` |
| `adapterFamily` | `provider.endpointConfigs[endpointType].adapterFamily` | `openai-compatible`, `anthropic`, `azure-responses` |

`adapterFamily` is the actual SDK selector. `provider.id` is the user-facing
identity. `endpointType` is the protocol family. The mapping is written
once at provider-creation time; runtime resolution is read-only.

See [Adapter Family](./adapter-family.md) for the full design.

## Resolver

`src/main/ai/provider/endpoint.ts` exposes three pure helpers:

```ts
resolveEffectiveEndpoint(provider, model): { endpointType, baseUrl }
resolveProviderVariant(baseProviderId, endpointType): AppProviderId
resolveAiSdkProviderId(provider, endpointType): AppProviderId
```

`resolveAiSdkProviderId` is the runtime hot-path entry. It reads
`provider.endpointConfigs[endpointType].adapterFamily`, applies the
variant suffix if the endpoint type has one, falls back to
`openai-compatible` when no family is set.

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
(the base already is). `azure-anthropic` is not reached through the suffix
rule — it is selected inside `buildAzureConfig` when the model is a Claude
model (see below). `resolveProviderVariant(baseId, endpointType)` is
idempotent when the base id is already a variant.

## Provider config

`providerToAiSdkConfig(provider, model)`
(`src/main/ai/provider/config.ts`) returns
`{ providerId: AppProviderId, providerSettings: AppProviderSettingsMap[id] }`.
It calls `resolveAiSdkProviderId` internally, then dispatches through an
ordered `{ match, build }` table to build the provider-specific settings
object (apiKey, baseURL, organization, headers, ...). There is **no
"gateway" branch**.

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
| `id === 'aihubmix'` | `buildAiHubMixConfig` | |
| _(no match)_ | `buildGenericProviderConfig` / `buildOpenAICompatibleConfig` | generic fallback |

Several builders are `async` (Copilot token, CherryIN relay URLs), which is
why `providerToAiSdkConfig` returns a promise.

## Custom providers

`src/main/ai/provider/custom/`:

- **aihubmix** — multi-vendor relay. `provider.id='aihubmix'` but each
  model carries `model.provider='aihubmix.<vendor>'`; the registry's
  aggregator fallback uses the suffix to pick the right `toolFactory`.
- **newapi** — same shape, different relay.

Both register through `ProviderExtension.create(...)` with their own
`AppProviderSettings` shape.

## Provider extensions

`src/main/ai/provider/extensions/index.ts` registers every
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
