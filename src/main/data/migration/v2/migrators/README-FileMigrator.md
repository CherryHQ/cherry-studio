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

Every migrated row is `internal` — v1 persisted a `files` row only after copying the bytes into `{userData}/Data/Files/`, so an `external` v1 row does not exist and is never fabricated.

| Condition | Result |
|-----------|--------|
| `row.path` starts with `{userData}/Data/Files/` | `internal`, `externalPath = null` |
| path fails the prefix check but a storage-name candidate exists on disk | `internal` — the row survives a cross-platform backup restore (#15733), where `row.path` carries foreign separators while the file sits right here |
| neither | skipped with a warning — dead metadata from an incomplete v1 delete |

The storage-name candidates come from `legacyStorageNames(row)` and are rebuilt from `{id}` + `{ext}`, never from `row.name`: v1's duplicate-upload path writes a double-extension `name` (`{id}.pdf.pdf`) that points nowhere, so trusting it would strand a physically present file for `FileManager.fileSweepTick` to reclaim. The candidate list keeps the raw `{id}{ext}` form alongside the canonical `{id}.{ext}` because v1 wrote both shapes (`saveBase64Image` stored a dotless ext, and an ext with a trailing space or dot has a matching on-disk name on POSIX).

When the match is a non-canonical candidate, the bytes are copied to `{id}.{normalizedExt}` before the row is prepared (#18187): `ext` is written normalized, and `resolvePhysicalPath` composes only the canonical name — without the copy the row migrates but every read of it is `ENOENT`. Copy, not rename, so a migration that aborts leaves v1's own `row.name` lookup working; the leftover raw blob is not swept, since `runFileSweep` keys orphans on the uuid stem. A failed copy warns and still migrates the row — skipping it instead would unreference the blob and hand it to the sweep.

The copy goes through tmp + fsync + rename (`copyToCanonicalName`, the flow of file-manager-architecture §5.1) rather than straight onto the canonical path. A crash mid-copy must not publish a truncated file there: the next run's candidate walk prefers whatever occupies the canonical name over the intact raw blob, so the retry would migrate corrupted bytes under the v1 `size` and never repair itself. Residue is a `.tmp-{uuid}` in the same directory, which the FS orphan sweep already collects.

### Ext Normalization

- Legacy v1 `ext` field may include a leading dot (`.pdf`, `.txt`) or be empty
- Leading dot is stripped before writing (`pdf`, `txt`)
- Empty / whitespace-only / missing ext → `null` in `file_entry.ext` (matches the `SafeExtSchema` whitespace guard in shared file `common.ts` so the migrated rows pass the same validation as v2-native writes)

### Timestamp Conversion

- `created_at` (ISO 8601 string) is parsed to ms epoch integer
- Missing / empty `created_at` → `Date.now()` silently (valid v1 case)
- Non-empty but unparseable → `Date.now()` plus a warning recorded against the
  row id (surfaced through `PrepareResult.warnings`). Falling back to "now"
  (not `0`) keeps migrated rows sortable next to v2-native rows; the warning
  is the diagnostic trail for users whose v1 data carried corrupted dates.
- Both `createdAt` and `updatedAt` are set to the same parsed value

### Name Derivation

- `name` = `origin_name` (falling back to `name`) basename without extension — preserves the user-visible filename
- **Lost original filename**: v1's duplicate-upload path overwrote `origin_name` with the internal storage name, so the user's filename was already gone before the migration ran. `hasLostOriginalFilename` detects the signature (`origin_name === {id}{ext}` **and** `name === {origin_name}{ext}`) and records a warning; the derived name stays the id, which is honest — it is what the file is now called on disk, and any friendlier name would be invented. Both conditions are required, and the second carries the weight. `saveBase64Image` also writes an `origin_name` that *is* the storage name — a generated image legitimately never had a user filename, so it must not be flagged — and the first condition misses it only because v1 stored that row's ext without the leading dot (`origin_name` is `{id}.png` while `{id}{ext}` reconstructs to `{id}png`). Relying on that coincidence would be fragile; what actually excludes those rows is the double-extension fingerprint, which only `findDuplicateFile` produces. The first condition earns its place by stopping the second from degenerating into `name === origin_name` for extensionless rows, which every external row satisfies.

  This migrator is the **sole producer** of that diagnostic. It owns the global `files` row, so it fires exactly once per corrupted file; `KnowledgeMappings` and `ChatMappings` see the same corruption through each item/message that references the file and deliberately stay quiet, because the engine concatenates every migrator's warnings into one un-deduped list shown to the user — warning there would scale the notice count with the reference count.

## Field Mappings

| Source (v1 `FileMetadata`) | Target (`file_entry`) | Notes |
|----------------------------|-----------------------|-------|
| `id` | `id` | Preserved verbatim |
| (not derived) | `origin` | Always `internal`; non-internal rows are skipped, not mapped |
| `origin_name` / `name` | `name` | Basename without ext |
| `ext` | `ext` | Leading dot stripped; empty/whitespace-only → null |
| `size` | `size` | Always non-null; recovered from disk when the v1 value is invalid |
| — | `externalPath` | Always null |
| (always null) | `deletedAt` | No v1 soft-delete state |
| `created_at` | `createdAt` | ISO → ms epoch; fallback Date.now() + warning on parse failure |
| `created_at` | `updatedAt` | Same as createdAt |

**Dropped v1 fields**: `count`, `tokens`, `purpose`, `type`, `origin_name` (stored as-is in name derivation only)

## Idempotency

The migrator is safe to re-run. `MigrationEngine.verifyAndClearNewTables` clears the file association tables and `file_entry` before each run, so `execute()` always starts from empty tables. The v1 id is preserved verbatim, so the engine-layer clear is the sole invariant — no `onConflict` guard or per-row pre-check is needed at the migrator layer.

## Validate Behavior

`validate()` performs:
1. **Count check**: asserts `SELECT count(*) FROM file_entry >= preparedEntries.length`
2. **Physical file sampling**: up to `VALIDATE_SAMPLE_LIMIT = 10` entries are checked for their physical file at `{userData}/Data/Files/{id}.{ext}` — the canonical `legacyStorageNames` candidate — via `fs.existsSync`. `10` is small enough to keep validate cheap on large migrations and large enough to catch a systematic "Files directory moved/missing" issue early; per-row I/O is intentionally bounded since the migration's own physical-copy step is the authoritative integrity boundary. Only the canonical candidate is probed, which is also what the runtime resolves — a row whose blob was found under a raw candidate has already been copied there by prepare, so this stays an honest readability check rather than a candidate walk. Missing physical files go through `this.recordWarning` (not validation errors) — v1 routinely leaves dangling `file_entry` rows behind (deleted attachments, interrupted uploads), and the DB row keeps the historical reference even when bytes are gone.

## Failure Handling

| Issue | Detection | Handling |
|-------|-----------|----------|
| **Malformed row** (missing id/path/name) | `toFileEntry()` returns null | Skipped; `skippedCount++`; warn logged |
| **Duplicate id** in v1 source | `seenIds` set in `prepare()` | Second occurrence skipped; warn logged |
| **Insert error** (DB constraint, disk full) | Transaction throws | `execute()` returns `success=false` with error message |
| **Missing files table** | `tableExists('files')` returns false | Prepare returns success with 0 items and a warning |
| **Orphan row** (not internal, no physical file) | Prefix check and every storage-name candidate fail | Skipped; warn logged |
| **Lost original filename** | `hasLostOriginalFilename()` signature match | Migrated intact under the id as its name; warn logged |

## Implementation Files

- `FileMigrator.ts` — main migrator class
- `mappings/legacyFileMappings.ts` — v1 `files`-row semantics (`normalizeExt`, `legacyStorageNames`, `hasLostOriginalFilename`), shared with `KnowledgeMappings`
- `__tests__/FileMigrator.test.ts` — unit tests
- `mappings/__tests__/legacyFileMappings.test.ts` — table-driven cases, one row per v1 producer
