---
description: How preset provider and model registry data is loaded, normalized, seeded, and merged with user data
sources:
  - packages/provider-registry
  - src/main/data/services/ProviderRegistryService.ts
  - src/main/data/services/ModelService.ts
  - src/main/data/db/seeding
---

# Provider & Model Registry System

This document describes how Cherry Studio loads, parses, and merges provider/model preset data with user data.

## Architecture Overview

```
@cherrystudio/provider-registry (package)
├── data/
│   ├── models.json           Preset models (capabilities, pricing, modalities...)
│   ├── providers.json        Preset providers (endpoints, apiFeatures, metadata)
│   └── provider-models.json  Provider-specific model overrides (per-provider tweaks)
├── src/
│   ├── registry-loader.ts    RegistryLoader: load, validate, cache, index, idle TTL
│   ├── registry-utils.ts     Pure functions: lookupRegistryModel, buildPersistedEndpointConfigs
│   ├── utils/normalize.ts    normalizeModelId and helpers (aggregator prefix, variant suffix...)
│   └── schemas/              Zod schemas for validation
│
src/main/data/
├── db/seeding/
│   └── seeders/
│       └── presetProviderSeeder.ts   ISeeder: insert-only provider identity/auth scaffolding
├── services/
│   ├── ProviderRegistryService.ts Registry lookup and provider/model baseline resolution
│   ├── ModelService.ts            Model CRUD and user-delta application
│   └── ProviderService.ts         Provider CRUD and read-time provider merge
└── api/handlers/
    ├── models.ts                  Model CRUD, reconciliation, and registry resolution routes
    └── providers.ts               Provider CRUD and preset projection routes
```

Catalog counts intentionally are not duplicated here: the JSON files are the
source of truth and their sizes change independently of this architecture.

## Data Flow

### 1. Startup: Preset Provider Seeding

```
DbService.onInit()
  → SeedRunner.runAll(seeders)
    → PresetProviderSeeder.run(db)
      → RegistryLoader.loadProviders()     // reads providers.json
      → SELECT existing provider IDs from user_provider
      → INSERT only new provider identity/auth rows
      → Never materialize registry-owned connection config
```

`SeedRunner` reruns this seeder when the `providers.json` version changes, but
the seeder remains insert-only: an existing provider row is skipped. This is
safe because registry-owned connection config is not seeded into the row; it is
resolved from the current registry on every read. The row contains identity,
the user-owned display name, and any required auth shell.

Canonical preset providers cannot be deleted by users. Most have
`providerId === presetProviderId`; aliases/grouped presets are also protected
through a registry lookup. User-created providers that inherit from a preset
can be deleted.

### 2. On-Demand: Model Creation

```
POST /models [{ providerId: 'openai', modelId: 'gpt-4o' }]
  → handler: for each item, providerRegistryService.lookupModel(providerId, modelId)
    → RegistryLoader.findModel('gpt-4o')           // O(1) indexed, normalize fallback
    → RegistryLoader.findOverride('openai', 'gpt-4o')  // O(1) indexed
    → resolve endpoint profile from registry data   // main-only; not persisted
    → returns { presetModel, registryOverride, reasoningProfile }
  → handler: modelService.create(items)
    → mergePresetModel(preset, override, ...)
    → compare explicit DTO fields with the registry baseline
    → INSERT only differing nullable columns into user_model
  → list/get/mutation response
    → rebuild current registry baseline
    → apply every non-null sparse column
```

### 3. Resolve SDK Model List

```
GET /providers/:providerId/models:resolve?ids=gpt-4o&ids=o3
  → providerRegistryService.resolveModels(providerId, modelIds)
    → For each modelId:
        → RegistryLoader.findModel(modelId)         // O(1), normalize fallback
        → RegistryLoader.findOverride(providerId, modelId)  // O(1)
        → mergePresetModel(preset, override, ...) or createCustomModel(...)
    → Return merged Model[]

SDK only provides model IDs. All other data (capabilities, pricing, etc.)
comes from the registry — SDK data does not overwrite curated registry data.
```

