# Knowledge Migration Notes (V2)

This document records temporary migration decisions for the V2 knowledge refactor.

## Scope Clarification

- `video` items are out of scope for V2 knowledge data migration and should be skipped.
- `memory` items belong to the memory module, not the knowledge module, and should be skipped in knowledge migration.

## `parentId` Semantics

- `knowledge_item.parentId` is reserved for internal hierarchy relationships produced by the directory embedding flow.
- External DataApi create/update payloads should not accept caller-provided `parentId` for knowledge items.
- The intended usage is:
  - a directory item is created as a root item first
  - files discovered inside that directory are created later by internal embedding logic, with their `parentId` pointing to the directory item id
- Therefore, the current API shape is intentionally not a generic tree CRUD contract for arbitrary client-defined hierarchies.

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
- External DataApi payloads must not provide `parentId` for knowledge items.
- `dimensions` resolution failure skips the entire base and all nested items, with warnings recorded in migration output.
- Knowledge item status migration uses `uniqueId` instead of `processingStatus`.
