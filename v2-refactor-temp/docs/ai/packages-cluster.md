# Packages — Reviewer Cluster

## Scope

| Package | Files | Role |
|---|---|---|
| `packages/aiCore/` | `core/providers/core/ProviderExtension.ts`, `core/runtime/types.ts` | Cherry's AI SDK wrapper — `ProviderExtension`, `RuntimeExecutor`, `PluginEngine`, `ExtensionRegistry`, `toolFactories` |
| `packages/provider-registry/` | `data/providers.json`, `src/registry-utils.ts`, `src/registry-loader.ts`, `src/schemas/provider.ts`, `src/patterns/vendor-patterns.ts`, `src/index.ts` | Provider catalog (data) + utils that derive `adapterFamily` |
| `packages/shared/aiCore/provider/utils/` | `api.ts`, `index.ts`, `types.ts` | Shared provider helpers consumed by both renderer (legacy paths) and Main |
| `packages/shared/data/` | `api/schemas/providers.ts`, `types/provider.ts` | Provider + EndpointConfig schemas |
| `packages/shared/utils/` | `provider.ts`, `providerTopology.ts` | Provider predicate / topology helpers (lifted from renderer; see commit `c75b08597 refactor(provider-utils): unify ProviderSettings predicate fork into @shared`) |

## Intent

The package layer carries the contracts the rest of the codebase
consumes. v2 changes here are mostly:

1. Adding `adapterFamily` to the `EndpointConfig` schema everywhere
   (catalog schema, runtime schema, helpers).
2. Lifting provider-shape predicates out of the renderer into
   `@shared/utils` so Main can use the same checks.
3. The `ProviderExtension` upgrade for `toolFactories` (per-capability
   factory functions) and the resulting `ExtensionRegistry.resolveToolCapability`
   path used by the `providerToolPlugin`.

## Key changes

### `packages/aiCore`

#### `core/providers/core/ProviderExtension.ts`

Adds `toolFactories: ToolFactoryMap<TProvider>` to
`ProviderExtensionConfig`. Each entry is `(provider) => (config) =>
ToolFactoryPatch`. The patch carries `tools` and/or `providerOptions`,
so a single capability (e.g. `webSearch`) can produce multi-tool
patches (xAI's webSearch + xSearch) or non-tool patches (OpenRouter's
`providerOptions`).

`ExtractToolConfig<TExt, K>` extracts the config type from the
declaration; `WebSearchToolConfigMap` is auto-generated from
`coreExtensions`. Result: per-provider webSearch config typing is
inferred from the extension declaration — UI form fields can be
strongly typed against the per-vendor shape.

See the core architecture's
[Tool capability resolution](../../../docs/references/ai/core-architecture.md#43-extension-registry).

#### `core/runtime/types.ts`

Small type-only changes — `StringKeys<T>` helper export, runtime
parameter shape adjustments.

### `packages/provider-registry`

#### `data/providers.json`

Per-provider, per-endpoint `adapterFamily` field added across the
catalog. Audit: 100% of entries have `adapterFamily` on every endpoint.

#### `src/schemas/provider.ts`

`RegistryEndpointConfigSchema.adapterFamily: z.string()`. Schema
validates the catalog at load time; missing `adapterFamily` fails fast.

#### `src/registry-utils.ts`

- `inferAdapterFamily(endpointType, catalogConfig?)` — the single source
  of truth for derivation. Catalog wins; otherwise endpoint-type default
  table; otherwise `'openai-compatible'`.
- `buildRuntimeEndpointConfigs(...)` — copies `adapterFamily` through
  the catalog → runtime endpoint config transformation.
- `lookupRegistryModel` / `lookupRegistryProvider` — name lookup helpers
  used by the migrator.

#### `src/registry-loader.ts`

Three-layer cache (mtime, v8.serialize, O(1) lookup) — see memory:
[Registry perf plan](../../../). Hot on app boot; matters because
migrations also call `findProvider(id)` per row.

#### `src/patterns/vendor-patterns.ts`

Vendor capability inference patterns. Added entries for new providers.

### `packages/shared/data/types/provider.ts`

`EndpointConfigSchema.adapterFamily: z.string()` — the runtime
counterpart of the registry schema. Loaded provider rows must have
`adapterFamily` per endpoint; absent rows fail schema parsing.

`DEFAULT_API_FEATURES` — runtime defaults for the per-provider features
section.

### `packages/shared/utils/provider.ts` + `providerTopology.ts`

Moved out of the renderer in commits:

- `c75b08597 refactor(provider-utils): unify ProviderSettings predicate fork into @shared`
- `ae3306305 refactor(blacklist-pattern): move blacklistMatchPattern to @shared, drop main port`
- `617a17509 refactor(store-migrate): inline 3 predicates, delete dead v1 @renderer/utils/provider`

Predicates: `isOpenAIProvider`, `isAnthropicProvider`, etc. Topology
helpers: walk model lists by capability, find default chat endpoint.

### `packages/shared/aiCore/provider/utils/`

Provider configuration helpers used by both Main and (legacy) renderer
during transition. `api.ts` carries common host-normalisation logic.

## Invariants

- `adapterFamily` is REQUIRED on every endpoint config — schema
  enforced, no implicit defaults at runtime.
- `inferAdapterFamily` is the only function allowed to compute
  adapterFamily; UI forms / migrators / seeders all call it.
- `ProviderExtension`'s `toolFactories` registrations are declared
  `as const satisfies ProviderExtensionConfig<...>` so the config type
  flows through correctly. Skipping this loses inference.

## Validation

- `packages/provider-registry/src/__tests__/registry-utils.test.ts` —
  catalog wins, endpoint defaults, openai-compatible terminal fallback,
  dual schema acceptance (5 cases) + `buildRuntimeEndpointConfigs`
  passthrough (9 cases).
- `packages/aiCore` test suite (provider extension cache + tool
  resolution).
- Renderer / Main consumers test the resolver behaviour at their level
  (see [provider-cluster.md](./provider-cluster.md)).

## Follow-ups (out of scope)

- `packages/aiCore` test infrastructure could lift to share with
  Main-side test helpers (`@cherrystudio/ai-core/test_utils` already
  exists — coverage of variant resolution edge cases).
- Some renderer-only `@renderer/utils/provider` files still exist; the
  inlining chain (commits `617a17509`, `ae3306305`) covers most but a
  final pass is pending.
