# Migration V2 Window (Renderer)

Standalone renderer window that drives the migration workflow: drafts data exports from the legacy stores, coordinates with main via IPC, and renders stage/progress UI.

## Directory Layout

```
src/renderer/src/windows/migrationV2/
├── MigrationApp.tsx        # UI shell and stage logic
├── entryPoint.tsx          # Window bootstrap, logger + i18n wiring
├── components/             # UI widgets (progress list, stage indicator, buttons)
├── hooks/                  # Progress subscription + action helpers
├── exporters/              # Data exporters for Redux Persist and Dexie
├── i18n/                   # Migration-specific translations
└── migrationV2.html        # Built HTML entry (under dist)
```

## Flow Overview

1. `entryPoint.tsx` initializes styles, patches (antd React 19), logger source (`MigrationV2`), and i18n, then mounts `MigrationApp`.
2. `MigrationApp.tsx` renders the staged wizard: introduction → backup → migration → completion/error. It calls action hooks to trigger IPC and exporter routines, and listens for progress updates to drive the steps/progress bars.
3. Hooks:
   - `useMigrationProgress` subscribes to `MigrationIpcChannels.Progress`, queries last error/initial progress on load, and provides helpers to locally mark completion.
   - `useMigrationActions` wraps IPC invokes for backup, start, retry, cancel, and restart.
4. Exporters:
   - `ReduxExporter` pulls Redux Persist payload from `localStorage` (`persist:cherry-studio`), parses slices, and returns clean JS objects for main.
   - `DexieExporter` snapshots Dexie tables from IndexedDB to JSON via IPC (`migration:write-export-file`), so main can read from disk without direct browser access.
5. Components render the per-migrator list (`MigratorProgressList`), stage indicator, and footer action buttons used by the wizard.

## Implementation Notes

- The renderer never writes directly to disk; it sends Redux data in-memory and streams Dexie exports to main via IPC. Main drives the actual migration.
- Progress stages mirror shared types in `@shared/data/migration/v2/types` and must stay in sync with `MigrationIpcHandler` expectations.
- If you introduce new UI elements, keep the existing layout minimal and ensure they respond to the staged state machine rather than introducing new ad-hoc flags.
