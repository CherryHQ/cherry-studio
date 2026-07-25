# Cache cleanup and v1 data audit

This document records the ownership and deletion rules behind the data cleanup
dialog. The implementation is intentionally allowlist-based: a path being under
the Cherry Studio user-data directory is not enough on its own to make it safe
to delete.

Both `legacy_v1` and `restore_staging` require
`migration_v2_status.status === "completed"` in the v2 main database. The
inspection returns this as a `completed | incomplete` migration-status snapshot,
and the execution path checks it independently.

## Cleanup groups

| Group | Included data | Size basis | Deletion |
| --- | --- | --- | --- |
| `normal_cache` | HTTP cache reported by the default and `persist:webview` Electron sessions; code, GPU, shader, Dawn, CacheStorage, and Shared Dictionary disk caches; Cherry Studio temporary files; active `{userData}/Runtime/trace` files and legacy `~/.cherrystudio/trace` files | Electron cache values plus regular-file disk usage; duplicate disk paths are counted once | Electron session cache APIs, recreation of the app temp directory, `TraceStorageService.cleanLocalData()`, and removal of the validated legacy trace directory |
| `site_data` | Default-session cookies; `persist:webview` cookies, localStorage, IndexedDB, FileSystem, Service Worker data except CacheStorage, and WebSQL | On-disk estimate because Chromium may compress or share metadata | Electron session data APIs; clearing this group may sign the user out of websites |
| `legacy_v1` | The explicit targets in the audit below | File usage is read from disk; localStorage and IndexedDB are logical byte estimates | Best effort per target; a failure does not stop the remaining targets |
| `restore_staging` | Exact `Data.restore`, `IndexedDB.restore`, and `Local Storage.restore` directories | Regular-file disk usage | Removes each selected directory in full and therefore cancels that pending restore |

Missing files contribute `0 B`. Symbolic links are never followed or counted.
A candidate path that is itself a symbolic link is not removed. Legacy
directories that require content validation are retained when they contain a
symbolic link. Restore directories are removed in full; nested symbolic links
are unlinked without following their targets. An unreadable or invalid candidate
makes the group size partial or unavailable but does not make adjacent
candidates eligible.

## `legacy_v1` audit

| Candidate | Ownership / validation | Cleanup behavior |
| --- | --- | --- |
| Renderer localStorage | Exact key allowlist: `persist:cherry-studio`, `onboarding-completed`, `memory_currentUserId`, `privacy-popup-accepted`, `language`, `openai_alert_closed`, `migration:theme_mode`, `ai302_token`, `tokenLanyunToken`, `mcprouter_token`, and `tokenflux_token` | Counts UTF-8 bytes of each key and value, then removes only those keys |
| Renderer IndexedDB | Exact database name `CherryStudio`; opened in Dexie dynamic mode and read in primary-key pages | Counts JSON-serialized logical records, then calls `indexedDB.deleteDatabase("CherryStudio")`; a blocked deletion is reported as a partial failure |
| `{userData}/Data/agents.db` | Regular file whose SQLite schema contains at least one recognized v1 agents table | Removes the database and regular-file `-wal`, `-shm`, and `-journal` sidecars |
| `{userData}/agents.db` | Same validation as above; the database and every present sidecar are byte-for-byte identical to the corresponding `{userData}/Data/agents.db` set | Removes it as a redundant copy; a different or incomplete copy is retained |
| `{userData}/config.json` | Exact legacy location; regular file only, with contents intentionally not inspected | Removes the complete file |
| `~/.cherrystudio/config/config.json` | Array-form `appDataPath` mapping whose current executable entry exactly matches the migrated BootConfig path | Removes only the current executable's mapping; preserves every other mapping and field, and removes the file only when it becomes empty |
| `~/.cherrystudio/install` | Exact cleanup-only legacy CLI install root; regular directory with no symbolic links | Removes the complete directory and all regular contents |
| `{userData}/window-state.json`, `miniWindow-state.json`, and `quickAssistant-state.json` | JSON objects restricted to the v1 window bounds/state shape | Removes each validated file |
| `{userData}/migration_temp` | Exact migration-owned directory, regular directory only | Removes the directory |
| `{userData}/Data/Files/custom-minapps.json` | Regular JSON file containing an array | Removes the file |
| Top-level files under `Data/KnowledgeBase` | Regular SQLite files with the legacy `vectors` table and its `id`, `pageContent`, `uniqueLoaderId`, `source`, and `vector` columns | Removes each database and regular-file sidecars; nested v2 base directories are never candidates |
| `Data/Memory/memories.db` and the old root `memories.db` | Regular SQLite files with a `memories` table containing `id` and `memory` | Removes each validated database and regular-file sidecars |

## Restore staging ownership

The legacy backup manager exclusively owns the exact `IndexedDB.restore`,
`Local Storage.restore`, and `Data.restore` paths. Each candidate must be a
regular directory and must not itself be a symbolic link. Their contents are not
allowlisted: selecting this group removes each directory in full, including
unknown entries. Nested symbolic links are removed as links and are never
followed.

## Explicitly retained

The cleanup does not target v2 `cache.json`, renderer `cs_cache_persist`, active
provider tokens, the v2 main SQLite database, `version.log`, application logs,
Runtime or Toolchain assets other than the cache-only `Runtime/trace`, current `restore-staging`, or
`restore-journal.json`. It also does not delete nested v2 knowledge-base
directories or arbitrary files merely because they live in user data.
