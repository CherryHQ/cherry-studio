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
   - `DexieExporter` snapshots Dexie tables from IndexedDB to JSON via IPC (`migration:write-export-file`), so main can read from disk without direct browser access.
5. Components render the per-migrator list (`MigratorProgressList`), skip/close dialogs, window controls, diagnostic save actions, and completion confetti used by the wizard.

## Diagnostic Failure Handoff

- Exporters report failures with the strict `MigrationRendererExportFailureReport` tag before rethrowing. The report
  identifies only the source role and operation role; the original UI error remains separate and is never copied into
  persisted diagnostics.
- The version-incompatibility page remains part of this window and exposes the same diagnostic save action for
  `no_version_log`, `v1_too_old`, and `v2_gateway_skipped` blocks.
- Migration errors, warning-bearing completion, recovered interruption, renderer crash, and renderer unresponsive
  states can save a bundle. A warning-free completion does not show diagnostic controls.
- Saving uses the native file dialog. Save and restart/close actions stay disabled while it is open. After success,
  the window offers reveal, copy-support-address, and open-email-client actions; it never uploads or attaches the ZIP.
- If a blocking failure occurs before this renderer opens, or the renderer is gone/hung, the main-process native
  dialog exposes the same save capability without requiring the migration window.

## Implementation Notes

- The renderer never writes directly to disk; it sends Redux data in-memory and streams Dexie exports to main via IPC. Main drives the actual migration.
- Diagnostic bundle persistence is also main-owned; renderer code requests a save destination and displays only the
  bounded result returned over IPC.
- Progress stages mirror shared types in `@shared/data/migration/v2/types` and must stay in sync with `MigrationIpcHandler` expectations.
- If you introduce new UI elements, keep the existing layout minimal and ensure they respond to the staged state machine rather than introducing new ad-hoc flags.
