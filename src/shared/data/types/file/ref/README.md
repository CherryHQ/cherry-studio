# FileRef Variants

`FileRefSchema` is the shared discriminated union for current FileManager ref shapes.

Current variants:

- `temp_session` — transient paste/draft refs, backed by main-process `CacheService` memory; not stored in SQLite.
- `chat_message` — persisted in `chat_message_file_ref`, FK-cascades from `message` and `file_entry`.
- `painting` — persisted in `painting_file_ref`, FK-cascades from `painting` and `file_entry`.

Knowledge files are owned by the Knowledge workflow under its base `raw/` storage and do not register FileManager refs.

## Directory

```text
ref/
├── essential.ts       # Common fields + createRefSchema factory
├── tempSession.ts     # CacheService-backed temp refs
├── chatMessage.ts     # chat_message variant
├── painting.ts        # painting variant
├── index.ts           # Aggregates variants into FileRefSchema
└── README.md
```

## Adding a New Persistent Business Ref

1. Add a variant file in this directory (`{domain}.ts`) with:
   - `{domain}SourceType`
   - `{domain}Roles`
   - `{domain}RefFields`
   - `{domain}FileRefSchema`
2. Add a dedicated SQLite association table with FKs to `file_entry` and the owning source table.
3. Register the variant in `index.ts` (`allSourceTypes` and `FileRefSchema`).
4. Route persistent write/delete behavior through the owning business service; `FileRefService` only exposes cross-source query/ref-count and temp-session helpers.

## Design Notes

- `sourceType` must be a string literal for discriminated-union dispatch.
- `role` is scoped per source type; there is no global role enum.
- `sourceId` format is domain-specific.
- Persistent source deletion should rely on DB-level cascade wherever a source table exists.
- `temp_session` is the exception: it is app-session memory only and participates in orphan sweep through cache pruning.
