# NoteMigrator

Migrates legacy notes UI state from Redux into the SQLite `note` table.

## Source

- Redux category: `note`
- Fields read: `notesPath`, `starredPaths`, `expandedPaths`

## Target

- Table: `note`
- Unique key: `rootPath + path`

## Mapping

| Legacy field | Target field |
| --- | --- |
| `notesPath` | `rootPath` |
| `starredPaths[]` | `path`, `isStarred = true` |
| `expandedPaths[]` | `path`, `isExpanded = true` |

If a path appears in both starred and expanded lists, both flags are preserved in one row.

## Dropped Fields

- `activeFilePath`: not migrated; re-established at runtime in the `notes.active_file_path` memory Cache.
- `activeNodeId`: derived from `activeFilePath + notesTree`, not migrated.
- `notesPath`: also migrated to the `feature.notes.path` Preference by the Preferences migrator.
- `sortType`: migrated to the `feature.notes.sort_type` Preference by the Preferences migrator.

## Notes

The Markdown files and scanned directory tree remain the source of truth. This migrator only preserves long-lived note row state.