## Merge Functions

Three separate functions for three distinct use cases:

| Function | Use Case | Layers |
|----------|----------|--------|
| `mergePresetModel` | Registry queries, resolveModels | preset → override |
| `applyUserOverlay` | Model reads with explicit user deltas | merged registry baseline → user |
| `createCustomModel` | No registry match | modelId only |

Shared logic extracted to `applyPresetAndOverride` (preset + override merge) and `resolveReasoning` (reasoning config resolution).

### Priority

```
non-null sparse columns  >  provider-models.json  >  models.json
        highest                  middle                  lowest
```

For preset-backed rows, each nullable model-config column is its own ownership
marker: null inherits the registry, while any non-null value is a user delta.
Custom rows store their complete config. This lets catalog changes reach
existing rows without a data migration. Explicit empty strings and arrays
remain valid overrides.

### User Override Protection

When a user changes a registry-enrichable field (for example `name`), the value
is stored directly in that nullable column. Read-time resolution starts from
the current registry and applies every non-null column. Create/PATCH compare
incoming values with the current registry baseline, so renderer echoes do not
freeze catalog values; restoring a value to the baseline clears the column.

**Adding a model field later:**

- *Registry-owned (not user-editable):* add it to the registry schema, runtime
  `Model`, and `mergePresetModel`. Do not add a `user_model` column or
  persisted delta. Existing preset rows receive it on their next read with zero
  schema migration or data backfill.
- *User-editable preset field:* give it a nullable delta column, include it in
  the create/PATCH overlay mapping and the preset-delta field set. A schema
  migration adds the column, but existing rows need no data backfill: null
  means inherit the current registry value.
- *Custom-model field:* custom rows own complete configuration. A newly
  required custom field needs either a runtime default or a custom-row
  backfill; this is the intentional exception to the preset inheritance rule.
- A column shared by custom and preset rows may therefore be required for
  custom rows while remaining null for preset rows (for example
  `capabilities` and `reasoning`).

## RegistryLoader

Cached, indexed access to registry JSON with idle auto-expiry.

### Lifecycle

- **Lazy load**: Data loaded on first access (not at startup)
- **Pre-computed indexes**: Model and override indexes are built on first load for O(1) lookups
- **Idle TTL**: Auto-invalidates after 30s of no access
- **Touch on access**: Every `findModel/findOverride/loadModels` resets the timer
- **Service-scoped cache**: `ProviderRegistryService` shares one loader across its queries; the provider seeder creates its own loader

### Indexes

| Index | Key | Use |
|-------|-----|-----|
| `modelById` | `model.id` | Exact model lookup |
| `modelByNormId` | `normalizeModelId(id)` | Normalized fallback |
| `modelBySizedNorm` | Size-preserving normalized model ID | Resolve tagged parameter-size variants |
| `overrideByKey` | `providerId::modelId` | Exact override lookup |
| `overrideByNormKey` | `providerId::normalizeModelId(id)` | Normalized fallback |
| `overrideByApiKey` | `providerId::apiModelId` | Exact provider-facing model ID lookup |
| `overrideByNormApiKey` | `providerId::normalizeModelId(apiModelId)` | Normalized provider-facing fallback |
| `overridesByProvider` | `providerId` | All overrides for a provider |

### Query API

```typescript
loader.findModel(modelId)                    // O(1): exact → normalized fallback
loader.findOverride(providerId, modelId)     // O(1): exact → normalized fallback
loader.getOverridesForProvider(providerId)   // O(1): grouped by provider
loader.invalidate()                          // Release all data, reload on next access
```

## Model ID Normalization

User-facing model IDs from different providers often differ from registry canonical IDs:

| User sees | Registry has | Normalization |
|-----------|-------------|---------------|
| `aihubmix-gpt-4o` | `gpt-4o` | Strip aggregator prefix |
| `gpt-4o:free` | `gpt-4o` | Strip variant suffix |
| `claude-3.5-sonnet` | `claude-3-5-sonnet` | Normalize version separator |
| `aihubmix-gpt-4o:free` | `gpt-4o` | Combined |

