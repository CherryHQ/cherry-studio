# Migration V2 Window (Renderer)

Standalone renderer window that drives the migration workflow: drafts data exports from the legacy stores, coordinates with main via IPC, and renders stage/progress UI.

## Directory Layout

```
src/renderer/src/windows/migrationV2/
├── MigrationApp.tsx        # UI shell and stage logic
├── entryPoint.tsx          # Window bootstrap, logger + i18n wiring
├── components/             # Shared layout/presentation pieces reused by multiple screens
├── hooks/                  # Progress subscription + action helpers
├── exporters/              # Data exporters for Redux Persist and Dexie
├── screens/                # Four main flow screens plus the failed screen
├── i18n/                   # Migration-specific translations
└── migrationV2.html        # Built HTML entry (under dist)
```

## Flow Overview

1. `entryPoint.tsx` initializes styles, patches (antd React 19), logger source (`MigrationV2`), and i18n, then mounts `MigrationApp`.
2. `MigrationApp.tsx` owns the shell and switches between five screen files: `IntroductionScreen`, `BackupScreen`, `MigrationScreen`, `CompletionScreen`, and `FailedScreen`. Main remains the owner of `MigrationStage`; the renderer keeps only local UI state such as selected backup mode and export progress.
3. Hooks:
   - `useMigrationProgress` subscribes to `MigrationIpcChannels.Progress` and queries the initial progress / last error on load.
   - `useMigrationActions` wraps IPC invokes for flow transitions such as back, backup confirmation, preparation, retry, cancel, and restart.
4. Exporters:
   - `ReduxExporter` pulls Redux Persist payload from `localStorage` (`persist:cherry-studio`), parses slices, and returns clean JS objects for main.
   - `DexieExporter` snapshots Dexie tables from IndexedDB to JSON via IPC (`migration:write-export-file`), so main can read from disk without direct browser access.
5. `screens/` own each visible page, including its footer actions. `components/` only keep shared pieces such as the header/footer shell, common page layout, state panel, progress list, and stage indicator.

## Implementation Notes

- The renderer never writes directly to disk; it sends Redux data in-memory and streams Dexie exports to main via IPC. Main drives the actual migration.
- Progress stages mirror shared types in `@shared/data/migration/v2/types` and must stay in sync with `MigrationIpcHandler` expectations.
- If you introduce new UI elements, keep the existing layout minimal and ensure they respond to the staged state machine rather than introducing new ad-hoc flags.
