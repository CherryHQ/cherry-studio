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

Some adapters expose multiple variants (different endpoints, same SDK
package). Variant suffix is appended to the base id:

| Base | Variants | When picked |
|---|---|---|
| `openai` | `openai-chat`, `openai-responses` | endpoint = `openai-chat-completions` / `openai-responses` |
| `azure` | `azure-responses` | endpoint = `openai-responses` |
| `ollama` | `ollama-chat` | endpoint = `ollama-chat` |

`resolveProviderVariant(baseId, endpointType)` does the mapping and is
idempotent when the base id is already a variant.

## Provider config

`providerToAiSdkConfig(provider, model)`
(`src/main/ai/provider/config.ts`) returns
`{ providerId: AppProviderId, providerSettings: AppProviderSettingsMap[id] }`.
It calls `resolveAiSdkProviderId` internally and then builds the
provider-specific settings object (apiKey, baseURL, organization,
headers, ...).

Special cases:

- **Gateway** — settings built asynchronously (model-list dependent).

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
  `urlContext` etc.; see the
  [core architecture](./core-architecture.md#43-extension-registry)
  section on tool capability resolution)
- `supportsImageGeneration` (boolean flag)

## Where to read more

- Code: `src/main/ai/provider/`
- Tests: `provider/__tests__/endpoint.test.ts` (54 cases)
- Migration of legacy provider rows: `src/main/data/migration/v2/migrators/mappings/ProviderModelMappings.ts`
- Catalog (new installs): `packages/provider-registry/data/providers.json`
- Design: [Adapter Family](./adapter-family.md)