Implemented in `normalizeModelId()` (`packages/provider-registry/src/utils/normalize.ts`):

```
1. Strip provider prefix (e.g., "anthropic/claude-3" → "claude-3")
2. Lowercase
3. Strip aggregator prefixes (aihubmix-, zai-, siliconflow-, ...)
4. Expand known abbreviations (mm- → minimax-)
5. Strip variant suffixes (:free, -thinking, (beta), ...)
6. Strip parameter size (-72b, -7b, ...)
7. Normalize version separators (3.5 → 3-5, 3p5 → 3-5)
```

**Lookup strategy**: Exact match first, normalized fallback second. This ensures that if both `gpt-4o` and `aihubmix-gpt-4o` exist as separate entries, exact match wins.

## Key Database Tables

### user_provider

| Column | Purpose |
|--------|---------|
| `providerId` | PK, user-defined unique ID |
| `presetProviderId` | Links to a providers.json entry (null = custom provider). Dual-purpose: identifies the source preset *and* the sidebar grouping key — for a few registry rows (e.g. `zai`→`zhipu`, `minimax-global`→`minimax`) it points at a different preset so they fold under that group. |
| `name` | User-owned display name, initialized from the preset when the row is first seeded |
| `endpointConfigs` | JSON delta: user `baseUrl` overrides; custom providers may also store an `adapterFamily` routing hint |
| `defaultChatEndpoint` | Nullable user override; null inherits the registry default |
| `apiKeys` | JSON array of API key entries |
| `apiFeatures` | JSON delta: only flags differing from registry/app defaults; null inherits all defaults |

### user_model

| Column | Purpose |
|--------|---------|
| `id` | Deterministic PK: `providerId::modelId` |
| `providerId` + `modelId` | Unique model identity within a provider |
| `presetModelId` | Links to models.json entry (null = custom model) |
| `name` / `capabilities` / `supportsStreaming` | Required for custom rows; nullable preset deltas |
| `inputModalities` / `outputModalities` | Complete custom config or nullable preset deltas |
| `contextWindow` / `maxOutputTokens` | Complete custom config or nullable preset deltas |
| `reasoning` | Custom-model intrinsic controls/token limits; preset rows resolve it from the registry |
| `pricing` | Complete custom config or nullable preset delta |
| `parameters` | Complete custom config or nullable preset delta |
| `orderKey` | Fractional order key in the provider's model list |
| `notes` | User notes about this model |

## Provider Configuration Merge

Provider connection config follows the same layered, read-time merge as
models. The `user_provider` row is a **delta**: it stores only what the user
explicitly set; key absence means "use the registry value". The merge happens
in `rowToRuntimeProvider` (ProviderService) via
`ProviderRegistryService.mergeEndpointConfigs` / `getProviderDisplayMetadata`:

```
user_provider (DB, delta)  >  providers.json (registry)  >  app defaults
```

| field | ownership | resolution |
| --- | --- | --- |
| `endpointConfigs[ep].baseUrl` | user | row > registry |
| `endpointConfigs[ep].adapterFamily` | registry | registry > row (custom-provider hint) > `inferAdapterFamily(ep)` |
| `endpointConfigs[ep].modelsApiUrls` | registry | registry only |
| endpoint-type key set | registry ∪ user | union of registry and row keys |
| `apiFeatures` | mixed | `{...DEFAULT_API_FEATURES, ...registry, ...row}` |
| `defaultChatEndpoint` | mixed | row > registry |

