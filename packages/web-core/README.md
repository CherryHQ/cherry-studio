# Web Core

The Web edition's Core Worker: it owns the user's SQLite database in the browser, serves
DataApi requests and runs chat turns with the unmodified main-process services. See the
[Agent Note](../../.agents/notes/proposed/architecture/2026-10-20-web-core-database.md).

- `./worker` — `startCoreWorker(self, extraCommands?)` turns a dedicated Worker into a
  Core Worker. Commands: `open` (account), `request` (a DataApi `DataRequest`), `close`.
- `./client` — `CoreClient` on the page: `open()`, `request()`, and `onBroadcast()` for
  forwarded `DataApi_DataChanged` events.

## How the data layer runs here

The Worker build (`vite.config.ts`) aliases the few main-process modules the services
touch to browser implementations in `src/runtime/`: `@application` (only the services
registered by `startCoreWorker`), `@logger`, `diagnostics`, `platform`, `electron` (only
`ipcMain` and `app.getLocale()`), `node:crypto`, `node:os`, `node:path`, `node:util`,
`node:buffer`, better-sqlite3 (→ `@cherrystudio/sqlite-wasm-compat`), drizzle's
file-reading migrator (→ migrations bundled at build time) and the provider registry
loader (→ the bundled catalog). Nothing under `src/main` is edited.
A build plugin fails on any other Node built-in or Electron import, so a served service
that grows a desktop-only dependency breaks `build:harness` instead of the browser.

The topic, message, provider, model and assistant routes are served. `/search/contents`
also searches agent sessions, whose services are not browser-ready yet.

## How chat runs here

`open` also starts `AiStreamManager` (its `onInit` marks replies a closed tab left pending as
failed) and `AiService` (its desktop `onInit` is skipped), next to `WebPreferenceService`
(stored preferences over the defaults, read-only) and `WebCacheService` (memory and shared
tiers, not relayed to the page). Traces are dropped: the desktop trace window has no Web
counterpart. `close` stops live streams before closing the database.

`workerModuleReplacements` swaps the entry modules of desktop features the Web edition leaves
out (skills, built-in tools, agent sessions, channels, attachments and file storage, model
listing, web search, Copilot / Grok CLI / Ollama, trace storage, devtools) for stand-ins in
`src/disabled/` that throw `WebUnsupportedError` when called. Swapping the entry module keeps
the feature's dependencies out of the bundle. Provider requests use the Worker's `fetch`, so
an endpoint must allow CORS from the page's origin.

The Worker build moves every eagerly loaded module into a `core` chunk. WebKit evaluates a
module Worker's script a second time when a lazily loaded chunk imports from it, which
started a second Core Worker without a database.

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
harness Worker adds test-only commands (`sql`, `seedMessages`, `integrity`, `searchMessages`,
`chat`). `e2e/mockProvider.ts` is the OpenAI-compatible endpoint the chat tests talk to.
`WEB_CORE_SCALE=1` adds the 50k-message timing run.
