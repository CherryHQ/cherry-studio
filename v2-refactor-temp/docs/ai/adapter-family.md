# Adapter Family — single source of truth for AI SDK routing

Canonical reference: `docs/references/ai/adapter-family.md`. This
review narrative must stay aligned with the current PR state.

## What this fixes

Cherry Studio routes every AI request to one of ~26 "adapters" — each adapter is an `@ai-sdk/*` package (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google-vertex`, …) that knows the request format, streaming codec, capability matrix, and per-vendor tools (`webSearch_20250305`, `googleSearch`, `responses` API …). Picking the wrong adapter means sending OpenAI-shape JSON to an Anthropic-protocol endpoint and getting nonsense back.

The v1 resolver picked an adapter by inferring from `provider.id`, `provider.type`, and the `apiHost` string. That worked when a provider had **one** API endpoint. It broke for **multi-endpoint relays**: MiniMax, Silicon, AiHubMix etc. expose both an openai-chat-completions URL **and** an anthropic-messages URL under the same `provider.id`. The same provider needs two different adapters depending on which URL the call is going to.

The most visible symptom: `<think>` tags leaking into translate output. The relay's anthropic-messages endpoint received an OpenAI-formatted request, didn't recognise the `reasoning` field, and echoed it back as plain text.

## The design — `adapterFamily` per endpoint

Endpoint configs may carry an `adapterFamily: string`. Resolver reads only
that when present; missing or unknown values fall back to
`openai-compatible` because legacy and hand-written rows can exist without
the field.

```ts
// src/main/ai/provider/endpoint.ts — entire production resolver
export function resolveAiSdkProviderId(provider, endpointType) {
  const adapterFamily = endpointType ? provider.endpointConfigs?.[endpointType]?.adapterFamily : undefined
  if (adapterFamily && adapterFamily in appProviderIds) {
    return resolveProviderVariant(appProviderIds[adapterFamily], endpointType)
  }
  return appProviderIds['openai-compatible']
}
```

Six lines, one signal, zero heuristics. The full identity stack:

| layer | example | role |
|---|---|---|
| `provider.id` | `minimax`, `silicon`, `my-relay` | User-facing identity, UI label, routing key |
| `endpointType` | `openai-chat-completions`, `anthropic-messages` | URL path template + protocol family |
| `adapterFamily` | `openai-compatible`, `anthropic`, `azure-responses` | **Which `@ai-sdk/*` package implements this protocol** |

For MiniMax-style relays, `provider.id='minimax'` while the two endpoints carry `adapterFamily='openai-compatible'` and `adapterFamily='anthropic'` respectively — same identity, different adapters per endpoint.

## Where the value comes from

`adapterFamily` is a **write-time derived value**. The shared inference function is:

```ts
// packages/provider-registry/src/registry-utils.ts
export function inferAdapterFamily(endpointType, catalogConfig?): string {
  if (catalogConfig?.adapterFamily) return catalogConfig.adapterFamily
  return ENDPOINT_TYPE_TO_DEFAULT_ADAPTER_FAMILY[endpointType] ?? 'openai-compatible'
}
```

The endpoint-type defaults are protocol-derived (any anthropic-messages endpoint needs the anthropic adapter, period):

| endpoint type | default adapter |
|---|---|
| `anthropic-messages` | `anthropic` |
| `google-generate-content` | `google` |
| `ollama-chat` / `ollama-generate` | `ollama` |
| `jina-rerank` | `jina-rerank` |
| `openai-responses` | `openai` |
| `openai-chat-completions` and others | `openai-compatible` (terminal fallback) |

### Path 1 — Catalog (new installs)

`packages/provider-registry/data/providers.json` declares `adapterFamily` per endpoint per provider. The seeder copies it through via `buildRuntimeEndpointConfigs`:

```jsonc
{
  "id": "silicon",
  "endpointConfigs": {
    "openai-chat-completions": { "baseUrl": "...", "adapterFamily": "openai-compatible" },
    "anthropic-messages":      { "baseUrl": "...", "adapterFamily": "anthropic" }
  }
}
```

This covers every provider in the catalog (audited: 100% of catalog entries have `adapterFamily` on every endpoint).

### Path 2 — v1 → v2 migration (not implemented in this PR)

`src/main/data/migration/v2/migrators/mappings/ProviderModelMappings.ts`
currently does not backfill `adapterFamily`. It carries legacy base URLs
and reasoning format metadata only. Migrated rows remain schema-valid
because `adapterFamily` is optional; runtime resolution falls back to
`openai-compatible` when the field is absent.

If migration backfill is added later, it should use catalog values first,
then endpoint-type defaults, and add dedicated migrator tests before this
section is changed back to an implemented path.

### Path 3 — UI custom provider creation (future)

When the future provider-add UI lets users enter a baseUrl, the form submission calls `inferAdapterFamily(userPickedEndpoint, catalogConfigIfAny)` and writes the result alongside the baseUrl. **The user never picks `adapterFamily` directly** — it's a derived value from `(endpointType, optional catalog preset)`. The function is one shared import; UI wiring is one line.

## Code locations

| File | Role |
|---|---|
| `packages/provider-registry/data/providers.json` | Catalog: `adapterFamily` per endpoint per provider |
| `packages/provider-registry/src/schemas/provider.ts` | `RegistryEndpointConfigSchema.adapterFamily` |
| `packages/provider-registry/src/registry-utils.ts` | `inferAdapterFamily` (single source of truth) + `buildRuntimeEndpointConfigs` (carries field through) |
| `packages/shared/data/types/provider.ts` | Runtime `EndpointConfigSchema.adapterFamily` |
| `src/main/data/db/seeding/seeders/presetProviderSeeder.ts` | New-install write path |
| `src/main/ai/provider/endpoint.ts` | Runtime resolver — reads `adapterFamily`, applies variant suffix |

## Alternatives considered

### A. Keep the heuristic resolver chain

Original v2 resolver had ~40 lines of fallbacks: Azure detection by `provider.id`/`presetProviderId`, grok special-case, `provider.id ∈ appProviderIds`, `presetProviderId ∈ appProviderIds`, `api.openai.com` baseUrl sniffing, `ANTHROPIC_MESSAGES → anthropic` final guard. Worked for the typed cases but:

- Wrong choice for MiniMax-style relays (the bug we hit)
- Every new vendor required a new branch
- The "correct" answer was already in the catalog data, just thrown away by the schema

Rejected because the catalog already encodes the answer per endpoint; reading it is strictly more accurate than re-deriving.

### B. Runtime catalog lookup

Resolver could call `RegistryLoader.findProvider(provider.id)` on every request and look up `adapterFamily` from the catalog. Rejected because:

- Adds a registry dep to the hot path of every LLM call
- Doesn't handle custom (no-catalog-match) providers — would still need a fallback chain
- The value is stable for the lifetime of the row; computing once at write time is strictly cheaper

### C. Infer from `endpointType` only at runtime

Resolver could fall back to `inferAdapterFamily(endpointType)` directly when `provider.endpointConfigs[ep].adapterFamily` is missing. Rejected because:

- Loses vendor-specific routing the catalog encodes (`aihubmix`'s anthropic endpoint uses `adapterFamily='aihubmix'`, not the generic `anthropic` default — the relay does its own multi-vendor routing internally)
- Makes the resolver responsible for inference logic that belongs at write time
- Splits the "what's the right adapter" decision across two files

Keeping inference at write time means catalog updates (e.g. a new entry adds `adapterFamily`) take effect for new installs and any future write path without changing the runtime resolver.

### D. Expose `adapterFamily` in the provider-add UI

User picks adapter family from a dropdown when creating a custom provider. Rejected because:

- The concept is implementation detail (which `@ai-sdk/*` package to import); users care about "which API protocol does my URL speak"
- `endpointType` already captures that question — the user picks `anthropic-messages` or `openai-chat-completions` from a dropdown, which implies the adapter
- Two dropdowns for the same conceptual choice doubles user confusion

UI exposes endpoint type; the system derives adapter family from it.

## Validation

| target | how |
|---|---|
| `inferAdapterFamily` | `packages/provider-registry/src/__tests__/registry-utils.test.ts` — catalog wins, endpoint defaults, openai-compatible terminal fallback, dual schema acceptance |
| Resolver | `src/main/ai/provider/__tests__/endpoint.test.ts` — catalog adapterFamily routing, variant suffix application (base `openai` → `openai-chat`, already-variant `azure-responses` idempotent), MiniMax-style relay regression (the original bug), unknown-family degradation |
| `buildRuntimeEndpointConfigs` | `packages/provider-registry/src/__tests__/registry-utils.test.ts` — adapterFamily passthrough, retention rule |

## Database migration

None required. `endpoint_configs` is a JSON text column (`src/main/data/db/schemas/userProvider.ts:39`); the new field is JSON-shape-internal. Per CLAUDE.md "Schemas and drizzle SQL are throwaway", mid-development DB drift is acceptable anyway.

## Test fixtures

Centralised `Provider` / `Model` / `Assistant` factories live at `src/main/ai/__tests__/fixtures/` (`makeProvider`, `makeModel`, `makeAssistant`). Current main AI provider tests reuse them instead of carrying local provider/model fixture shapes.

The fixtures live with the consumers (`src/main/ai/`) rather than next to the schema (`packages/shared/data/types/`) — present-tense rule: there's no non-`src/main/ai/` consumer yet. Easy to lift later if one appears.
