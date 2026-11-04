# Web Core

The Web edition's Core Worker: it owns the user's SQLite database in the browser and
serves DataApi requests with the unmodified main-process data services. See the
[Agent Note](../../.agents/notes/proposed/architecture/2026-10-20-web-core-database.md).

- `./worker` — `startCoreWorker(self, extraCommands?)` turns a dedicated Worker into a
  Core Worker. Commands: `open` (account), `request` (a DataApi `DataRequest`), `close`.
- `./client` — `CoreClient` on the page: `open()`, `request()`, and `onBroadcast()` for
  forwarded `DataApi_DataChanged` events.

## How the data layer runs here

The Worker build (`vite.config.ts`) aliases the few main-process modules the services
touch to browser implementations in `src/runtime/`: `@application` (only `DbService` and
`WindowManager`), `@logger`, `diagnostics`, `platform`, `node:crypto`, `node:util`,
better-sqlite3 (→ `@cherrystudio/sqlite-wasm-compat`) and drizzle's file-reading
migrator (→ migrations bundled at build time). Nothing under `src/main` is edited.
A build plugin fails on any other Node built-in or Electron import, so a served service
that grows a desktop-only dependency breaks `build:harness` instead of the browser.

Only the topic and message routes (`topicHandlers`, `messageHandlers`) are served.
`/search/contents` also searches agent sessions, whose services are not browser-ready yet.

## Database invariants

- Non-pooled `opfs` VFS. The pooled `opfs-sahpool` VFS corrupted databases when a reload
  killed the Worker mid-write; `opfs` rolls back. It requires a cross-origin-isolated page
  (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`).
- One Web Lock per account. `opfs` does not stop a second tab from opening the file, so the
  lock is the single-writer guard. `open` waits up to `handoverTimeoutMs` (3 s) for a
  reloaded page's previous Worker to release the lock and its file handles.
- No seeders run yet; the Web edition's defaults arrive from the enterprise backend.

## Tests

`pnpm test:web-core:browser` builds `harness/` and runs `e2e/` with Playwright in Chromium,
WebKit and Firefox (`pnpm exec playwright install chromium webkit firefox` once). The
harness Worker adds test-only commands (`sql`, `seedMessages`, `integrity`, `searchMessages`).
`WEB_CORE_SCALE=1` adds the 50k-message timing run.
