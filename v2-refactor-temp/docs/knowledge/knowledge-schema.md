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
  - `groupId`
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
- Official v1 legacy exports do not contain `groupId`.

## `groupId` Semantics

- `knowledge_item` is modeled as a flat same-base item collection.
- `groupId` is an optional stable grouping key inside one knowledge base.
  - Typical usage: items from the same imported source/container
  - Examples: one directory import, one sitemap expansion, one URL collection
  - When one item is the logical container/owner of a group, downstream items use `groupId = containerItem.id`
  - The schema enforces same-base ownership:
    - `(baseId, groupId)` must reference `(baseId, id)` in `knowledge_item`
    - deleting the owner cascades to grouped members
- Current runtime read flows use:
  - `GET /knowledge-bases/:id/items` for flat item listing
  - optional query filters: `type`, `groupId`
- Current runtime create flow uses:
  - `POST /knowledge-bases/:id/items`
  - request bodies may carry `groupId`
  - `groupId` may only point to an already existing owner item in the same knowledge base
  - creating a new owner item and its grouped members is therefore a two-step flow in the current contract:
    - create the owner item first
    - create grouped members afterwards with `groupId = ownerItem.id`
- Current runtime update flow uses:
  - `PATCH /knowledge-items/:id`
  - mutable fields may include `data`, `status`, `error`
  - `groupId` is create-only in the current DataApi contract and is not updated through `PATCH /knowledge-items/:id`
- Current delete flow is item-level only:
  - `DELETE /knowledge-items/:id`
  - when the deleted item is a logical group owner, the database cascade also removes items with `groupId = :id`
  - there is still no separate first-class group resource or `DELETE /knowledge-groups/:id` endpoint
- Migration from official v1 data does not preserve or infer grouping metadata:
  - official v1 exports are flat
  - migrated items are inserted with `groupId = null`

## Current `type` / `data` Integrity Boundary

- `knowledge_item.type` and `knowledge_item.data` are intended to stay aligned by controlled UI flows.
- In the current V2 scope, knowledge item create/edit operations are expected to come from strongly associated UI forms or controlled write paths for each item type.
- The current implementation does not add an extra DB-level cross-structure constraint that re-validates `data` against the stored `type` on every write.
- At the DataApi/service layer:
  - create flows still rely on controlled write paths to keep `type` and `data` aligned
  - update flows re-validate `data` against the stored `type` before persisting changes
- Downstream knowledge code may therefore treat the stored `type` + `data` pair as a trusted contract produced by the app's controlled write path.
- If future write paths are added outside the current controlled UI flow, such as import tools, scripts, sync jobs, or public/external APIs, this assumption must be revisited and explicit boundary validation should be added at that time.

## Current Non-Goals

- This phase does not reconstruct hierarchy from legacy v1 exports.
- This phase does not infer directory child relationships during migration.
- This phase does not introduce a first-class `knowledge_group` table.
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
- The target schema uses optional `groupId`, but migration from official v1 data still writes it as `null`.
- The current DataApi contract is flat item CRUD plus filtered listing; it does not expose tree navigation.
- Group ownership is represented implicitly by `groupId = ownerItem.id`; there is no standalone group table in the current phase.
- `dimensions` resolution failure skips the entire base and all nested items, with warnings recorded in migration output.
- Knowledge item status migration uses `uniqueId` instead of `processingStatus`.
