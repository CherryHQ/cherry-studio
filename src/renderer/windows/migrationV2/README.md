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
   - For Chromium's exact irrecoverable missing-file error, `DexieExporter` falls back from a page to individual records, then to an empty table, then to empty supported Dexie tables if the database cannot open. Other errors remain fatal and the legacy database stays read-only.
5. Components render the per-migrator list (`MigratorProgressList`), skip/close dialogs, window controls, and completion confetti used by the wizard.

## Failure Diagnostics

Only error and version-incompatible pages offer Save Diagnostic Bundle. On the error page, the full failure
message stays visible for screenshots while the primary flow contains only Retry and a large secondary More
options button. More options keeps Close App in its lower-left footer and presents three regular choices:
"Save troubleshooting information" first, then "Use V2 without importing V1 data", then "Continue using V1".
The first option opens a dedicated "Save troubleshooting file" dialog with the detailed privacy notice and save
action. After a successful save and the export dialog's close animation, a follow-up dialog offers Open file
location and Copy feedback email. The V2 option opens the existing destructive confirmation; "Continue using V1"
opens `V1DownloadDialog`, whose download action opens the localized V1 download page. Clicking the visible error
details, or focusing them and pressing Enter/Space, opens the same diagnostic export dialog; selecting error text
for copying does not trigger it. The version-incompatible page keeps the standalone diagnostic panel.
Every More options choice waits for that dialog's shared close animation to finish before opening its follow-up
dialog, preventing overlapping overlays and focus restoration from the closing dialog.

The diagnostic panel warns that application logs may contain sensitive data and must not be shared publicly or
outside Cherry Studio support. Saving never uploads or attaches the bundle; metadata-only fallback is disclosed
when logs cannot be included. After a successful local-only save, the only support actions reveal the file and
copy `support@cherry-ai.com`; no mail client or prefilled email is provided. The V1 dialog also opens
only when selected from More options. The window runs on the `simplest` preload (no shell access), so the
download button asks main to open the page, passing the wizard's current language;
`MigrationIpcHandler` owns the URL table and maps that language to a regional site with the same `zh` test
`i18n/resolver.ts` uses, so the site is the one the user can read and the renderer can never name a URL of its
own.

On completion, non-fatal migration notices stay collapsed into a single-line warning entry below Restart. The
entry opens a scrollable dialog with the full notice list and a full-width copy action at the bottom of the
content; the dialog intentionally has no footer.

An IndexedDB recovery report still reaches the completed stage, but replaces confetti with a warning state and
explains which user-facing data categories were not imported. Recovery notices are aggregated by table and
merged with existing migrator notices in both the dialog and copied text. The UI never shows sampled primary
keys or record content; conversation and message-content notices state their possible user-visible impact.

## Implementation Notes

- The renderer never writes directly to disk; it sends Redux data in-memory and streams Dexie exports to main via IPC. Main overwrites each table file at the start, appends chunks in order, and leaves the same JSON array format for downstream readers. Retrying therefore truncates any partial export before rebuilding it.
- Progress stages mirror shared types in `@shared/data/migration/v2/types` and must stay in sync with `MigrationIpcHandler` expectations.
- If you introduce new UI elements, keep the existing layout minimal and ensure they respond to the staged state machine rather than introducing new ad-hoc flags.
