# Web Core

The Web edition's Core Worker: it owns the user's SQLite database in the browser and runs
the unmodified main-process services, which answer the unmodified desktop preload and
renderer services in the page over emulated Electron IPC. See the Agent Notes for the
[database](../../.agents/notes/proposed/architecture/2026-10-20-web-core-database.md),
[chat](../../.agents/notes/proposed/architecture/2026-10-20-web-core-ai.md) and
[page bridge](../../.agents/notes/proposed/architecture/2026-10-20-web-core-page-bridge.md).

- `./worker` — `startCoreWorker(self, extraCommands?)` turns a dedicated Worker into a
  Core Worker. Commands: `open` (account), `request` (a DataApi `DataRequest`),
  `ipc-invoke` / `ipc-send` (the page's `ipcRenderer`), `close`.
- `./client` — `CoreClient` on the page: `open()`, `request()`, and `onBroadcast()` for
  every `webContents.send` of the Worker (e.g. `DataApi_DataChanged`).
- `src/page/preload.ts` — imported before any renderer module, it runs the desktop preload
  in the page; `connectCore(client)` then routes its `ipcRenderer` to the Worker.

## How the data layer runs here

The Worker build (`vite.config.ts`) aliases the few main-process modules the services
touch to browser implementations in `src/runtime/`: `@application` (only the services
registered by `startCoreWorker`), `@logger`, `diagnostics`, `platform`, `electron` (the
`ipcMain` registries, the page as the only window and `app.getLocale()`), `node:crypto`, `node:os`, `node:path`, `node:util`,
`node:buffer`, better-sqlite3 (→ `@cherrystudio/sqlite-wasm-compat`), drizzle's
file-reading migrator (→ migrations bundled at build time) and the provider registry
loader (→ the bundled catalog). `BootConfigService` keeps the defaults in memory,
`validateSender` accepts the page (a dedicated Worker only hears from it), and
`CacheService`'s persist file lives in memory. Nothing under `src/main` is edited.
A build plugin fails on any other Node built-in or Electron import, so a served service
that grows a desktop-only dependency breaks `build:harness` instead of the browser.

The topic, message, provider, model and assistant routes are served. `/search/contents`
also searches agent sessions, whose services are not browser-ready yet. Of the IpcApi
routes only `ai.stream.*` are served; the others answer that the Web edition lacks them.

## How chat runs here

`CacheService`, `DataApiService` and `IpcApiService` start with the Worker. `open` seeds the
default preference rows and starts `PreferenceService`, `AiStreamManager` (its `onInit` marks
replies a closed tab left pending as failed) and `AiService` (its desktop `onInit` is
skipped). Traces are dropped: the desktop trace window has no Web
counterpart. `close` stops live streams before closing the database.

`workerModuleReplacements` swaps the entry modules of desktop features the Web edition leaves
out (skills, built-in tools, agents and agent sessions, channels, attachments and file storage, model
listing, web search, Copilot / Grok CLI / Ollama, trace storage, devtools) for stand-ins in
`src/disabled/` that throw `WebUnsupportedError` when called. Swapping the entry module keeps
the feature's dependencies out of the bundle. Provider requests use the Worker's `fetch`, so
an endpoint must allow CORS from the page's origin.

The Worker build moves every eagerly loaded module into a `core` chunk. WebKit evaluates a
module Worker's script a second time when a lazily loaded chunk imports from it, which
started a second Core Worker without a database.

## How the page talks to the Worker

`src/page/electron.ts` is the page's `electron`: `ipcRenderer.invoke` / `send` become the
`ipc-invoke` / `ipc-send` commands, and its listeners receive the Worker's
`webContents.send`. `src/page/electronToolkitPreload.ts` is `window.electron`. The
`resolve-process-aliases` plugin resolves `@logger`, `@data` and `electron` by the
importer's side: `src/renderer`, `src/preload` and `src/page` get the renderer targets,
everything else the main-process ones. Page files are typechecked with
`tsconfig.page.json` (the renderer's paths). `src/page/preload.ts` is listed in
`sideEffects`; without it the bundler drops the preload import and `window.api` stays
undefined.

## Database invariants

- Non-pooled `opfs` VFS. The pooled `opfs-sahpool` VFS corrupted databases when a reload
  killed the Worker mid-write; `opfs` rolls back. It requires a cross-origin-isolated page
  (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`).
- One Web Lock per account. `opfs` does not stop a second tab from opening the file, so the
  lock is the single-writer guard. `open` waits up to `handoverTimeoutMs` (3 s) for a
  reloaded page's previous Worker to release the lock and its file handles.
- Only the preference seeder runs (`PreferenceService` updates existing rows only); other
  defaults arrive from the enterprise backend.

## Tests

`pnpm test:web-core:browser` builds `harness/` and runs `e2e/` with Playwright in Chromium,
WebKit and Firefox (`pnpm exec playwright install chromium webkit firefox` once). The
harness Worker adds test-only commands (`sql`, `seedMessages`, `integrity`, `searchMessages`,
`chat`). `harness/bridge.html` loads the desktop preload and renderer services over the same
Worker for `e2e/bridge.spec.ts`. `e2e/mockProvider.ts` is the OpenAI-compatible endpoint the chat tests talk to.
`WEB_CORE_SCALE=1` adds the 50k-message timing run.
