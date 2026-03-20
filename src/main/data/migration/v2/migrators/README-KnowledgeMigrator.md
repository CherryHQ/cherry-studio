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

2. Unified item payload migration
   - Legacy item `content` is transformed into the new `knowledge_item.data` union payload by item type.

3. Note content source priority
   - Prefer Dexie `knowledge_notes` content.
   - Fall back to Redux item `content` when note export is missing.

4. Processing status normalization
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
| `chunkSize` | `chunkSize` | Direct copy |
| `chunkOverlap` | `chunkOverlap` | Direct copy |
| `threshold` | `threshold` | Direct copy |
| `documentCount` | `documentCount` | Direct copy |
| _constant_ | `searchMode` | Always `default` during v1 migration |
| `created_at` | `createdAt` | Timestamp conversion |
| `updated_at` | `updatedAt` | Timestamp conversion |

### knowledge_item mapping

| Source (Legacy item) | Target (`knowledge_item`) | Notes |
|----------------------|---------------------------|-------|
| `id` | `id` | Direct copy |
| base owner `id` | `baseId` | From parent base |
| `parentId` | `parentId` | Ignored in v1 migration, always stored as `null` |
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

## Current Constraint Decisions

- `dimensions` is required in target schema.
- `dimensions` is resolved from legacy vector DB content (`length(vector)/4`).
- If vector DB is missing/empty/invalid for a base, that base (and its items) is skipped.
- v1 `parentId` is not migrated; all migrated items are root-level (`parentId = null`).

## Validation

- Count validation uses migrator stats:
  - `sourceCount`
  - `targetCount`
  - `skippedCount`
- Integrity check:
  - Detect orphan `knowledge_item` rows without valid `knowledge_base`.
