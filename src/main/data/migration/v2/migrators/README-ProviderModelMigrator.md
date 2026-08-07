# ProviderModelMigrator

`ProviderModelMigrator` moves the final v1 Redux provider/model state into the
v2 `user_provider` and `user_model` tables. It also migrates provider logos and
the legacy Dexie `pinned:models` value.

## Data Sources

| Data | Source |
|------|--------|
| Providers and models | Redux `state.llm.providers[]` |
| Provider/model settings | Redux `state.llm.settings` |
| Pinned models | Dexie `pinned:models` |
| Provider logos | Dexie `image://provider-<providerId>` |

Managed CherryAI rows are not copied from Redux. The v2 seeder owns the
canonical CherryAI provider/default model, and legacy CherryAI pins are
rewritten to that seeded model.

## Preset Ownership Projection

Preset-backed rows are deltas, not snapshots. The migration must distinguish
released v1 defaults from user changes without consulting the current v2
registry, because the current registry may already have changed.

`mappings/v1-provider-model-baseline.json` is the pinned final-v1 baseline. It
was extracted from v1 revision
`d316ec5345680f1de511fd6df3a7fbdb3edad151` (v1.9.12) and contains only
fields used by provider/model projection. `sourceRevision` records that
provenance. Its provider API flags represent the post-migration-127/129 Redux
shape: the three compatibility flags remain on system-provider top-level rows
after `apiOptions` is cleared. Do not replace this comparison with current
`providers.json`, `models.json`, or `provider-models.json` values.

Projection rules:

- A provider with `presetProviderId = null` is custom and keeps its mapped
  provider configuration. Its models may still match global `models.json`
  metadata independently; provider-model overrides remain unavailable without
  an effective preset provider.
- A preset provider is resolved by `providerId` first, then
  `presetProviderId`. The second lookup is required for custom IDs backed by a
  known provider type, such as Azure OpenAI.
- Provider fields equal to the final-v1 baseline become null/absent. API
  features are compared per key, so one changed feature does not freeze
  baseline-equal sibling flags. Different values remain row-owned deltas.
- Preset-linked custom provider IDs use the final-v1 custom-provider API
  feature baseline rather than the linked system preset baseline. This
  preserves explicit post-v1-migration feature choices while dropping untouched
  custom defaults.
- A model first uses the effective provider's provider-model override when one
  is available, then matches global `models.json` metadata. Global matching also
  applies to fully custom providers. If an effective provider's override has no
  global entry, the migrator synthesizes the same provider-exclusive preset used
  at runtime.
- Preset model fields equal to the final-v1 model become null. Every non-null
  sparse column is authoritative at read time; there is no separate ownership
  marker.
- If a current preset exists but the model is absent from the final-v1
  baseline, ordinary legacy fields have no provable user provenance and remain
  null. Explicit `capabilities[].isUserSelected` choices are preserved.
  `endpointTypes` is also preserved when the current provider-model registry
  cannot re-derive the legacy routing metadata, including dynamic models from
  built-in NewAPI providers and custom providers with legacy `type='new-api'`.
  CherryIN models without legacy endpoint metadata restore its prefix routing
  (`anthropic/`, `google/`, or OpenAI-compatible fallback) explicitly.
- The v1 editor's synthetic `0/0` pricing value is treated as equivalent to an
  absent final-v1 price.

When updating the pinned baseline, use the released final-v1 source revision,
not a v2 registry snapshot. Preserve only the legacy fields declared by
`V1ModelBaseline` / `V1ProviderBaseline`, update `sourceRevision`, and run the
migrator tests that cover baseline-equal values, genuine deltas, custom preset
IDs, and provider-exclusive models.

## Target Tables and Field Mapping

### `user_provider`

