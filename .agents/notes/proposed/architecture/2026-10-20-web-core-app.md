# Agent Note: Web Core app

Status: proposed

English | [中文](2026-10-20-web-core-app.zh.md)

## Problem

The Web edition (issue #21728) is an install-free trial: login, chat, the agent and a small settings page. The Core Worker now runs the desktop main-process services, and the unmodified desktop preload and renderer services reach them from the page ([page bridge Spec](2026-10-20-web-core-page-bridge.md)). The page still has no UI. A Web-only UI would rebuild the composer, the message list, the assistant list and the settings pages, and drift from the desktop with every change. The desktop main window also expects more than the bridge serves: the whole DataApi table, the rows the desktop seeds on start, and the IpcApi routes it calls while starting.

## Proposal

The Web page is the unmodified desktop main window (`src/renderer/windows/main/entryPoint.tsx`), built for the browser. All changes stay in `packages/web-core`, except the validation plan in `scripts/validation`; no file under `src/main`, `src/preload` or `src/renderer` is edited.

1. **One build config with the desktop renderer.** `vite.app.config.ts` loads `electron.vite.config.ts` and reuses its renderer defines, plugins and aliases. `@logger` and `@data` still resolve by the importer's side. The Worker build is shared with the harness.
2. **The page entry** (`app/main.ts`) runs the preload, starts the Core Worker, reports the page's `prefers-color-scheme` as the native theme, opens the account and then imports the desktop entry point. Until login exists, every visitor of a browser uses one `local` account.
3. **The Worker serves the whole desktop DataApi table.** A route backed by a feature the Web edition leaves out fails with `WebUnsupportedError` when called. The v1 → v2 migration module, which a seeder imports, is replaced: a Web database never held v1 data.
4. **Desktop seeders run on every open**, as in the desktop `DbService.onInit`. A Web seeder runs first and writes the preferences whose Web default differs: the sidebar offers only chat. The desktop seeders skip existing rows, so later user changes stay.
5. **IpcApi routes for the main window's start.** Besides `ai.stream.*`, the Worker serves:
   - `app.get_info`: the app version and `/web/<namespace>` paths;
   - `system.get_native_theme` and `system.native_theme_updated`, fed by the page;
   - `window.get_init_data`, which returns `null`, as for a main window;
   - `backup.get_auto_sync_state`, which returns no pending notifications;
   - no-ops for the window size, protocol dispatch and screenshot routes.

   `application.getPath` returns absolute POSIX paths under `/web/`, because services validate the stored paths.
6. **Renderer modules replaced in the page.** Sentry is off. The settings menu keeps the provider, default model, general, appearance and about sections.
7. **Validation.** A change under `packages/web-core`, `src/main` or `src/renderer` also builds the Web app, so a desktop change that breaks the browser build fails in CI.
8. **Tests.** `e2e/app.spec.ts` drives the built app in Chromium, WebKit and Firefox.

Out of scope: login and per-user accounts, the agent, the model source for trial users (gateway and CherryAI defaults), attachments, onboarding changes, and hosting (COOP/COEP headers, CDN).

## Alternatives considered

- **A Web-only UI shell.** It would copy the chat and settings UI and drift from it. Reusing the main window costs only route stand-ins and two renderer module replacements.
- **A `web` app edition in `src/shared` and the renderer.** Gating the sidebar, settings and other entry points by edition in the desktop code would hide every left-out feature, not just those in the sidebar and settings. It edits renderer code owned by other teams, so it is left for the maintainers to decide. The replacements here can be dropped once it exists.
- **Copying the renderer aliases into the Web config.** Every alias the desktop adds would need a second edit. Loading the desktop config keeps one list.
- **Reading the native theme in the page.** That would replace the renderer's theme hook. Answering the existing IpcApi routes from the Worker keeps the renderer unchanged.

## Acceptance criteria

- AC1 — In Chromium, WebKit and Firefox, the Web app starts without page errors. The sidebar shows only chat, and settings shows exactly the provider, default model, general, appearance and about sections. (verification: packaged artifact)
- AC2 — A message sent through the desktop composer streams a reply from an OpenAI-compatible endpoint. Both messages persist as `success` and still show after a reload. (verification: packaged artifact)
- AC3 — The existing Web Core tests still pass in the three browsers. The Worker build has no Node built-in, Electron or native import. No file under `src/main`, `src/preload` or `src/renderer` is modified. (verification: packaged artifact and change-scope report)
- AC4 — The validation plan builds the Web app for changes under `packages/web-core`, `src/main` and `src/renderer`. (verification: unit test)
- AC5 — The gzipped size of what a first visit downloads is recorded. (verification: packaged artifact, recorded in the implemented note)

## Risks

- **Left-out features behind other entry points.** Only the sidebar and settings are filtered. Launchpad, global search, message actions such as Save to Notes, and other menus can still open features that fail with `WebUnsupportedError` or call Electron APIs. Each needs a stand-in or the edition gating above.
- **Desktop seed data assumes the CherryAI gateway.** The seeders make `cherryai::qwen` the default model, so chat and topic naming fail ("CherryAI client secret is not configured") until the trial's model source exists. Model listing is a stand-in, so "Sync models" fails as well.
- **Onboarding shows on first visit.** Its CherryIN path is not tested in the browser.
- **One account per browser.** Everyone using the same browser profile shares the `local` account until login exists.
- **The build depends on the desktop config.** It must run from the repo root, and a renderer plugin that needs Electron or Node at build time breaks the Web build.
- **Platform from the user agent.** On macOS the page reserves space for the window buttons, as the desktop does.
- **Download size.** A first visit fetches about 2.3 MB of gzipped JavaScript in about 480 requests, before any caching.
- **CI time.** Renderer and main-process changes now also build the Web app.
