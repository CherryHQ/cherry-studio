# Adapter Family

`adapterFamily` is the field on every `EndpointConfig` that picks the
`@ai-sdk/*` package implementing that endpoint's protocol. The runtime
resolver reads it; UI and migrator code derive it; the schema enforces
its presence.

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

One signal, no heuristics. Tested with 54 cases in
`provider/__tests__/endpoint.test.ts`.

## Write paths

`adapterFamily` is a derived value computed at row-write time, never at
request time. One shared inference function lives at
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

### Three write paths

1. **Catalog (new installs)** — `packages/provider-registry/data/providers.json`
   declares `adapterFamily` per endpoint per provider. The seeder copies
   it through via `buildRuntimeEndpointConfigs`.
2. **v1 → v2 migration (existing users)** —
   `src/main/data/migration/v2/migrators/mappings/ProviderModelMappings.ts::buildEndpointConfigs`
   looks up the catalog by legacy id, falls back to legacy
   `provider.type`, finally to the endpoint-type default. The
   `ANTHROPIC_MESSAGES` endpoint skips the legacy-type hint because v1
   custom anthropic relays carried `legacy.type='openai'` even when the
   endpoint was anthropic-format.
3. **UI custom provider creation** — the form calls
   `inferAdapterFamily(userPickedEndpoint, catalogConfigIfAny)`. The
   user never picks `adapterFamily` directly — they pick
   `endpointType` from a dropdown, which determines the family.

## Schema

`packages/shared/data/types/provider.ts::EndpointConfigSchema`:

```ts
EndpointConfigSchema = z.object({
  baseUrl: z.string(),
  adapterFamily: z.string(),       // required
  // ... other endpoint-config fields
})
```

`packages/provider-registry/src/schemas/provider.ts::RegistryEndpointConfigSchema`
mirrors this for catalog entries.

## Tests

| Target | File | Cases |
|---|---|---|
| `inferAdapterFamily` | `packages/provider-registry/src/__tests__/registry-utils.test.ts` | 5 |
| Migrator backfill | `src/main/data/migration/v2/migrators/mappings/__tests__/ProviderModelMappings.test.ts` | 9 |
| Runtime resolver | `src/main/ai/provider/__tests__/endpoint.test.ts` | 54 |
| `buildRuntimeEndpointConfigs` | `packages/provider-registry/src/__tests__/registry-utils.test.ts` | 9 |

## Where to read more

- Reviewer narrative (why this design): `v2-refactor-temp/docs/ai/adapter-family.md`
- Runtime usage: [Provider Resolution](./provider-resolution.md)
- Catalog: `packages/provider-registry/data/providers.json`
