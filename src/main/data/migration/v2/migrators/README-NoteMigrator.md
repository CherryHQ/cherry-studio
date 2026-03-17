# NoteMigrator

Migrates starred note paths from Redux into the SQLite `note` table. Non-starred note files are lazily registered by NoteService when the notes directory is loaded at runtime.

## Data Sources

| Source | Key | Type |
|--------|-----|------|
| Redux `note` | `starredPaths` | `string[]` (absolute file paths) |
| Redux `note` | `notesPath` | `string` (notes root directory, fallback: `getNotesDir()`) |

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

## Design Decision: Starred-Only Migration

Only starred paths are migrated. Other note files (plain `.md` files on disk) are **not** scanned during migration. Instead, NoteService lazily registers them when the notes directory is first loaded at app startup. This approach:

- Keeps migration fast (no filesystem I/O)
- Avoids dependency on filesystem state (notes directory may not be mounted/restored yet)
- Uses a single code path for registering new files (NoteService handles both migration and normal use)

## Dropped Fields

| Redux Field | Reason |
|-------------|--------|
| `note.activeFilePath` | Runtime UI state → PersistCache (`notes.active_file_path`) |
| `note.expandedPaths` | Runtime UI state → PersistCache (`notes.expanded_paths`) |
| `note.settings.*` | User preferences → migrated by PreferencesMigrator |
| `note.sortType` | User preference → migrated by PreferencesMigrator |

## Edge Cases

- **Empty `notesPath`**: Falls back to `getNotesDir()` (default: `userData/Data/Notes`).
- **No starred paths**: Migration succeeds with `processedCount: 0`.
- **Duplicate paths in Redux**: Deduplicated via `Set` before insertion.
- **Non-string entries**: Filtered out during prepare phase.
