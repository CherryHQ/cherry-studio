# Knowledge Schema Notes (V2)

This document records the current V2 knowledge target schema, migration constraints, and temporary scope boundaries.

## Scope Clarification

- `video` items are out of scope for V2 knowledge data migration and should be skipped.
- `memory` items belong to the memory module, not the knowledge module, and should be skipped in knowledge migration.

## Current Target Schema

### `knowledge_base`

- Persisted columns:
  - `id`
  - `name`
  - `description`
  - `dimensions`
  - `embeddingModelId`
  - `rerankModelId`
  - `fileProcessorId`
  - `chunkSize`
  - `chunkOverlap`
  - `threshold`
  - `documentCount`
  - `searchMode`
  - `hybridAlpha`
  - `createdAt`
  - `updatedAt`

### `knowledge_item`

- Persisted columns:
  - `id`
  - `baseId`
  - `parentId`
  - `type`
  - `data`
  - `status`
  - `error`
  - `createdAt`
  - `updatedAt`
- New app-created knowledge items use ordered UUID generation for `id`.

## Fields Removed From The V2 SQLite Schema

- `video` is not a target `knowledge_item.type`.
- `memory` is not a target `knowledge_item.type`.
- Legacy runtime-only item fields are not stored as standalone SQLite columns:
  - `uniqueId`
  - `uniqueIds`
  - `processingProgress`
  - `retryCount`
  - `isPreprocessed`
- `remark` is not part of the V2 SQLite schema.
- `sourceUrl` is not a standalone `knowledge_item` column:
  - for notes, it may exist inside `data.sourceUrl`
  - for url/sitemap items, the URL is stored inside the typed `data` payload
- Official v1 legacy exports do not contain `parentId`.

## `parentId` Semantics

- `knowledge_item.parentId` is a generic same-base tree edge in the target schema.
- Current runtime read flows use:
  - `GET /knowledge-bases/:id/root/children` for root-level nodes
  - `GET /knowledge-items/:id/children` for direct children of one node
- Current runtime create flow is limited to root-level creation:
  - `POST /knowledge-bases/:id/root/children`
  - request bodies do not carry `parentId`
- Child-node creation is intentionally not exposed in the current UI/DataApi contract.
- The schema is intentionally broader than a directory-only hierarchy model.
- Migration from official v1 data does not preserve or infer hierarchy:
  - official v1 exports are flat
  - migrated items are inserted with `parentId = null`

## Current `type` / `data` Integrity Boundary

- `knowledge_item.type` and `knowledge_item.data` are intended to stay aligned by controlled UI flows.
- In the current V2 scope, knowledge item create/edit operations are expected to come from strongly associated UI forms for each item type.
- Because of that scope assumption, the current implementation does not add an extra DB-level or DataApi-level cross-structure constraint that re-validates `data` against the stored `type` on every write.
- Downstream knowledge code may therefore treat the stored `type` + `data` pair as a trusted contract produced by the app's controlled write path.
- If future write paths are added outside the current controlled UI flow, such as import tools, scripts, sync jobs, or public/external APIs, this assumption must be revisited and explicit boundary validation should be added at that time.

## Current Non-Goals

- This phase does not reconstruct hierarchy from legacy v1 exports.
- This phase does not infer directory child relationships during migration.
- This phase does not preserve temporary processing lifecycle states beyond the `uniqueId`-based status rule below.
- This phase does not migrate `video` or `memory` into V2 knowledge tables.

## `dimensions` Resolution Rule

- `dimensions` is treated as a required field for target V2 `knowledge_base`.
- Migration does not trust legacy Redux `dimensions` as the source of truth.
- Migration must resolve `dimensions` from the legacy vector database by inspecting:
  - the per-base legacy vector DB file
  - the `vectors` table
  - a non-null vector blob whose byte length can be converted to a positive dimension count
- Resolution is considered failed when the legacy vector DB is missing, empty, invalid, or its vector blob length cannot be parsed into a valid positive dimension count.
- When resolution fails, the knowledge base is considered unusable in V2 migration:
  - skip the entire base
  - skip all items under that base
  - record a warning for diagnostics
- Migration does not apply fallback or auto-fix for unresolved `dimensions`.

## Item Status Migration Rule

- Legacy `processingStatus` is treated as runtime state and is not used as the migration source of truth.
- Migration infers target V2 `knowledge_item.status` from legacy `uniqueId`:
  - non-empty `uniqueId` -> `completed`
  - otherwise -> `idle`
- Temporary legacy states such as in-progress or failed processing are not preserved as V2 status during migration.

## Implementation Status

- `video` and `memory` items are skipped during migration.
- The target schema supports non-null `parentId`, but migration from official v1 data still writes `parentId = null`.
- `dimensions` resolution failure skips the entire base and all nested items, with warnings recorded in migration output.
- Knowledge item status migration uses `uniqueId` instead of `processingStatus`.
