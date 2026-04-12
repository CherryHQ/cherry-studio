# PaintingMigrator

## Sources

- Redux `paintings` slice only
- No Dexie dependency for the main migration payload

## Target

- SQLite `painting` table

## Key Rules

- Legacy namespaces are normalized into `providerId + mode`
- `mode` is collapsed to `generate | edit | upscale`
- `sortOrder` preserves the old array order within each `providerId + mode` scope
- `files: FileMetadata[]` becomes `fileIds: string[]`
- Recoverable input image metadata becomes `inputFileIds: string[]`
- In-memory-only input references (object URLs / base64-only fields) are dropped with warnings
- Async task ids (`generationId` / `taskId`) are preserved in `params.taskId`

## Dropped Fields

- Runtime-only `urls`
- UI status fields such as `status` and `ppioStatus`
- Any input image reference that cannot be reconstructed from persisted file metadata

