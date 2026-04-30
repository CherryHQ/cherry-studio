# KnowledgeMigrator

`KnowledgeMigrator` migrates legacy knowledge data from Redux + Dexie exports into the new SQLite schema.

## Data Sources

| Data | Source | File/Path |
|------|--------|-----------|
| Knowledge bases + lightweight items | Redux `knowledge.bases` | `ReduxStateReader.getCategory('knowledge')` |
| Full note content | Dexie `knowledge_notes` | `knowledge_notes.json` |
| File metadata fallback | Dexie `files` | `files.json` |
| Legacy vector databases | Filesystem | `ctx.paths.knowledgeBaseDir/<sanitizedBaseId>` (via `MigrationPaths`) |

> **Note**: The legacy vector DB path comes from `ctx.paths.knowledgeBaseDir`, which is pre-computed by `MigrationPaths` from the resolved v1 userData directory. The base id is sanitized with `sanitizeFilename(baseId, '_')`. Do NOT call `app.getPath('userData')` directly — see `migration/v2/README.md` Path Safety section.

## Target Tables

- `knowledge_base`
- `knowledge_item`

## Key Transformations

1. Base metadata migration
   - Legacy base model/rerank model are transformed to `embeddingModelId` and `rerankModelId`.
   - Model references are resolved against migrated `user_model` rows; missing or dangling embedding/rerank references are cleared with warnings.
   - Migrated base `searchMode` is set to `hybrid`.
   - Legacy preprocess provider id is mapped to `fileProcessorId`.
   - Invalid runtime tuning fields are normalized to schema-safe defaults/nulls instead of causing the whole base to be skipped.

2. Unified item payload migration
   - Legacy item `content` is transformed into the new `knowledge_item.data` union payload by item type.
   - Supported migrated item types are `file`, `url`, `note`, `sitemap`, and `directory`.
   - V2 models `knowledge_item` as a flat item list with optional `groupId`.
   - Official v1 exports do not provide grouping metadata.
   - Migrated items are therefore inserted with `groupId = null` by design.
   - `directory` and `sitemap` are container/source declarations in `knowledge_item`; their own container-level vectors are handled by `KnowledgeVectorMigrator` as non-indexable and are not written to the V2 vector store.

3. Note content source priority
   - Prefer Dexie `knowledge_notes` content.
   - Fall back to Redux item `content` when note export is missing.

4. Dexie lookup loading strategy
   - `knowledge_notes` and `files` are scanned via streaming readers.
   - The migrator first collects required note/file ids from Redux knowledge items.
   - Only matching records are retained in memory for transformation.

5. Processing status normalization
   - Legacy `processingStatus` is treated as runtime-only and not trusted for migration.
   - Item status is inferred from `uniqueId`:
     - `uniqueId` present and non-empty -> `completed`
     - otherwise -> `idle`

6. Vector dimension dependency
   - The target `knowledge_base.dimensions` column is required.
   - The migrator resolves dimensions from the legacy per-base vector DB, using the first non-null `vectors.vector` blob length.
   - This migrator does not copy vector rows. It only prepares the base and item records needed by `KnowledgeVectorMigrator`.
   - If dimension resolution fails, the base and its items are skipped because the target schema cannot safely materialize that base.

## Field Mappings

### knowledge_base mapping

| Source (Legacy base) | Target (`knowledge_base`) | Notes |
|----------------------|---------------------------|-------|
| `id` | `id` | Direct copy |
| `name` | `name` | Direct copy |
| _no legacy grouping field_ | `groupId` | V1 knowledge bases do not carry group metadata; migrate as `null` |
| _constant_ | `emoji` | Always `📁` during v1 migration |
| `dimensions` | `dimensions` | Read from legacy vector DB `vectors.vector` blob length (`length(vector)/4`) |
| `model` | `embeddingModelId` | Converted to `provider::modelId`, then resolved against `user_model`; missing/dangling references are cleared |
| `rerankModel` | `rerankModelId` | Optional, converted to `provider::modelId`, then resolved against `user_model`; dangling references are cleared |
| `preprocessProvider.provider.id` | `fileProcessorId` | Optional |
| `chunkSize` | `chunkSize` | Copied when positive integer; otherwise normalized to the default chunk size |
| `chunkOverlap` | `chunkOverlap` | Copied when non-negative integer and smaller than `chunkSize`; otherwise normalized to the default overlap for the resolved chunk size |
| `threshold` | `threshold` | Copied when within `[0, 1]`; otherwise cleared |
| `documentCount` | `documentCount` | Copied when positive; otherwise cleared |
| _constant_ | `searchMode` | Always `hybrid` during v1 migration |
| `created_at` | `createdAt` | Timestamp conversion |
| `updated_at` | `updatedAt` | Timestamp conversion |

