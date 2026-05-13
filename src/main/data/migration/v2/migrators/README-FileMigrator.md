# FileMigrator

`FileMigrator` migrates the legacy v1 Dexie `files` table into the v2 `file_entry` SQLite table.

## Data Sources

| Data | Source | File/Path |
|------|--------|-----------|
| File metadata | Dexie `files` table | `files.json` |

The table is streamed in batches (BATCH_SIZE = 500) via `createStreamReader('files')` to handle large file lists without loading everything into memory.

## Target Tables

- `file_entry`

## Outputs

- **`file_entry` rows** — one row per valid source file
- **`sharedData['file.idRemap']`** — `Map<oldId, newId>` written after execute(); downstream migrators (e.g., ChatMigrator) use this to fix file references in messages

## Key Transformations

### ID Translation (v4 → deterministic v5)

- UUID v7 ids are preserved as-is (pass-through identity)
- All other ids (v4 and non-standard) are translated deterministically via `uuidv5(oldId, FILE_MIGRATION_NAMESPACE)`
- The namespace is a fixed constant; changing it would break idempotency across runs
- v5 uuid output is used as the v2 `file_entry.id`

### Origin Discrimination

| Condition | origin | externalPath | size |
|-----------|--------|--------------|------|
| path starts with `{userData}/Data/Files/` | `internal` | null | row.size (≥0) |
| any other absolute path | `external` | row.path | null |

### Ext Normalization

- Legacy v1 `ext` field may include a leading dot (`.pdf`, `.txt`) or be empty
- Leading dot is stripped before writing (`pdf`, `txt`)
- Empty / missing ext → `null` in `file_entry.ext`

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
| `id` | `id` | Translated via `translateId()` |
| (derived from `path`) | `origin` | `internal` or `external` |
| `origin_name` / `name` | `name` | Basename without ext |
| `ext` | `ext` | Leading dot stripped; empty → null |
| `size` | `size` | Non-null for internal; null for external |
| `path` (external only) | `externalPath` | null for internal |
| (always null) | `trashedAt` | No v1 trash state |
| `created_at` | `createdAt` | ISO → ms epoch; fallback Date.now() |
| `created_at` | `updatedAt` | Same as createdAt |

**Dropped v1 fields**: `count`, `tokens`, `purpose`, `type`, `origin_name` (stored as-is in name derivation only)

## Idempotency

The migrator is safe to run multiple times:

1. `translateId()` maps each v1 id to the same v2 id deterministically (same namespace + same input → same output)
2. In `execute()`, each prepared entry is checked against `file_entry.id` before insert
3. Already-present rows are skipped (not re-inserted); they are still added to `idRemap`

## Validate Behavior

`validate()` performs:
1. **Count check**: asserts `SELECT count(*) FROM file_entry >= preparedEntries.length`
2. **Physical file sampling**: for up to 10 internal entries, checks that `{userData}/Data/Files/{id}.{ext}` exists on disk via `fs.existsSync`. Missing physical files produce `file_entry_missing_physical_file` errors.

External entries are not sampled in validate (physical files are user-owned and may have moved).

## Failure Handling

| Issue | Detection | Handling |
|-------|-----------|----------|
| **Malformed row** (missing id/path/name) | `toFileEntry()` returns null | Skipped; `skippedCount++`; warn logged |
| **Duplicate v2 id** (two v1 ids translate to same v2 id) | `seenIds` set in `prepare()` | Second occurrence skipped; warn logged |
| **Insert error** (DB constraint, disk full) | Transaction throws | `execute()` returns `success=false` with error message |
| **Missing files table** | `tableExists('files')` returns false | Prepare returns success with 0 items and a warning |

## Implementation Files

- `FileMigrator.ts` — main migrator class
- `__tests__/FileMigrator.test.ts` — unit tests (23 test cases)
