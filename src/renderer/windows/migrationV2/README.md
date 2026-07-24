# Migration V2 Window (Renderer)

Standalone renderer window that drives the migration workflow: drafts data exports from the legacy stores, coordinates with main via IPC, and renders stage/progress UI.

## Directory Layout

```
src/renderer/windows/migrationV2/
├── MigrationApp.tsx        # UI shell and stage logic
├── entryPoint.tsx          # Window bootstrap: styles + i18n init, then mounts MigrationApp
├── components/             # UI widgets (progress list, dialogs, window controls, confetti)
├── hooks/                  # Progress subscription + action helpers
├── exporters/              # Data exporters for Redux Persist and Dexie
├── i18n/                   # Migration-specific translations
└── index.html              # HTML entry; declares the logger window source (MigrationV2) via <meta>
```

## Flow Overview

1. `index.html` declares the logger window source (`MigrationV2`) via a `<meta name="logger-window-source">` tag; `entryPoint.tsx` then initializes styles and i18n before mounting `MigrationApp`.
2. `MigrationApp.tsx` renders the staged wizard: introduction → migration → completion/error. It calls action hooks to trigger IPC and exporter routines, and listens for progress updates to drive the steps/progress bars.
3. Hooks:
   - `useMigrationProgress` subscribes to `MigrationIpcChannels.Progress` and queries last error/initial progress on load.
   - The completion `Migration time` is measured in this window from the first visible `migration` stage update to the received `completed` update.
   - `useMigrationActions` wraps IPC invokes for start, retry, cancel, restart, and skip.
4. Exporters:
   - `ReduxExporter` pulls Redux Persist payload from `localStorage` (`persist:cherry-studio`), parses slices, and returns clean JS objects for main.
   - `DexieExporter` reads Dexie tables in primary-key pages and sends bounded JSON-array chunks via IPC (`migration:write-export-file`), so main can assemble the files on disk without direct browser access or whole-table renderer strings.
5. Components render the per-migrator list (`MigratorProgressList`), skip/close dialogs, window controls, and completion confetti used by the wizard.

## Failure Diagnostics

Only error and version-incompatible pages offer Save Diagnostic Bundle. The panel warns that application logs
may contain sensitive data and must not be shared publicly or outside Cherry Studio support. Saving never
uploads or attaches the bundle; metadata-only fallback is disclosed when logs cannot be included. After a
successful local-only save, the only support actions reveal the file and copy `support@cherry-ai.com`; no
native preboot action, mail client, or prefilled email is provided.

## Implementation Notes

- The renderer never writes directly to disk; it sends Redux data in-memory and streams Dexie exports to main via IPC. Main overwrites each table file at the start, appends chunks in order, and leaves the same JSON array format for downstream readers. Retrying therefore truncates any partial export before rebuilding it.
- Progress stages mirror shared types in `@shared/data/migration/v2/types` and must stay in sync with `MigrationIpcHandler` expectations.
- If you introduce new UI elements, keep the existing layout minimal and ensure they respond to the staged state machine rather than introducing new ad-hoc flags.
