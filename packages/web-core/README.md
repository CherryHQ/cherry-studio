# Web Core

The Web edition's Core Worker: it owns the user's SQLite database in the browser and runs
the unmodified main-process services, which answer the unmodified desktop preload and
renderer services in the page over emulated Electron IPC. The Web app in `app/` is the
unmodified desktop main window on top of it. See the Agent Notes for the
[database](../../.agents/notes/proposed/architecture/2026-10-20-web-core-database.md),
[chat](../../.agents/notes/proposed/architecture/2026-10-20-web-core-ai.md),
[page bridge](../../.agents/notes/proposed/architecture/2026-10-20-web-core-page-bridge.md) and
[Web app](../../.agents/notes/proposed/architecture/2026-10-20-web-core-app.md).

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
registered by `startCoreWorker`; `getPath` returns `/web/<namespace>` paths nothing opens), `@logger`, `diagnostics`, `platform`, `electron` (the
`ipcMain` registries, the page as the only window and `app.getLocale()`), `node:crypto`, `node:os`, `node:path`, `node:util`,
`node:buffer`, better-sqlite3 (→ `@cherrystudio/sqlite-wasm-compat`), drizzle's
file-reading migrator (→ migrations bundled at build time) and the provider registry
loader (→ the bundled catalog). `BootConfigService` keeps the defaults in memory,
`validateSender` accepts the page (a dedicated Worker only hears from it), and
`CacheService`'s persist file lives in memory. Nothing under `src/main` is edited.
A build plugin fails on any other Node built-in or Electron import, so a served service
that grows a desktop-only dependency breaks `build:harness` instead of the browser.

The whole desktop DataApi table is served; a route backed by a left-out feature fails with
`WebUnsupportedError` when called. Of the IpcApi routes, `ai.stream.*` and the ones the main
window calls at start are served (`src/runtime/ipcHandlers.ts`); the others answer that the
Web edition lacks them. The page reports its `prefers-color-scheme` on `web:native-theme`,
which the Worker serves as Electron's `nativeTheme`.

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

## The Web app

`vite.app.config.ts` builds `app/` with the desktop renderer's own Vite config (its defines,
plugins and aliases), so it must run from the repo root: `pnpm --filter @cherrystudio/web-core
build:app` writes `dist/app`. `app/main.ts` runs the preload, starts `app/coreWorker.ts`,
opens the `local` account (every visitor shares it until login exists) and then imports
`src/renderer/windows/main/entryPoint.tsx`. `pageModuleReplacements` swaps renderer modules
in the page: Sentry is off, and the settings menu keeps the provider, default model,
general, appearance and about sections. Nothing under `src/renderer` is edited.

## Database invariants

- Non-pooled `opfs` VFS. The pooled `opfs-sahpool` VFS corrupted databases when a reload
  killed the Worker mid-write; `opfs` rolls back. It requires a cross-origin-isolated page
  (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`).
- One Web Lock per account. `opfs` does not stop a second tab from opening the file, so the
  lock is the single-writer guard. `open` waits up to `handoverTimeoutMs` (3 s) for a
  reloaded page's previous Worker to release the lock and its file handles.
- The desktop seeders run on every `open`, as in the desktop `DbService.onInit`.
  `WebPreferenceDefaultsSeeder` runs first and writes the preferences whose Web default
  differs (the sidebar offers only chat); the desktop seeders skip existing rows.

## Tests

`pnpm test:web-core:browser` builds `harness/` and the Web app and runs `e2e/` with Playwright in Chromium,
WebKit and Firefox (`pnpm exec playwright install chromium webkit firefox` once). The
harness Worker adds test-only commands (`sql`, `seedMessages`, `integrity`, `searchMessages`,
`chat`). `harness/bridge.html` loads the desktop preload and renderer services over the same
Worker for `e2e/bridge.spec.ts`. `e2e/app.spec.ts` drives the Web app (port 4320). `e2e/mockProvider.ts` is the OpenAI-compatible endpoint the chat tests talk to.
`WEB_CORE_SCALE=1` adds the 50k-message timing run.
