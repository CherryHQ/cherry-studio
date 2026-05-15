# FileMigrator

`FileMigrator` migrates the legacy v1 Dexie `files` table into the v2 `file_entry` SQLite table.

## Data Sources

| Data | Source | File/Path |
|------|--------|-----------|
| File metadata | Dexie `files` table | `files.json` |

The table is streamed via `createStreamReader('files')` in batches of `BATCH_SIZE` (default `500`) to keep peak memory bounded even for large file collections — `500` is large enough to amortize the per-batch round-trip but small enough that one batch's worth of `FileMetadata` rows fits comfortably in memory.

## Target Tables

- `file_entry`

## Outputs

- **`file_entry` rows** — one row per valid source file

No cross-migrator shared state is published: per migration-plan §2.9 the v1 file id is preserved verbatim into v2, so downstream migrators (ChatMigrator, KnowledgeMigrator, …) reference files by the same id they already have without needing a translation map.

## Key Transformations

### ID Preservation

- The v1 file id is carried into v2 `file_entry.id` unchanged (no translation, no remap)
- `FileEntryIdSchema = z.uuid()` accepts both legacy v4 and v2-native v7 ids
- New entries created in v2 still receive a v7 id via `uuidPrimaryKeyOrdered()`; the column allows both shapes to coexist

### Origin Discrimination

| Condition | origin | externalPath | size |
|-----------|--------|--------------|------|
| path starts with `{userData}/Data/Files/` | `internal` | null | row.size (≥0) |
| any other absolute path | `external` | row.path | null |

### Ext Normalization

- Legacy v1 `ext` field may include a leading dot (`.pdf`, `.txt`) or be empty
- Leading dot is stripped before writing (`pdf`, `txt`)
- Empty / whitespace-only / missing ext → `null` in `file_entry.ext` (matches the `SafeExtSchema` whitespace guard in essential.ts so the migrated rows pass the same validation as v2-native writes)

### Timestamp Conversion

- `created_at` (ISO 8601 string) is parsed to ms epoch integer
- Missing / empty `created_at` → `Date.now()` silently (valid v1 case)
- Non-empty but unparseable → `Date.now()` plus a warning recorded against the
  row id (surfaced through `PrepareResult.warnings`). Falling back to "now"
  (not `0`) keeps migrated rows sortable next to v2-native rows; the warning
  is the diagnostic trail for users whose v1 data carried corrupted dates.
- Both `createdAt` and `updatedAt` are set to the same parsed value

### Name Derivation

- **Internal** rows: `name` = `origin_name` basename without extension (preserves the user-visible filename)
- **External** rows: `name` = path basename without extension

## Field Mappings

| Source (v1 `FileMetadata`) | Target (`file_entry`) | Notes |
|----------------------------|-----------------------|-------|
| `id` | `id` | Preserved verbatim |
| (derived from `path`) | `origin` | `internal` or `external` |
| `origin_name` / `name` | `name` | Basename without ext |
| `ext` | `ext` | Leading dot stripped; empty/whitespace-only → null |
| `size` | `size` | Non-null for internal; null for external |
| `path` (external only) | `externalPath` | null for internal |
| (always null) | `trashedAt` | No v1 trash state |
| `created_at` | `createdAt` | ISO → ms epoch; fallback Date.now() + warning on parse failure |
| `created_at` | `updatedAt` | Same as createdAt |

**Dropped v1 fields**: `count`, `tokens`, `purpose`, `type`, `origin_name` (stored as-is in name derivation only)

## Idempotency

The migrator is safe to re-run. Two layers of protection:

1. **Engine layer**: `MigrationEngine.verifyAndClearNewTables` clears `file_ref` and `file_entry` before each run, so retries start from a clean slate.
2. **Migrator layer (belt-and-braces)**: `execute()` checks `file_entry.id` for each prepared row before insert and skips rows already present, so a partial migration that somehow left rows behind doesn't crash on the UNIQUE constraint.

Because the v1 id is preserved verbatim, the engine-layer clear is the dominant invariant; the migrator-layer check is defence in depth.

## Validate Behavior

`validate()` performs:
1. **Count check**: asserts `SELECT count(*) FROM file_entry >= preparedEntries.length`
2. **Physical file sampling**: up to `VALIDATE_SAMPLE_LIMIT = 10` internal entries are checked for their physical file at `{userData}/Data/Files/{id}.{ext}` via `fs.existsSync`. `10` is small enough to keep validate cheap on large migrations and large enough to catch a systematic "Files directory moved/missing" issue early; per-row I/O is intentionally bounded since the migration's own physical-copy step is the authoritative integrity boundary. Missing physical files produce `file_entry_missing_physical_file` errors.

External entries are not sampled in validate (physical files are user-owned and may have moved).

## Failure Handling

| Issue | Detection | Handling |
|-------|-----------|----------|
| **Malformed row** (missing id/path/name) | `toFileEntry()` returns null | Skipped; `skippedCount++`; warn logged |
| **Duplicate id** in v1 source | `seenIds` set in `prepare()` | Second occurrence skipped; warn logged |
| **Insert error** (DB constraint, disk full) | Transaction throws | `execute()` returns `success=false` with error message |
| **Missing files table** | `tableExists('files')` returns false | Prepare returns success with 0 items and a warning |

## Implementation Files

- `FileMigrator.ts` — main migrator class
- `__tests__/FileMigrator.test.ts` — unit tests
