# Web Core

The Web edition's Core Worker: it owns the user's SQLite database in the browser and runs
the unmodified main-process services, which answer the unmodified desktop preload and
renderer services in the page over emulated Electron IPC. The Web app in `app/` is the
unmodified desktop main window on top of it. See the Agent Notes for the
[database](../../.agents/notes/proposed/architecture/2026-10-20-web-core-database.md),
[chat](../../.agents/notes/proposed/architecture/2026-10-20-web-core-ai.md),
[page bridge](../../.agents/notes/proposed/architecture/2026-10-20-web-core-page-bridge.md),
[Web app](../../.agents/notes/proposed/architecture/2026-10-20-web-core-app.md),
[agent](../../.agents/notes/proposed/architecture/2026-10-21-web-core-agent.md),
[agent local folders](../../.agents/notes/proposed/architecture/2026-10-23-web-core-local-folder.md) and
[hardening](../../.agents/notes/proposed/architecture/2026-10-23-web-core-hardening.md).

- `./worker` — `startCoreWorker(self, extraCommands?, hooks?)` turns a dedicated Worker into a
  Core Worker. Commands: `open` (account), `request` (a DataApi `DataRequest`),
  `ipc-invoke` / `ipc-send` (the page's `ipcRenderer`), `close`. See *Editions* for `hooks`.
- `./client` — `CoreClient` on the page: `open()`, `request()`, and `onBroadcast()` for
  every `webContents.send` of the Worker (e.g. `DataApi_DataChanged`).
- `src/page/preload.ts` — imported before any renderer module, it runs the desktop preload
  in the page; `connectCore(client)` then routes its `ipcRenderer` to the Worker.

## What the Web edition can do

Everything runs in the browser tab; closing the tab stops replies and agent turns, and the app
opens in one tab at a time. Browsers: the current and previous major versions of Chrome, Edge,
Firefox and Safari.

| Feature | Web edition | Notes |
| --- | --- | --- |
| Chat: topics, messages, streaming, assistants | Yes | A reply cut off by a reload is kept and marked interrupted. |
| Model providers | Yes | Requests go from the browser, so the provider must allow CORS from the app's origin. |
| CherryIN sign-in, Cherry account, the built-in CherryAI model | No | First-run setup offers provider setup only; CherryIN works with an API key. |
| Saving and exporting messages | Markdown and image downloads | Notes, knowledge bases, Word and note apps are desktop-only. |
| Settings | Provider, default model, general, appearance, archive, about | Other sections are desktop-only. |
| Agents | Pi runtime | Claude Code and other runtimes, skills, slash commands, heartbeat and scheduled runs are desktop-only. |
| Agent file tools | Yes | `read`, `write`, `edit`, `ls`, `find`, `grep` in a workspace in the browser's storage. |
| Agent file tree and file preview | Yes | The preview is read-only. A local folder's tree does not see changes made outside the app. |
| Agent in a folder on the computer | Chrome and Edge | Needs `showDirectoryPicker()`. |
| Python | Yes | Pyodide, loaded from jsDelivr: pure-Python and Pyodide-built packages only. |
| JavaScript | Yes | QuickJS, without network, file or DOM access. |
| Shell commands | No | |
| MCP servers | No | |
| Archiving, restoring and deleting chat topics, assistants, agents and sessions | Yes | Archived items stay until deleted: the automatic cleanup is desktop-only. |
| Forking agent sessions; editing a sent agent message | No | |
| Attachments and file storage | No | |
| Web search, knowledge bases | No | |
| Paintings, translation, notes, mini apps and other sidebar apps | No | The sidebar and launchpad offer agents and chat only. |
| Dictation, read aloud, the agent's browser | No | |
| Help menu: release notes, guide, diagnostics, feedback | No | |
| Backup and restore | Not yet | Planned (M4). Clearing the site's data deletes everything. |
| Selection assistant, screenshots, global shortcuts, tray, auto-update | No | System features of the desktop app. |

A desktop-only feature reached anyway (an old link, a stored setting) fails with
`WebUnsupportedError` instead of acting.

## How the data layer runs here

The Worker build (`vite.config.ts`) aliases the few main-process modules the services
touch to browser implementations in `src/runtime/`: `@application` (only the services
registered by `startCoreWorker`; `getPath` returns `/web/<namespace>` paths), `@logger`, `diagnostics`, `platform`, `electron` (the
`ipcMain` registries, the page as the only window, `app.getLocale()` / `relaunch()`, `shell.openExternal` and
`net.fetch`), `node:crypto`, `node:os`, `node:path`, `node:util`,
`node:fs`, `node:fs/promises` and `node:url` (→ ZenFS, see below),
`node:buffer`, better-sqlite3 (→ `@cherrystudio/sqlite-wasm-compat`), drizzle's
file-reading migrator (→ migrations bundled at build time) and the provider registry
loader (→ the bundled catalog). `BootConfigService` keeps the defaults in memory,
`validateSender` accepts the page (a dedicated Worker only hears from it), and
`CacheService`'s persist file lives in memory. `process.platform` reads `'browser'` in every
source file outside `node_modules`.
Nothing under `src/main` is edited.
A build plugin fails on any other Node built-in or Electron import, so a served service
that grows a desktop-only dependency breaks `build:harness` instead of the browser.

The whole desktop DataApi table is served; a route backed by a left-out feature fails with
`WebUnsupportedError` when called. Of the IpcApi routes, `ai.stream.*`, the agent routes listed
under agents below and the ones the main window calls at start are served (`src/runtime/ipcHandlers.ts`); the others answer that the
Web edition lacks them. The page reports its `prefers-color-scheme` on `web:native-theme`,
which the Worker serves as Electron's `nativeTheme`.

## How chat runs here

`CacheService`, `DataApiService` and `IpcApiService` start with the Worker. `open` seeds the
default preference rows and starts `PreferenceService`, `AiStreamManager` (its `onInit` marks
replies a closed tab left pending as failed) and `AiService` (its desktop `onInit` is
skipped). Traces are dropped: the desktop trace window has no Web
counterpart. `close` stops live streams before closing the database.

`workerModuleReplacements` swaps the entry modules of desktop features the Web edition leaves
out (skills, built-in tools, agent forks, channels, attachments and file storage, model
listing, web search, Copilot / Grok CLI / Ollama, trace storage, devtools) for stand-ins in
`src/disabled/` that throw `WebUnsupportedError` when called. Swapping the entry module keeps
the feature's dependencies out of the bundle. Provider requests use the Worker's `fetch`, so
an endpoint must allow CORS from the page's origin.

The Worker build moves every eagerly loaded module into a `core` chunk
(`workerCodeSplitting(entries)`). WebKit evaluates a module Worker's script a second time when a
lazily loaded chunk imports from it, which started a second Core Worker without a database.
It also keeps function names when it minifies: ZenFS's `Async` mixin tells its own nested calls
apart by the `__patched__` name in stack traces, and with that name mangled a `rename` on `/web`
left the OPFS folder and ZenFS's in-memory copy out of step.

## How agents run here

`open` mounts the account's files with ZenFS: `/web` is the OPFS folder
`cherry-studio/<account>/files` beside the database, so agent workspaces and data folders
survive reloads. The Cherry Assistant templates are served in memory at
`feature.agents.builtin`. `WebCherryAssistantSeeder` replaces the desktop Cherry Assistant
and support seeders: it adds one Pi Cherry Assistant (no model yet) with a session.

The desktop `AgentSessionRuntimeService` hosts every session. `src/agent/registerDrivers.ts`
registers `BrowserAgentDriver` as the `pi` runtime; each turn runs the desktop AI SDK `Agent`
with the tools in `src/agent/fileTools.ts` (`read`, `write`, `edit`, `ls`, `find`, `grep` on
the workspace, plus `report_artifacts`) and `src/agent/codeTools.ts`:
`python_execute` is served by the desktop `PythonService`, which asks the page's Pyodide
(`app/main.ts` loads its listener at start; Pyodide comes from jsDelivr). The desktop Pyodide
worker runs in a sandboxed iframe (`src/page/pyodideWorker.ts`), whose opaque origin keeps
Python away from the app's OPFS, IndexedDB and storage. `js_execute`
runs in QuickJS (`quickjs-wasi`) in a Worker of its own, terminated when the run times out.
Tool calls go through the desktop Pi approval rules
(`createPiToolAuthorizer`), and the AI SDK chunks are fed to the desktop `PiStreamAdapter`,
so tool cards, approvals and stored messages match the desktop's. `sharedModuleReplacements`
swaps two `src/shared` modules in both the Worker and the page: the Pi tool catalog lists the
browser tools (`ls`, `find` and `grep` are read-class) and the runtime capabilities turn off
heartbeat, knowledge bases, MCP, skills and slash commands. Served agent IpcApi routes:
`ai.agent.create`, `ai.tool.respond_approval` and the session's `reuse_or_create`, `prewarm`,
`close_warm`, `set_pending_input_count`, `refresh_context_usage`, `edit_target`, `edit_resend` and
`fork` (editing a sent message and forking answer that the checkpoint is unsupported). A new agent
has no heartbeat to wait for, so `AgentJobsService` is a stand-in with `waitForHeartbeat` only.

### Archiving and deleting

The desktop `AgentLifecycleService` and `AgentWorkspaceStorageService` run in the Worker, so
archiving from the agent list and Settings → Archive work as on the desktop: `ai.agent.delete`,
`delete_permanently`, `restore` and `sessions.delete`, and the session's `delete`, `restore` and
`delete_permanently` are served, and `reuse_or_create` goes through the lifecycle service too.
Archiving a session packs its system workspace into `<workspace>.tar.gz` and restoring unpacks it;
in the Worker `tar` is `src/agent/tar.ts`, which builds and reads gzipped tarballs with
`modern-tar` and `CompressionStream`. Channels, scheduled tasks and agent-to-agent deliveries are
desktop-only, so `ChannelManager`, `JobManager` and `AgentSessionDeliveryService` are stand-ins
with nothing to pause, drain or resync.

Chat topics and assistants are archived by the desktop `TrashService` (`trash.topic.archive`,
`trash.topic.delete_permanently`, `trash.assistant_topics.archive`, `trash.assistant.archive` and
`trash.assistant.delete_permanently`); restoring them and deleting them from Settings → Archive go
through DataApi. "Empty archive" (`trash.purge_now`) runs the desktop `trash.purge` job's handler
once in the Worker (`src/runtime/archivePurge.ts`), since the Web edition has no job queue; its
file-storage sweep finds nothing, as the Web edition stores no files there. The archive's
auto-cleanup runs on the desktop job scheduler, which the Web edition does not have: archived items
stay until they are deleted.

### Local folders

The composer's "Add new work directory" lets an agent work in a folder on the user's computer
(Chrome and Edge only). The page answers the desktop folder dialog (`IpcChannel.File_SelectFolder`)
with `showDirectoryPicker()` in the same click (`src/page/localFolders.ts`, through `handleInPage`
in `src/page/electron.ts`) and sends the handle to the Worker (`local-folder.add`). The Worker
keeps handles per account in IndexedDB `cherry-studio-local-folders` and mounts each at
`/local/<id>/<folder name>` while the account is open (`src/agent/localFolders.ts`);
`ai.agent.workspace.register` is served for those paths only.

The mount is `LocalFolderFS` (`src/agent/localFolderFs.ts`): every call runs on the directory
handle, with no preload or cache, so files changed elsewhere are current; it has async calls only.
A folder whose permission the browser dropped is mounted as `UnavailableFolderFS`: every call fails
with `EACCES`, and the first one broadcasts `PageChannel.LocalFolderAccess`, whose toast asks the
user to allow access (`requestPermission` needs the click) and then sends `local-folder.allow`.
A browser without the picker shows a toast that local folders need Chrome or Edge.

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
`src/renderer/windows/main/entryPoint.tsx`. If the account does not open, for example while
another tab holds it, `src/page/startError.ts` replaces the spinner with the reason and a
reload button. `pageModuleReplacements` swaps renderer modules
in the page: Sentry is off, the settings menu keeps the provider, default model,
general, appearance, archive and about sections, creating an agent shows Pi as its runtime
instead of a choice, and the Pyodide worker starts in a sandboxed iframe. The launchpad, the
composer's tools, the message menu, the user menu and first-run setup keep only the entries the
Web edition serves, and the help menu and dictation are left out. `src/page/tailwind.css` points
Tailwind at the renderer, since the Vite root here is `app/`. Saving a message or an image
becomes a browser download (`src/page/fileDownloads.ts`). The one renderer edit is first-run
setup's `enableCherryInLogin` switch, off here.

## Editions

Another edition builds its own Web app on this package, with its own Worker entry and page.

- `WEB_CORE_SOURCE_ROOT` makes `vite.config.ts` resolve `src/main`, `src/renderer` and `src/shared`
  under another tree, such as an edition's prepared source view, before the edition imports it.
- `startCoreWorker`'s `hooks`: `createIpcApiService` / `createDataApiService` build the edition's
  services in place of the desktop ones, `afterOpen(opened, account)` starts the edition's services
  once the account's have started (a throw closes the account again) and `beforeClose` stops them.
  It returns the `open` and `close` commands so the edition can reopen another account in place.
- `application` starts ready with the Worker's window and IPC services, before any account opens,
  so an edition can serve a sign-in page without a database. `WebServices` can be augmented, and
  `getContainer()` is the desktop container's lookup.
- The Worker reaches the page on `PageChannel`: `web:relaunch` (`app.relaunch()`) reloads it,
  `web:open-external` (`shell.openExternal`) opens a tab, and `web:load-url` (`window.loadURL`)
  hands the page the entry to show; the page decides whether that means a reload.
- `resolveProcessAliases(extraPageSources)` treats an edition's page files as page code.
  `mountOpfsDirectory` mounts any OPFS folder in ZenFS, and `deleteAccountData(account)` removes an
  account's database and files once no Worker holds it.

## Serving

Every response needs these headers; `webCoreHeaders()` in `vite.config.ts` defines them, the
dev server and `vite preview` send them, and `build:app` writes them to `dist/app/_headers`
(read by Cloudflare Pages and Netlify; copy them for other hosts, e.g. nginx `add_header … always`).

- `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`: the
  database needs a cross-origin-isolated page.
- `Content-Security-Policy` (`contentSecurityPolicy()`): scripts only from the app, Pyodide's CDN and,
  by hash, the Pyodide frame's inline script; WebAssembly but no `eval`; no plugins, no framing by
  other sites; no `base-uri`, since HTML previews set their own base. `connect-src` allows any HTTPS host and local servers (`localhost`, `127.0.0.1`),
  since users add their own providers; an edition passes its own `connectSrc`. zod's compiled
  parsers need `eval`, so they are turned off by `src/runtime/zodJitless.ts`, which every page and
  Worker entry imports before any module that uses zod (`src/page/preload.ts` and `startCoreWorker`
  import it; an entry that imports desktop modules before them imports it first).

Before starting the Worker, `src/page/browserSupport.ts` checks for WebAssembly, Workers, OPFS and
cross-origin isolation, and the Worker checks for synchronous OPFS access handles. The start
screen then names the cause: an unsupported browser, a site served without the isolation headers,
or a browser that refuses storage (some private windows). Once the app is open,
`src/page/persistentStorage.ts` asks for persistent storage and, if the browser refuses, warns
once per account that the browser may delete the data.

## Database invariants

- Non-pooled `opfs` VFS. The pooled `opfs-sahpool` VFS corrupted databases when a reload
  killed the Worker mid-write; `opfs` rolls back. It requires a cross-origin-isolated page
  (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`).
- One Web Lock per account. `opfs` does not stop a second tab from opening the file, so the
  lock is the single-writer guard. `open` waits up to `handoverTimeoutMs` (3 s) for a
  reloaded page's previous Worker to release the lock and its file handles.
- The desktop seeders run on every `open`, as in the desktop `DbService.onInit`.
  `WebPreferenceDefaultsSeeder` runs first and writes the preferences whose Web default
  differs (the sidebar offers only agents and chat); the desktop seeders skip existing rows.
  Desktop-only features with no Web settings page (the agent browser, links opening in it,
  exports to Word and note apps) are turned off on every `open` (`fixedWebPreferences`), also in
  workspaces created before they were.

## Tests

`pnpm test:web-core:browser` builds `harness/` and the Web app and runs `e2e/` with Playwright in Chromium,
WebKit and Firefox (`pnpm exec playwright install chromium webkit firefox` once). The
harness Worker adds test-only commands (`sql`, `seedMessages`, `integrity`, `searchMessages`,
`chat`, and `fsCall` and `revokeFolderPermission` for `e2e/localFolder.spec.ts`, where an OPFS
directory stands in for a picked folder). `harness/bridge.html` loads the desktop preload and renderer services over the same
Worker for `e2e/bridge.spec.ts`. `e2e/app.spec.ts` and `e2e/agent.spec.ts` drive the Web app (port 4320). `e2e/mockProvider.ts` is the
OpenAI-compatible endpoint the chat and agent tests talk to; `call <tool> <json>` makes it call tools.
`WEB_CORE_SCALE=1` adds the 50k-message timing run.
Both preview servers send the CSP with a `report-uri` to the mock provider (`WEB_CORE_CSP_REPORT_URI`),
and every test fails on a violation report from the page, its frames or its Workers.