Because registry-owned facts are never frozen into rows, registry updates
(new endpoint types, changed adapter families, base URLs, feature flags, or
default endpoints) reach rows created under this delta contract with **zero
data migration** (#17096). Write paths enforce the delta:
`EndpointConfigOverride` is the only persistable endpoint shape, and PATCH
normalization drops values equal to the registry baseline.

For example, an untouched preset `baseUrl` is absent from the row. If the
provider changes that URL in `providers.json`, the next read returns the new
URL. A user-defined proxy URL remains in the row and continues to win until the
user resets it to the current registry value.

The provider `name` is intentionally different: it is a user-owned, complete
value initialized during seeding, not a registry delta. A later registry rename
does not replace it. If product semantics change to "inherit until renamed",
`name` must first be converted to an explicit delta representation.

### When Backfill Is Required

Registry content updates do not require a backfill when the storage ownership
contract is unchanged:

- Registry-only fields are resolved directly at read time.
- Mixed fields such as `baseUrl`, `apiFeatures`, and
  `defaultChatEndpoint` inherit when their row delta is absent.
- Existing user overrides intentionally keep winning; they are not stale data.
- New registry-owned fields should be added to the read-time projection, not
  persisted.

A schema migration may still be needed to add storage for a newly
user-editable field, but preset rows need no data backfill when null/absence
means "inherit". Backfill is required only when a complete custom row gains a
new required field without a runtime default, or when an existing field changes
ownership from full snapshot to delta and old databases must be preserved.

**Adding a registry field later:**

- *Registry-owned (not user-editable):* add it to the read-time merge output
  only. For endpoint config fields, do not add it to
  `EndpointConfigOverride` — zod strips it from write DTOs automatically.
  Zero migration.
- *User-editable endpoint field (mixed ownership):* add it to
  `EndpointConfigOverrideSchema` (the `keyof` set is the authoritative
  ownership declaration), add a `row.x ?? registry.x` rule to the merge, and
  optionally drop baseline-equal values on write. Zero migration — absent
  keys fall back to the registry.
- *User-editable provider field:* if it belongs in an existing JSON delta such
  as `apiFeatures`, extend that schema and merge rule with zero migration.
  Otherwise choose an explicit persisted override home. A new standalone
  column is a schema change, but nullable preset-delta columns still require no
  value backfill. This design does not make arbitrary top-level fields
  migration-free.
- Never persist registry-owned values as row snapshots: that is exactly how a
  registry update becomes stale.

## Reasoning Configuration

Reasoning is split across two boundaries:

- **Model data** declares intrinsic controls and token limits. Main-process registry enrichment projects these into the runtime-only `selectableEfforts` consumed by renderer controls.
- **Provider registry data** declares a closed `reasoningFormat` wire profile. It is resolved and interpreted in Main only; it is never copied into SQLite, DataApi, or renderer state.

The request path resolves one profile from exact provider-model, endpoint override/default, then exhaustive format defaults. It combines that profile with the submit-time canonical selection and emits either native AI SDK provider options or generic compatible parameters.

See [Reasoning Control](../../../packages/provider-registry/docs/reasoning-control.md) for the schemas, precedence rules, and UI-to-request data flow.

## File Locations

| What | Where |
|------|-------|
| Registry JSON data | `packages/provider-registry/data/` |
| Zod schemas | `packages/provider-registry/src/schemas/` |
| RegistryLoader (load, index, TTL) | `packages/provider-registry/src/registry-loader.ts` |
| Pure lookup/transform | `packages/provider-registry/src/registry-utils.ts` |
| Normalize utilities | `packages/provider-registry/src/utils/normalize.ts` |
| Seed runner | `src/main/data/db/seeding/SeedRunner.ts` |
| Preset provider seeding | `src/main/data/db/seeding/seeders/presetProviderSeeder.ts` |
| Service (merge queries) | `src/main/data/services/ProviderRegistryService.ts` |
| Model service | `src/main/data/services/ModelService.ts` |
| Provider service | `src/main/data/services/ProviderService.ts` |
| Registry/model baseline merge | `src/main/data/services/ProviderRegistryService.ts` |
| User model delta overlay | `src/main/data/services/ModelService.ts` |
| DB schemas | `src/main/data/db/schemas/userModel.ts`, `userProvider.ts` |
