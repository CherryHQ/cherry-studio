# Adapter Family

`adapterFamily` is the field on every `EndpointConfig` that picks the
`@ai-sdk/*` package implementing that endpoint's protocol. The runtime
resolver reads it when present. The field is optional because legacy and
hand-written rows can exist without it; missing or unknown values fall
back to `openai-compatible`.

## Identity stack

| Layer | Example | Role |
|---|---|---|
| `provider.id` | `minimax`, `silicon`, `my-relay` | User-facing identity, UI label, routing key |
| `endpointType` | `openai-chat-completions`, `anthropic-messages` | URL path template + protocol family |
| `adapterFamily` | `openai-compatible`, `anthropic`, `azure-responses` | Which `@ai-sdk/*` package implements this protocol |

Multi-endpoint relays (MiniMax, Silicon, AiHubMix) carry one
`adapterFamily` per endpoint under the same `provider.id` — different
endpoints on the same provider can route to different SDK packages.

## Runtime resolver

`src/main/ai/provider/endpoint.ts`:

```ts
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

One signal, no heuristics. Tested in
`provider/__tests__/endpoint.test.ts`.

## Write paths

`adapterFamily` is a derived value computed when endpoint configs are
written, never at request time. One shared inference function lives at
`packages/provider-registry/src/registry-utils.ts`:

```ts
export function inferAdapterFamily(endpointType, catalogConfig?): string {
  if (catalogConfig?.adapterFamily) return catalogConfig.adapterFamily
  return ENDPOINT_TYPE_TO_DEFAULT_ADAPTER_FAMILY[endpointType] ?? 'openai-compatible'
}
```

### Endpoint-type defaults

| endpoint type | default adapter |
|---|---|
| `anthropic-messages` | `anthropic` |
| `google-generate-content` | `google` |
| `ollama-chat` / `ollama-generate` | `ollama` |
| `jina-rerank` | `jina-rerank` |
| `openai-responses` | `openai` |
| everything else | `openai-compatible` (terminal fallback) |

### Current write path

**Catalog (new installs)** — `packages/provider-registry/data/providers.json`
declares `adapterFamily` per endpoint per provider. The seeder copies it
through via `buildRuntimeEndpointConfigs`.

### Not implemented in this PR

- **v1 → v2 migration backfill** currently does not populate
  `adapterFamily`. `ProviderModelMappings.buildEndpointConfigs` only
  carries legacy base URLs and reasoning format metadata. Migrated rows
  remain schema-valid because `adapterFamily` is optional; the runtime
  resolver falls back to `openai-compatible` when it is absent.
- **UI custom provider creation** is not wired here. When added, the form
  should derive `adapterFamily` from the selected `endpointType` and
  optional catalog config instead of exposing the field directly.

## Schema

`packages/shared/data/types/provider.ts::EndpointConfigSchema`:

```ts
EndpointConfigSchema = z.object({
  baseUrl: z.string().optional(),
  adapterFamily: z.string().optional(),
  // ... other endpoint-config fields
})
```

`packages/provider-registry/src/schemas/provider.ts::RegistryEndpointConfigSchema`
mirrors this for catalog entries.

## Tests

| Target | File |
|---|---|
| `inferAdapterFamily` | `packages/provider-registry/src/__tests__/registry-utils.test.ts` |
| Runtime resolver | `src/main/ai/provider/__tests__/endpoint.test.ts` |
| `buildRuntimeEndpointConfigs` | `packages/provider-registry/src/__tests__/registry-utils.test.ts` |

## Where to read more

- This file is the canonical reference.
- Review narrative: `v2-refactor-temp/docs/ai/adapter-family.md`
- Catalog: `packages/provider-registry/data/providers.json`
