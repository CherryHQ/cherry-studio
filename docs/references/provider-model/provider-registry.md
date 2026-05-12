# Provider & Model Registry System

This document describes how Cherry Studio loads, parses, and merges provider/model preset data with user data.

## Architecture Overview

```
@cherrystudio/provider-registry (package)
├── data/
│   ├── models.json           2525 preset models (capabilities, pricing, modalities...)
│   ├── providers.json        63 preset providers (endpoints, apiFeatures, metadata)
│   └── provider-models.json  Provider-specific model overrides (per-provider tweaks)
├── src/
│   ├── registry-loader.ts    RegistryLoader: load, validate, cache, index, idle TTL
│   ├── registry-utils.ts     Pure functions: lookupRegistryModel, buildRuntimeEndpointConfigs
│   ├── utils/normalize.ts    normalizeModelId and helpers (aggregator prefix, variant suffix...)
│   └── schemas/              Zod schemas for validation
│
src/main/data/
├── db/seeding/
│   └── presetProviderSeeding.ts   ISeed: insert-only preset providers on first boot
├── services/
│   ├── ProviderRegistryService.ts Merge-dependent queries (resolve, lookup)
│   ├── ModelService.ts            Model CRUD, accepts registry lookup from handler
│   └── ProviderService.ts         Provider CRUD, preset deletion protection
└── api/handlers/
    ├── models.ts                  POST /models: accepts model arrays, does registry lookup, passes to service
    └── providers.ts               Registry model resolution endpoint
```

## Data Flow

### 1. Startup: Preset Provider Seeding

```
DbService.onInit()
  → migrateSeed('presetProvider')
    → PresetProviderSeed.migrate(db)
      → RegistryLoader.loadProviders()     // reads providers.json
      → SELECT existing provider IDs from user_provider
      → INSERT only new providers (not already in DB)
      → Never overwrites user customizations
```

**Key behavior**: Insert-only. If provider already exists in DB, skip it. Canonical preset providers (where `providerId === presetProviderId`) cannot be deleted by users. User-created providers that inherit from a preset can be deleted.

### 2. On-Demand: Model Creation

```
POST /models [{ providerId: 'openai', modelId: 'gpt-4o' }]
  → handler: for each item, providerRegistryService.lookupModel(providerId, modelId)
    → RegistryLoader.findModel('gpt-4o')           // O(1) indexed, normalize fallback
    → RegistryLoader.findOverride('openai', 'gpt-4o')  // O(1) indexed
    → getEffectiveReasoningConfig(providerId)       // DB query for user provider overrides
    → returns { presetModel, registryOverride, reasoningFormatTypes, defaultChatEndpoint }
  → handler: modelService.create(items)
    → mergeModelWithUser(userRow, override, preset, providerId, ...)
    → INSERT into user_model with presetModelId = preset.id
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
| `mergeModelWithUser` | ModelService.create with registry match | preset → override → user |
| `createCustomModel` | No registry match | modelId only |

Shared logic extracted to `applyPresetAndOverride` (preset + override merge) and `resolveReasoning` (reasoning config resolution).

### Priority

```
user_model (DB)  >  provider-models.json (override)  >  models.json (preset)
   highest                  middle                         lowest
