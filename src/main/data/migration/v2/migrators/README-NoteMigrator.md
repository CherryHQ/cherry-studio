# NoteMigrator

Migrates note metadata (starred paths) from the legacy Redux `note` slice into the SQLite `note` table.

## Data Sources

| Source | Key | Type |
|--------|-----|------|
| Redux `note` | `starredPaths` | `string[]` (absolute file paths) |
| Redux `note` | `notesPath` | `string` (notes root directory) |

## Target Table

`note` — see `src/main/data/db/schemas/note.ts`

## Field Mappings

| Source | Target Column | Transform |
|--------|---------------|-----------|
| (generated) | `id` | UUID v4 auto-generated |
| `starredPaths[i]` | `relative_path` | `path.relative(notesRoot, absolutePath)`, forward-slash normalized |
| (constant) | `is_starred` | Always `true` (only starred paths are migrated) |
| (generated) | `created_at` | `Date.now()` at migration time |
| (generated) | `updated_at` | `Date.now()` at migration time |

## Key Transformations

- **Absolute → Relative path**: Uses `path.relative()` to convert absolute file paths to paths relative to `notesRoot`, then normalizes separators to forward slashes (`/`) for cross-platform compatibility (Mac ↔ Windows backup-restore).
- **Deduplication**: Duplicate paths are removed via `Set` before insertion.
- **Filtering**: Empty strings, whitespace-only strings, and non-string values are filtered out.

## Dropped Fields

| Redux Field | Reason |
|-------------|--------|
| `note.activeNotePath` | Runtime UI state → moved to PersistCache (`notes.active_file_path`) |
| `note.expandedKeys` | Runtime UI state → moved to PersistCache (`notes.expanded_paths`) |

## Edge Cases

- **Empty `notesPath`**: If notes root is empty/undefined, the raw path is stored as-is.
- **No starred paths**: Migration succeeds with `processedCount: 0`.
- **Non-string entries in array**: Filtered out during prepare phase.