### knowledge_item mapping

| Source (Legacy item) | Target (`knowledge_item`) | Notes |
|----------------------|---------------------------|-------|
| `id` | `id` | Direct copy |
| base owner `id` | `baseId` | From parent base |
| _no legacy grouping field_ | `groupId` | V1 exports are flat; migrated items are inserted without grouping metadata (`null`) |
| `type` | `type` | Supported: file/url/note/sitemap/directory |
| `content` + Dexie lookups | `data` | Type-specific transform |
| `uniqueId` | `status` | `uniqueId` non-empty => `completed`, otherwise `idle` |
| `processingError` | `error` | Direct copy |
| `created_at` | `createdAt` | Timestamp conversion |
| `updated_at` | `updatedAt` | Timestamp conversion |

## Dropped / Skipped Data

- `video` items are skipped.
- `memory` items are skipped.
- Legacy per-base knowledge store paths that resolve to directories are skipped as unsupported pre-v2 layouts.
- Invalid/malformed items are skipped and recorded as warnings in `prepare`.
- Invalid knowledge-base tuning fields are normalized during migration; they do not cause the base or its items to be skipped.

## Directory and Sitemap Semantics

- `directory` and `sitemap` items are migrated into `knowledge_item` when their legacy payload is valid.
- They preserve the source/root declaration needed to show the original knowledge entry in V2.
- V1 does not provide separate child `knowledge_item` ids for every expanded directory or sitemap child document.
- Therefore this migrator does not synthesize child item rows during v1 migration.
- Any legacy vector rows that map back to the root `directory` or `sitemap` item are considered container-level vectors and are skipped by `KnowledgeVectorMigrator` with warnings.
- Child content vectors are only migrated when they can be mapped to an existing migrated `file`, `url`, or `note` item id.

## Current Constraint Decisions

- `dimensions` is required in target schema.
- The legacy Redux `dimensions` field is not treated as the migration source of truth.
- `dimensions` is resolved from legacy vector DB content by inspecting:
  - the per-base legacy vector DB file
  - the `vectors` table
  - a non-null vector blob whose byte length can be converted to a positive dimension count (`length(vector)/4`)
- If the per-base legacy knowledge store path resolves to a directory instead of a SQLite file, that base is treated as an unsupported legacy layout and is skipped.
- If the legacy vector DB is missing, empty, invalid, or the vector blob length cannot be parsed into a valid positive dimension count, that base is treated as unusable in V2 migration:
  - the base is skipped
  - all items under that base are skipped
  - a warning is recorded during `prepare`
- Missing or dangling embedding model identity is cleared to `null` with a warning. It does not cause the base or its items to be skipped.
- Non-structural tuning config (`chunkSize`, `chunkOverlap`, `threshold`, `documentCount`) is migrated on a best-effort basis:
  - valid values are preserved
  - invalid `chunkSize` / `chunkOverlap` values are replaced with defaults
  - invalid nullable tuning values such as `threshold` / `documentCount` are cleared
  - the base still migrates
- V2 keeps `knowledge_item` flat and uses optional `groupId` for grouping queries.
- Legacy v1 knowledge data does not include that field, so migrated items keep it as `null`.
- This document describes migration behavior only; runtime APIs may set `groupId` after migration.
- Runtime schema enforces same-base group ownership through `(baseId, groupId) -> (baseId, id)`.

## Validation

- Count validation uses migrator stats:
  - `sourceCount`
  - `targetCount`
  - `skippedCount`
- Integrity check:
  - Detect orphan `knowledge_item` rows without valid `knowledge_base`.
