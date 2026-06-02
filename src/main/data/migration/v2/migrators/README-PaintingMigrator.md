# PaintingMigrator

## Sources

- Redux `paintings` slice only
- No Dexie dependency for the main migration payload

## Target

- SQLite `painting` table (one row per painting)
- SQLite `file_ref` table (one row per referenced file)

## Key Rules

- Legacy namespaces are normalized into `providerId` (+ a runtime `mode`, which
  is **not** persisted on the row — see `NormalizedPaintingRow`)
- A migrated row carries only `id`, `providerId`, `modelId`, `prompt`, plus an
  `orderKey`
- `orderKey` is assigned across the **whole** migrated set in source order via
  `assignOrderKeysInSequence` (no per-`providerId` scoping, no numeric
  `sortOrder` column)
- Output / input file ids do **not** live on the painting row. They are emitted
  as `file_ref` rows: `sourceType='painting'`, `sourceId=painting.id`,
  `role='output' | 'input'`
- `file_ref` emission is **pre-filtered against `file_entry`**: ids the
  FileMigrator skipped (malformed v1 rows) are dropped and counted as
  `droppedFileRefs` so the engine's final `PRAGMA foreign_key_check` never aborts
- A cross-namespace duplicate painting id is rewritten to a fresh `uuidv4()`
  (not a composite string) so the emitted `file_ref.sourceId` stays a valid
  `z.uuidv4()`
- In-memory-only input references (object URLs / base64-only fields) are dropped
  with warnings

## Dropped Fields / Columns

- The JSON files column (replaced by `file_ref` rows)
- `mediaType` (image vs video is derived from files at display time)
- Runtime-only `urls`
- Async task ids (`generationId` / `taskId`) — not persisted on the receipt
- Legacy painting tree parent field
- UI status fields such as `status` and `ppioStatus`
- Any input image reference that cannot be reconstructed from persisted file metadata