| v1 source | v2 target | Transformation |
|------|------|------|
| `id` | `providerId` | Direct; invalid and duplicate IDs are filtered first |
| `id` / `type` | `presetProviderId` | Known system IDs use the catalog ID; supported custom provider types link to their preset |
| `name` | `name` | Direct user-owned value |
| `apiHost`, `anthropicApiHost` | `endpointConfigs` | Convert to endpoint-keyed base URLs, then project preset rows against final-v1 defaults |
| `type` | `defaultChatEndpoint` | Convert through the legacy endpoint map, then store only a final-v1 delta |
| `apiKey`, auth settings | `apiKeys`, `authConfig` | Normalize keys and provider-specific credentials |
| legacy API option flags | `apiFeatures` | Convert supported flags, then store only a final-v1 delta |
| provider settings | `providerSettings` | Normalize provider-specific user settings |
| `enabled` | `isEnabled` | Defaults to true |

### `user_model`

| v1 source | v2 target | Transformation |
|------|------|------|
| provider ID + model `id` | `id`, `providerId`, `modelId` | Build deterministic `providerId::modelId` identity |
| effective registry match | `presetModelId` | Global preset (independent of provider provenance) or synthesized provider-exclusive preset; null for an unmatched custom model |
| `name`, `description`, `group` | same-named nullable columns | Complete values for custom rows; final-v1 deltas for preset rows |
| `capabilities` | `capabilities` | Normalize capability names; preserve explicit `isUserSelected` choices |
| `endpoint_type`, `supported_endpoint_types` | `endpointTypes` | Normalize legacy endpoint aliases |
| `supported_text_delta` | `supportsStreaming` | Defaults to true for custom rows; final-v1 delta for preset rows |
| `pricing` | `pricing` | Normalize to runtime pricing; discard the synthetic empty `0/0` echo |
| source order | `orderKey` | Assign fractional keys within each provider |

## Intentionally Dropped or Re-derived Data

- Preset model fields without a non-null sparse delta are resolved from the
  current registry at read time. No `userOverrides` ownership array is stored.
- Registry-only provider endpoint fields (`modelsApiUrls`, `adapterFamily`) are
  not copied into preset rows. A migrated custom relay may retain a main-only
  `adapterFamily` hint because no catalog can re-derive it.
- Preset `inputModalities`, `outputModalities`, token limits, reasoning, and
  parameter support are not inferred from the current registry during
  migration; null delegates them to read-time resolution.
- Legacy `isNotSupportEnableThinking` has no v2 `ApiFeatures` target and is
  dropped.
- Legacy Anthropic web OAuth tokens lived outside this source and are not
  recoverable; those providers return to the API-key auth path.
- Corrupt identifiers, duplicate rows after the first occurrence, retired
  providers, invalid pin references, and missing optional logos are omitted as
  described below.

## Endpoint Routing Boundary

Renderer/API endpoint writes contain only user-editable `baseUrl` values.
Legacy `adapterFamily` routing provenance may exist in the main-process stored
shape for custom providers, but it is not part of the shared write DTO. Preset
providers always take routing families from the current registry.

## Data Quality Handling

| Issue | Handling |
|------|----------|
| Missing/empty provider ID | Skip and warn |
| Duplicate provider ID | Keep the first and warn |
| Missing/empty model ID | Skip and warn |
| Duplicate model ID within a provider | Keep the first and warn |
| Retired provider | Skip and warn |
| Missing final-v1 preset baseline | Preserve mapped provider values and warn |
| Invalid pinned model reference | Drop it |
| Missing optional logo | Keep the provider without a logo |

Provider rows and their model rows are inserted in one synchronous
`withWriteTx` transaction. Order keys preserve the prepared provider/model
sequence, after the seeded CherryAI row.

## Implementation Files

- `ProviderModelMigrator.ts` — preparation, projection, transaction, pins, and
  validation
- `mappings/ProviderModelMappings.ts` — legacy-to-v2 field transforms
- `mappings/v1-provider-model-baseline.json` — pinned final-v1 ownership
  baseline
- `__tests__/ProviderModelMigrator.test.ts` — migration and provenance
  regressions
