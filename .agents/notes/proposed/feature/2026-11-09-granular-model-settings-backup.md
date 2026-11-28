# Agent Note: Granular model settings backup

Status: proposed

English | [中文](2026-11-09-granular-model-settings-backup.zh.md)

## Problem

Backup is all-or-nothing. Users who run Cherry Studio on several machines want to carry provider and model configuration (API keys, endpoint URLs, model lists, enabled state, context-limit overrides) without overwriting chat history, agents, or UI preferences. The v2 data layer stores providers in `user_provider` and models in `user_model`, but no export or import path reaches those rows alone.

## Proposal

Add a "Model settings" row beside the existing backup and restore controls in Data settings with two actions.

**File.** Export writes one JSON document, suggested as `cherry-studio-models-YYYYMMDD.json`:

```json
{ "format": "cherry-studio-model-settings", "version": 1, "exportedAt": 1762646400000,
  "providers": [ ... ], "models": [ ... ] }
```

Provider items use the `CreateProviderSchema` fields without `logo`, plus `isEnabled`, plus, for preset-less providers only, the stored per-endpoint `adapterFamily` routing provenance described under Routing provenance. Model items use the `CreateModelSchema` fields plus `isEnabled` and `isHidden`. Both schemas are reused, so the file mirrors the DataApi contract. Excluded: logo bindings, order keys, timestamps, `notes`, `reasoning`, `isDeprecated`, managed Cherry-owned providers and their default models, and every non-model table. Assistant defaults that reference a model are not exported.

**Export source.** The main process reads the stored override rows directly, not registry-enriched `Model` or `Provider` objects, so preset values are not frozen into the file. A preset model exports only its stored overrides. The save dialog is parented to the requesting window, as `ExportService` does. Before export the renderer shows a confirmation stating that the file contains API keys.

**Import.** Import runs in two steps:

1. `preview`: the main process opens an open dialog, rejects files over 10 MiB, parses JSON, validates it against the strict document schema, computes conflicts against current rows, and returns the validated document with the conflict list. Nothing is written.
2. `apply`: the renderer sends the document back with one decision per conflict. The main process recomputes conflicts and writes.

Each conflict is one row: a provider (`providerId`) or a model (`(providerId, modelId)`). The dialog offers Replace or Skip per row, plus "Replace all" and "Skip all". A conflict without a decision is skipped. Cancelling the dialog writes nothing.

**Write semantics.** Writes go through `providerService` and `modelService` public methods, the same methods the DataApi handlers call, so managed-provider guards, registry enrichment, and edition checks still apply, with one owner-controlled exception described under Routing provenance. Providers are written before models so that model foreign keys resolve.

- New provider: `create`, then `update` for `isEnabled` when true, then `replaceApiKeys` when the file lists keys. For a preset-less provider, `adapterFamily` provenance from the file is then restored as described under Routing provenance.
- Replace provider: `update` with the provider fields present in the file (`name`, `endpointConfigs`, `defaultChatEndpoint`, `authConfig`, `providerSettings`, `isEnabled`); then `replaceApiKeys` when the file lists `apiKeys`. Top-level `providerSettings` keys absent from the file are set to `null` so they clear; other absent provider fields are unchanged.
- New model: `create` with the create fields, then `update` only when `isEnabled` or `isHidden` differs from the default.
- Replace model: `update` with every field in the file. Nullable limits (`contextWindow`, `maxInputTokens`, `maxOutputTokens`) absent from the file are set to `null`. Other fields absent from the file are left unchanged.

Each item is attempted independently. The result lists created, replaced, skipped, and failed counts, and each failure carries its kind, identifier, and message. A provider failure skips its models with the reason `provider_not_imported`.

**Routing provenance.** Migrated custom relays without a preset can carry a legacy `adapterFamily` hint (for example `gateway` or `newapi`) on their stored endpoint overrides. Endpoint-type inference cannot reproduce it: an imported provider that loses it resolves to `openai-compatible` and silently changes request protocol while keeping its URL and keys. The document schema therefore carries `adapterFamily` inside provider `endpointConfigs` for preset-less providers only, and export reads it from the stored rows like every other override. On import, both for new providers and for Replace decisions, `ModelSettingsBackupService` restores it through an owner-controlled path: after the service calls above, it writes the persisted endpoint overrides directly in the main process, restricted to preset-less providers and to values in the known adapter-family set that `resolveAiSdkProviderId` accepts. A value outside that set is dropped and reported in the item result as `adapter_family_dropped`. `CreateProviderSchema` and the other renderer-reachable schemas do not gain this field, so ordinary renderer writes still cannot set `adapterFamily`, and the file cannot set it for preset providers.

