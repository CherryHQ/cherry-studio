# Adapter Family

`adapterFamily` is the optional field on each `EndpointConfig` that picks
the `@ai-sdk/*` package implementing that endpoint's protocol. The runtime
resolver reads it; the catalog seeder and the v1→v2 migrator write it. The
schema declares it `optional`, and the resolver has a total fallback
(`openai-compatible`) for endpoints that omit it — so no write path is
obligated to set it.

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

### Write paths

Only two paths write `adapterFamily`; both run in the **main** process at
row-write time:

1. **Catalog (new installs)** — `packages/provider-registry/data/providers.json`
   declares `adapterFamily` per endpoint per provider. The seeder copies
   it through via `buildRuntimeEndpointConfigs`.
2. **v1 → v2 migration (existing users)** —
   `src/main/data/migration/v2/migrators/mappings/ProviderModelMappings.ts`
   looks up the catalog by legacy id and, on a miss, calls
   `inferAdapterFamily(endpointType)` for the endpoint-type default
   (`ProviderModelMigrator.ts` carries a preset's `adapterFamily` forward
   on merge). The `ANTHROPIC_MESSAGES` endpoint skips the legacy-type hint
   because v1 custom anthropic relays carried `legacy.type='openai'` even
   when the endpoint was anthropic-format.

The renderer's custom-provider form does **not** set `adapterFamily`:
`ProviderEditorDrawer.tsx` writes only `baseUrl` into the endpoint config,
leaving the field absent so the resolver's `openai-compatible` fallback
applies. `inferAdapterFamily` has **no renderer callers** — it is invoked
only by the migrator above.

## Schema

`src/shared/data/types/provider.ts::EndpointConfigSchema`:

```ts
EndpointConfigSchema = z.object({
  baseUrl: z.string().optional(),
  adapterFamily: z.string().optional(),   // optional — resolver falls back to openai-compatible
  // ... other endpoint-config fields
})
```

`packages/provider-registry/src/schemas/provider.ts::RegistryEndpointConfigSchema`
mirrors this for catalog entries.

## Tests

| Target | File | Cases |
|---|---|---|
| `inferAdapterFamily` | `packages/provider-registry/src/__tests__/registry-utils.test.ts` | 5 |
| Migrator backfill | `src/main/data/migration/v2/migrators/mappings/__tests__/ProviderModelMappings.test.ts` | 4 |
| Runtime resolver | `src/main/ai/provider/__tests__/endpoint.test.ts` | 54 |
| `buildRuntimeEndpointConfigs` | `packages/provider-registry/src/__tests__/registry-utils.test.ts` | 10 |

## Where to read more

- Runtime usage: [Provider Resolution](./provider-resolution.md)
- Catalog: `packages/provider-registry/data/providers.json`
