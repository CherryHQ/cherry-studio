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
   - `useMigrationActions` wraps IPC invokes for start, retry, cancel, restart, skip, and diagnostic support actions.
4. Exporters:
   - `ReduxExporter` pulls Redux Persist payload from `localStorage` (`persist:cherry-studio`), parses slices, and returns clean JS objects for main.
   - `DexieExporter` snapshots allowlisted Dexie tables from IndexedDB and sends their JSON plus a logical table target via IPC (`migration:write-export-file`). Main owns every physical export path.
5. Components render the per-migrator list (`MigratorProgressList`), skip/close dialogs, window controls, and completion confetti used by the wizard.

## Implementation Notes

- The renderer never writes directly to disk and never receives migration export paths; it sends Redux data in-memory and logical Dexie/localStorage export payloads to main. Main validates the target, owns the workspace, and drives the actual migration.
- The diagnostic panel appears only for migration errors and version-incompatible blocks (including a renderer export failure after Main records it). Saving sends a payload-free command: Main chooses the destination, builds the bundle, and retains the most recently saved path.
- While a diagnostic save is active, controls that could exit or replace the failure state are disabled, and Main independently rejects state-changing IPC. Closing waits for the save to settle without a timeout. The saved notice distinguishes retryable and non-retryable missing-log outcomes, discloses that basic diagnostics can contain raw exception text, complete stacks, and absolute paths, always states that the bundle is not uploaded automatically, and warns only when the final compressed ZIP is strictly larger than 15 MiB.
- After a successful save, the panel can ask Main to open a prefilled support email, reveal the ZIP, or copy the support address. A one-click save-again action appears only when log collection recommends retry; native preboot dialogs use the same condition while retaining their original failure decisions. The user must inspect and manually attach the bundle; the app never uploads, attaches, or sends it.
- Progress stages mirror shared types in `@shared/data/migration/v2/types` and must stay in sync with `MigrationIpcHandler` expectations.
- If you introduce new UI elements, keep the existing layout minimal and ensure they respond to the staged state machine rather than introducing new ad-hoc flags.
