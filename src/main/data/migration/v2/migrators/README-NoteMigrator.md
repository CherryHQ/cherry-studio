# NoteMigrator

Migrates all note files from the filesystem into the SQLite `note` table, preserving starred status from Redux.

## Data Sources

| Source | Key | Type |
|--------|-----|------|
| File system | `notesRoot/**/*.md` | Recursive directory scan |
| Redux `note` | `notesPath` | `string` (notes root directory, fallback: `getNotesDir()`) |
| Redux `note` | `starredPaths` | `string[]` (absolute paths of starred notes) |

## Target Table

`note` — see `src/main/data/db/schemas/note.ts`

## Field Mappings

| Source | Target Column | Transform |
|--------|---------------|-----------|
| (generated) | `id` | UUID v4 auto-generated |
| file path | `relative_path` | `path.relative(notesRoot, absolutePath)`, forward-slash normalized |
| `starredPaths` membership | `is_starred` | `true` if file path is in starredPaths set, `false` otherwise |
| (generated) | `created_at` | `Date.now()` at migration time |
| (generated) | `updated_at` | `Date.now()` at migration time |

## Key Transformations

- **File system scan**: Recursively walks `notesRoot` for all `.md` files, creating a `note` row for each.
- **Starred status**: Builds a `Set` from Redux `starredPaths` for O(1) lookup; files in the set get `isStarred: true`.
- **Absolute → Relative path**: Uses `path.relative()` then normalizes to forward slashes for cross-platform compatibility.
- **Notes root fallback**: If Redux `note.notesPath` is empty, falls back to `getNotesDir()` (default: `userData/Data/Notes`).

## Dropped Fields

| Redux Field | Reason |
|-------------|--------|
| `note.activeFilePath` | Runtime UI state → PersistCache (`notes.active_file_path`) |
| `note.expandedPaths` | Runtime UI state → PersistCache (`notes.expanded_paths`) |
| `note.settings.*` | User preferences → migrated by PreferencesMigrator |
| `note.sortType` | User preference → migrated by PreferencesMigrator |

## Edge Cases

- **Notes directory doesn't exist**: Migration succeeds with `processedCount: 0`.
- **Empty directory**: Migration succeeds with `processedCount: 0`.
- **Non-.md files**: Ignored during scan.
- **Unreadable subdirectory**: Logged as warning, skipped, other files still processed.
- **Starred path not found on disk**: The file was deleted; no row is created since the file doesn't exist.
