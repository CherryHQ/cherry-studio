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
│   ├── registry-loader.ts    RegistryLoader: read JSON, validate, cache, build indexes
│   ├── registry-utils.ts     Pure functions: lookupRegistryModel, buildRuntimeEndpointConfigs
│   ├── utils/normalize.ts    normalizeModelId and helpers (aggregator prefix, variant suffix...)
│   └── schemas/              Zod schemas for validation
│
src/main/data/
├── db/seeding/
│   └── presetProviderSeeding.ts   ISeed: insert-only preset providers on first boot
├── services/
│   ├── ProviderRegistryService.ts Merge-dependent operations (enrich, resolve, initialize)
│   ├── ModelService.ts            Model CRUD, accepts registry lookup from handler
│   └── ProviderService.ts         Provider CRUD, preset deletion protection
└── api/handlers/
    ├── models.ts                  POST /models: handler does registry lookup, passes to service
    └── providers.ts               Registry model endpoints
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

**Key behavior**: Insert-only. If provider already exists in DB, skip it. Preset providers (those with `presetProviderId`) cannot be deleted by users.

### 2. On-Demand: Model Creation

```
POST /models { providerId: 'openai', modelId: 'gpt-4o' }
  → handler: providerRegistryService.lookupModel(providerId, modelId)
    → RegistryLoader.findModel('gpt-4o')           // exact match, then normalize fallback
    → RegistryLoader.findOverride('openai', 'gpt-4o')
    → getEffectiveReasoningConfig(providerId)       // DB query for user provider overrides
    → returns { presetModel, registryOverride, reasoningFormatTypes, defaultChatEndpoint }
  → handler: modelService.create(dto, registryData)
    → mergeModelConfig(userRow, override, preset, providerId, ...)
    → INSERT into user_model with presetModelId = preset.id
```

### 3. On-Demand: Provider Model Initialization

```
POST /providers/:providerId/registry-models
  → providerRegistryService.initializeProvider(providerId)
    → RegistryLoader.getOverridesForProvider(providerId)  // all overrides for this provider
    → For each override: find base model, mergeModelConfig, collect rows
    → modelService.batchUpsert(rows)                      // respects userOverrides protection
```

### 4. Enrichment: Update Existing Models from Registry

```
providerRegistryService.enrichExistingModels()
  → RegistryLoader.loadModels() + loadProviderModels()
  → SELECT * FROM user_model WHERE presetModelId IS NOT NULL
  → SELECT providerId, defaultChatEndpoint, endpointConfigs FROM user_provider
  → For each user model:
      → RegistryLoader.findModel(presetModelId)      // exact + normalize fallback
      → RegistryLoader.findOverride(providerId, presetModelId)
      → mergeModelConfig(userRow, override, preset, ...)
      → collect update rows
  → modelService.batchUpsert(updateRows)             // respects userOverrides protection
```

**Status**: Currently not wired into any startup hook. Will be called by a future registry update service (CDN-based JSON updates).

### 5. Read-Only: Registry Model Queries

```
GET /providers/:providerId/registry-models
  → providerRegistryService.getRegistryModelsByProvider(providerId)
    → RegistryLoader.getOverridesForProvider(providerId)
    → For each override: find base model, mergeModelConfig
    → Return merged Model[] (no DB writes)
```

## Three-Layer Merge

All model data follows a three-layer merge with strict priority:

```
user_model (DB)  >  provider-models.json (override)  >  models.json (preset)
   highest                  middle                         lowest
```

Implemented in `mergeModelConfig()` (`packages/shared/data/utils/modelMerger.ts`):

```typescript
// 1. Start from preset (models.json)
let capabilities = [...presetModel.capabilities]
let inputModalities = presetModel.inputModalities
let contextWindow = presetModel.contextWindow
// ...all fields initialized from preset

// 2. Apply catalog override (provider-models.json)
if (catalogOverride) {
  if (catalogOverride.capabilities) capabilities = applyCapabilityOverride(...)
  if (catalogOverride.limits?.contextWindow) contextWindow = catalogOverride.limits.contextWindow
  // ...
}

// 3. Apply user override (user_model DB row) — highest priority
if (userModel) {
  if (userModel.capabilities) capabilities = userModel.capabilities
  if (userModel.contextWindow != null) contextWindow = userModel.contextWindow
  // ...
}
```

### User Override Protection

`ModelService.batchUpsert()` respects a `userOverrides` field on each `user_model` row. When a user manually edits a field (e.g., changes `name`), that field name is recorded in `userOverrides`. During enrichment, fields in `userOverrides` are skipped — the user's customization is preserved even when registry data updates.

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
| `userOverrides` | JSON array of field names user has manually edited |

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
| RegistryLoader + readers | `packages/provider-registry/src/registry-loader.ts` |
| Pure lookup/transform | `packages/provider-registry/src/registry-utils.ts` |
| Normalize utilities | `packages/provider-registry/src/utils/normalize.ts` |
| Preset provider seeding | `src/main/data/db/seeding/presetProviderSeeding.ts` |
| Service (merge-dependent) | `src/main/data/services/ProviderRegistryService.ts` |
| Model service | `src/main/data/services/ModelService.ts` |
| Provider service | `src/main/data/services/ProviderService.ts` |
| Merge utilities | `packages/shared/data/utils/modelMerger.ts` |
| DB schemas | `src/main/data/db/schemas/userModel.ts`, `userProvider.ts` |