**Ownership.** The export and import logic lives in `src/main/services/ModelSettingsBackupService.ts`, a non-lifecycle singleton like `ExportService`. Routes are declared in `src/shared/ipc/schemas/modelSettings.ts` and handled in `src/main/ipc/handlers/modelSettings.ts`. The document schema lives in `src/shared/types/modelSettingsBackup.ts`. The renderer adds a row in `BasicDataSettings.tsx` and a conflict popup under `DataSettings/`. `LegacyBackupManager`, the backup archive, and its restore path are not modified.

## Alternatives considered

- **Renderer-only with existing DataApi reads.** Reads return registry-enriched values, which would freeze registry data into user overrides (the failure mode in #17096), and cannot separate stored overrides from defaults.
- **A new DataApi endpoint.** Native file dialogs and file I/O are main-process concerns, and a composed preview/apply is imperative rather than resource CRUD.
- **Extend the full backup archive with a model-only mode.** The archive is a drop-in mirror of v1 and carries a database snapshot; a partial restore would have to rewrite it, and it does not solve merging into an existing profile.
- **All-or-nothing import in one transaction.** `ProviderService` and `ModelService` expose no transaction-composable create or update methods. Making them so is an upstream refactor that changes services used by many callers. This Spec does not take it on; the partial-failure cost is stated under Risks and per-item results make it visible. Whether to pursue the upstream refactor is a decision for the maintainers.
- **Encrypting API keys in the file.** The issue asks for the same handling as full backup; a second key-management scheme is out of scope.

## Acceptance criteria

- AC1 — An exported document validates against the strict schema and contains only `providers` and `models` arrays; no topic, message, agent, assistant, file, or preference data appears (verification: unit)
- AC2 — Preset models export only stored override columns, and managed Cherry-owned providers and their default models are absent (verification: unit)
- AC3 — Import rejects a wrong `format`, an unsupported `version`, a file over 10 MiB, invalid JSON, and any malformed item before writing anything (verification: unit)
- AC4 — On an empty database, import creates each provider with its API keys, endpoint configs, and enabled state, and each model with its enabled and hidden state; a preset-less migrated relay carrying `adapterFamily: 'gateway'` or `adapterFamily: 'newapi'` in its stored endpoint overrides round-trips with the same resolved adapter family after import, not `openai-compatible` (verification: unit)
- AC5 — Conflicts are detected per provider and per `(providerId, modelId)`; a Replace decision overwrites the listed fields, a Skip or missing decision leaves the row unchanged, and Replace clears absent nullable model limits (verification: unit)
- AC6 — A failing item does not stop other items, the result names each failure with its kind and identifier, and models of a provider that was not imported are reported as `provider_not_imported` (verification: unit)
- AC7 — The conflict dialog offers per-row Replace and Skip plus Replace all and Skip all, cancelling writes nothing, and the API-key warning appears before export (verification: renderer)
- AC8 — `LegacyBackupManager` and the existing backup and restore tests pass unchanged (verification: unit)
- AC9 — The new strings exist in every renderer locale with translations and pass `pnpm i18n:check` (verification: docs gate)
- AC10 — A file saved through the native dialog on one profile imports on a second profile with the expected providers and models (verification: Electron)

## Risks

- The export file stores API keys in plain text, the same as the full backup. The warning is the only mitigation.
- Import is not atomic. Items are written one at a time, and one item can take several service calls (for example, `create` then `update` for `isEnabled`). A failure or crash between calls leaves that item partly applied, and a crash mid-run leaves earlier items written. Re-running the same file is safe: existing rows become conflicts and the Skip default leaves them alone.
- Replace on a provider clears top-level `providerSettings` keys absent from the file; nested objects are merged by the existing merge-patch semantics, so a nested key removed in the file survives a Replace. Accepted for this version.
- `notes` and `reasoning` are not exported, so a model's free-text notes do not travel between machines.
- An exported preset override may refer to a registry value that changes in a later release; the importing machine then sees the newer registry value under that override.
