# KnowledgeMigrator

`KnowledgeMigrator` migrates legacy knowledge data from Redux + Dexie exports into the new SQLite schema.

## Data Sources

| Data | Source | File/Path |
|------|--------|-----------|
| Knowledge bases + lightweight items | Redux `knowledge.bases` | `ReduxStateReader.getCategory('knowledge')` |
| Full note content | Dexie `knowledge_notes` | `knowledge_notes.json` |
| File metadata fallback | Dexie `files` | `files.json` |

## Target Tables

- `knowledge_base`
- `knowledge_item`

## Key Transformations

1. Base metadata migration
   - Legacy base model/rerank model are transformed to `embeddingModelId` and `rerankModelId`.
   - Migrated base `searchMode` is set to `default`.
   - Legacy preprocess provider id is mapped to `fileProcessorId`.
   - Invalid runtime tuning fields are normalized away instead of causing the whole base to be skipped.

2. Unified item payload migration
   - Legacy item `content` is transformed into the new `knowledge_item.data` union payload by item type.
   - V2 models `knowledge_item` as a generic same-base tree via `parentId`, but legacy v1 exports are flat.
   - Migrated items are therefore inserted as root-level nodes (`parentId = null`) by design.

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

## Field Mappings

### knowledge_base mapping

| Source (Legacy base) | Target (`knowledge_base`) | Notes |
|----------------------|---------------------------|-------|
| `id` | `id` | Direct copy |
| `name` | `name` | Direct copy |
| `description` | `description` | Direct copy |
| `dimensions` | `dimensions` | Read from legacy vector DB `vectors.vector` blob length (`length(vector)/4`) |
| `model` | `embeddingModelId` | Converted to `provider::modelId` |
| `rerankModel` | `rerankModelId` | Optional, converted to `provider::modelId` |
| `preprocessProvider.provider.id` | `fileProcessorId` | Optional |
| `chunkSize` | `chunkSize` | Copied when positive; otherwise cleared |
| `chunkOverlap` | `chunkOverlap` | Copied when non-negative and smaller than `chunkSize`; otherwise cleared |
| `threshold` | `threshold` | Copied when within `[0, 1]`; otherwise cleared |
| `documentCount` | `documentCount` | Copied when positive; otherwise cleared |
| _constant_ | `searchMode` | Always `default` during v1 migration |
| `created_at` | `createdAt` | Timestamp conversion |
| `updated_at` | `updatedAt` | Timestamp conversion |

### knowledge_item mapping

| Source (Legacy item) | Target (`knowledge_item`) | Notes |
|----------------------|---------------------------|-------|
| `id` | `id` | Direct copy |
| base owner `id` | `baseId` | From parent base |
| _no legacy hierarchy field_ | `parentId` | V1 exports are flat; migrated items are inserted as root nodes (`null`) |
| `type` | `type` | Supported: file/url/note/sitemap/directory |
| `content` + Dexie lookups | `data` | Type-specific transform |
| `uniqueId` | `status` | `uniqueId` non-empty => `completed`, otherwise `idle` |
| `processingError` | `error` | Direct copy |
| `created_at` | `createdAt` | Timestamp conversion |
| `updated_at` | `updatedAt` | Timestamp conversion |

## Dropped / Skipped Data

- `video` items are skipped.
- `memory` items are skipped.
- Invalid/malformed items are skipped and recorded as warnings in `prepare`.
- Invalid knowledge-base tuning fields are cleared during migration; they do not cause the base or its items to be skipped.

## Current Constraint Decisions

- `dimensions` is required in target schema.
- The legacy Redux `dimensions` field is not treated as the migration source of truth.
- `dimensions` is resolved from legacy vector DB content by inspecting:
  - the per-base legacy vector DB file
  - the `vectors` table
  - a non-null vector blob whose byte length can be converted to a positive dimension count (`length(vector)/4`)
- If the legacy vector DB is missing, empty, invalid, or the vector blob length cannot be parsed into a valid positive dimension count, that base is treated as unusable in V2 migration:
  - the base is skipped
  - all items under that base are skipped
  - a warning is recorded during `prepare`
- Missing embedding model identity is treated as a structural migration failure for that base.
- Non-structural tuning config (`chunkSize`, `chunkOverlap`, `threshold`, `documentCount`) is migrated on a best-effort basis:
  - valid values are preserved
  - invalid values are cleared
  - the base still migrates
- V2 introduces `parentId` as a generic tree edge within the same knowledge base.
- Legacy v1 knowledge data is flat, so migrated items are root-level (`parentId = null`) by design.

## Validation

- Count validation uses migrator stats:
  - `sourceCount`
  - `targetCount`
  - `skippedCount`
- Integrity check:
  - Detect orphan `knowledge_item` rows without valid `knowledge_base`.
