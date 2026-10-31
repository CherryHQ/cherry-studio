# Agent Note: Web Core page bridge

Status: proposed

English | [中文](2026-10-20-web-core-page-bridge.zh.md)

## Problem

The Web edition (issue #21728) runs the desktop main-process services in a browser Core Worker ([database Spec](2026-10-20-web-core-database.md), [chat-layer Spec](2026-10-20-web-core-ai.md)). The desktop UI reaches those services only through Electron IPC: the preload defines `window.api` and `window.electron`, and the renderer's `DataApiService`, `PreferenceService`, `CacheService`, `ipcApi` facade and chat transport sit on top of them. The page has no Electron, so none of this code runs there. The Worker also runs Web-only services so far: a read-only `WebPreferenceService`, a `WebCacheService` that never reaches the page, and a `request` command instead of the DataApi IPC channel. A Web-only `window.api` would copy the 270-line preload and drift from it with every desktop change.

## Proposal

Emulate the part of Electron IPC the desktop uses over the Worker's `postMessage`, so the unmodified preload and renderer services run in the page and the unmodified main-process services answer them in the Worker. All changes stay in `packages/web-core`; no file under `src/main`, `src/preload` or `src/renderer` is edited.

1. **Worker `electron` stand-in.** `ipcMain` keeps `handle` and `on` registries (a second handler for a channel throws, as in Electron). The page is the only window: one `webContents` whose `send` posts a broadcast message to the page, plus the `BrowserWindow` lookups the services use. The new `ipc-invoke` and `ipc-send` Worker commands run the registered handlers.
2. **Page `electron` stand-in.** `ipcRenderer.invoke` and `send` become those commands, and `on` / `once` / `off` listeners receive the Worker's `webContents.send`. Calls made before the page connects to its Worker wait for it. A rejected `invoke` keeps Electron's wording. `contextBridge`, `shell.openExternal` (opens a tab) and `webUtils.getPathForFile` (`''`, as Electron returns for files not on disk) complete what the preload imports.
3. **The unmodified desktop preload runs in the page** (`src/page/preload.ts`). `@electron-toolkit/preload` is replaced by a page `window.electron` (its `ipcRenderer` and a `process` whose platform comes from the user agent). `process.contextIsolated` is defined as `false`, so the preload assigns `window.api` directly.
4. **The Worker runs the desktop services instead of the Web-only ones.** `CacheService`, `DataApiService` and `IpcApiService` start with the Worker. `PreferenceService` starts when an account opens, after the default preference rows are seeded as the desktop does on first start. These modules are replaced:
   - `BootConfigService`: defaults in memory.
   - `validateSender`: a dedicated Worker only receives messages from its own page.
   - The DataApi handler table: topics, messages, providers, models and assistants.
   - The IpcApi handler table: the `ai.stream.*` routes. Every other route answers that it is not available in the Web edition.
   - The agent entry modules the `ai.*` handlers import.
   - `CacheService`'s persist file: kept in memory.
   - `WindowManager`: the one page window.

   The Worker also accepts and drops `App_LogToMain`, because the page has already logged to its console. It gives timers a Node-style handle, because `BaseService.registerInterval` calls `unref()`.
5. **Importer-scoped aliases.** `@logger`, `@data` and `electron` mean different modules in the desktop main process and renderer. One build holds both sides, so a resolver plugin picks the target by the importer's location: `src/renderer`, `src/preload` and `packages/web-core/src/page` get the renderer targets, everything else the main-process ones. `@renderer` and `@cherrystudio/ui` resolve to source, as in the renderer's tsconfig. Page files are typechecked against the renderer tsconfig.
6. **A bridge harness page** (`harness/bridge.html`) loads the preload and the renderer services. `e2e/bridge.spec.ts` drives it in Chromium, WebKit and Firefox.

Out of scope: chat UI components (the execution overlay and React hooks), routing, login, the agent, attachments, and the IpcApi routes beyond `ai.stream.*`.

## Alternatives considered

- **A Web-only `window.api` over the Core Worker client.** It copies the preload, and every new desktop API needs a second implementation. Emulating IPC keeps one preload.
- **Per-service RPC (e.g. Comlink).** Exposes a paradigm the desktop renderer does not use, so renderer services would need Web variants.
- **Make `BaseService.registerInterval` call `handle.unref?.()`.** This one-line desktop change would make the Node-style timer handles unnecessary. It is left for the maintainers to choose; the Worker shim needs no desktop edit.
- **Separate alias sets per build.** In development Vite also runs the page plugins for Workers, so both sides would share one resolution. Scoping by importer gives the same result in development and production.

## Acceptance criteria

- AC1 — The unmodified desktop preload runs in the page. Its `ipcRenderer.invoke` reaches the Worker's `ipcMain` handlers: DataApi requests and IpcApi routes answer. An unregistered channel rejects with Electron's "No handler registered" wording. (verification: packaged artifact)
- AC2 — The renderer data services work unchanged. A DataApi write notifies the page. A preference set reaches the page's subscribed listener and survives a page reload. The shared cache syncs both ways: page to Worker, and the Worker's stream status to the page. (verification: packaged artifact)
- AC3 — In Chromium, WebKit and Firefox, the renderer chat transport opens a turn through `ai.stream.open`. The page receives the reply's text deltas through the renderer `ipcApi`, the topic stream closes when the turn is done, and both messages persist as `success`. (verification: packaged artifact)
- AC4 — The existing database and chat tests still pass in the three browsers. The Worker build has no Node built-in, Electron or native import. No file under `src/main`, `src/preload` or `src/renderer` is modified. (verification: packaged artifact and change-scope report)
- AC5 — The gzipped size of the bridge page's JavaScript is recorded. (verification: packaged artifact, recorded in the implemented note)

## Risks

- **Directory-keyed page sources.** A page entry outside the listed directories resolves `@logger`, `@data` and `electron` to the main-process modules. The build then fails on Electron or Node imports, but a module that loads in a browser would ship silently.
- **Node-style timer handles in the Worker.** `setInterval` returns a `Number` object with `unref()` there. Code that compares timer ids with `===` would break; none is bundled today.
- **Unavailable IpcApi routes and Electron APIs.** Renderer features that call other routes, `ipcRenderer.sendSync` or other Electron APIs fail in the page. The UI Spec must hide those features.
- **The preload must stay in the `sideEffects` list.** `packages/web-core` is otherwise side-effect free, and the bundler silently drops an unlisted side-effect import, which leaves `window.api` undefined.
- **Page weight.** The renderer chat path imports the toast, so `@cherrystudio/ui` and i18n enter the page bundle.
- **The shared cache is lost on reload.** The Worker restarts with the page, as the desktop main process does when the app restarts.