```

Null user fields fall through to preset/override values — they do not clobber.

### User Override Protection

`ModelService.batchUpsert()` respects a `userOverrides` field on each `user_model` row. When a user manually edits a field (e.g., changes `name`), that field name is recorded in `userOverrides`. During enrichment, fields in `userOverrides` are skipped — the user's customization is preserved even when registry data updates.

## RegistryLoader

Cached, indexed access to registry JSON with idle auto-expiry.

### Lifecycle

- **Lazy load**: Data loaded on first access (not at startup)
- **Pre-computed indexes**: 5 Maps built on first load for O(1) lookups
- **Idle TTL**: Auto-invalidates after 30s of no access, releasing ~6MB memory
- **Touch on access**: Every `findModel/findOverride/loadModels` resets the timer
- **Singleton**: One instance per `ProviderRegistryService`, shared across queries

### Indexes

| Index | Key | Use |
|-------|-----|-----|
| `modelById` | `model.id` | Exact model lookup |
| `modelByNormId` | `normalizeModelId(id)` | Normalized fallback |
| `overrideByKey` | `providerId::modelId` | Exact override lookup |
| `overrideByNormKey` | `providerId::normalizeModelId(id)` | Normalized fallback |
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
| `presetProviderId` | Links to providers.json entry (null = custom provider) |
| `name` | Display name |
| `endpointConfigs` | JSON: per-endpoint baseUrl, reasoningFormatType |
| `defaultChatEndpoint` | Default endpoint type for chat |
| `apiKeys` | JSON array of API key entries |
| `apiFeatures` | JSON: arrayContent, streamOptions, etc. (null = use defaults) |

### user_model

| Column | Purpose |
|--------|---------|
| `providerId` + `modelId` | Composite PK |
| `presetModelId` | Links to models.json entry (null = custom model) |
| `capabilities` | JSON array: function-call, reasoning, image-recognition, ... |
| `inputModalities` / `outputModalities` | JSON array: text, image, audio, video |
| `contextWindow` / `maxOutputTokens` | Numeric limits |
| `reasoning` | JSON: type, supportedEfforts, thinkingTokenLimits |
| `pricing` | JSON: input/output/cacheRead/cacheWrite per million tokens |
| `parameters` | JSON: parameter support config (temperature, topP, etc.) |
| `userOverrides` | JSON array of field names user has manually edited |
| `sortOrder` | Sort order in provider's model list |
| `notes` | User notes about this model |

## Provider Configuration Merge

Provider configs also follow a layered merge (`mergeProviderConfig()`):

```
user_provider (DB)  >  providers.json (preset)  >  DEFAULT_API_FEATURES
```

```typescript
const apiFeatures = {
  ...DEFAULT_API_FEATURES,        // { arrayContent: true, streamOptions: true, ... }
  ...presetProvider?.apiFeatures,  // from providers.json (null = use defaults)
  ...userProvider?.apiFeatures     // user customization wins
}
```

## Reasoning Configuration

Reasoning config combines model-level and provider-level data:

- **Model level** (models.json): `supportedEfforts`, `thinkingTokenLimits` — what the model supports
- **Provider level** (providers.json → endpointConfigs → reasoningFormat): `reasoningFormatType` — how the provider's API expects reasoning params

At merge time:
```typescript
const reasoningFormatType = resolveReasoningFormatType(
  endpointTypes,           // from override or user
  defaultChatEndpoint,     // from provider config
  reasoningFormatTypes     // from provider's endpointConfigs
)

reasoning = extractRuntimeReasoning(presetModel.reasoning, reasoningFormatType)
// → { type: 'openai-chat', supportedEfforts: ['low','medium','high'], thinkingTokenLimits: {...} }
```

## File Locations

| What | Where |
|------|-------|
| Registry JSON data | `packages/provider-registry/data/` |
| Zod schemas | `packages/provider-registry/src/schemas/` |
| RegistryLoader (load, index, TTL) | `packages/provider-registry/src/registry-loader.ts` |
| Pure lookup/transform | `packages/provider-registry/src/registry-utils.ts` |
| Normalize utilities | `packages/provider-registry/src/utils/normalize.ts` |
| Preset provider seeding | `src/main/data/db/seeding/presetProviderSeeding.ts` |
| Service (merge queries) | `src/main/data/services/ProviderRegistryService.ts` |
| Model service | `src/main/data/services/ModelService.ts` |
| Provider service | `src/main/data/services/ProviderService.ts` |
| Merge utilities | `packages/shared/data/utils/modelMerger.ts` |
| DB schemas | `src/main/data/db/schemas/userModel.ts`, `userProvider.ts` |
