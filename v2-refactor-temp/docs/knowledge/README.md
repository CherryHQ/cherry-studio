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

## Pending Decision: `dimensions` Required Constraint

- `dimensions` is treated as a required field for target V2 `knowledge_base`.
- If source data has empty or missing `dimensions`, migration code currently **does not** apply any fallback or auto-fix.
- Current handling policy: record this as a migration risk/decision item in documentation only, and postpone implementation until a concrete rule is confirmed.

## Implementation Status

- The above rules are documentation-level decisions.
- No migration code change is applied for empty `dimensions` handling at this stage.
