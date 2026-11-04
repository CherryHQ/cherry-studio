# Agent Note: Web Core Worker chat layer

Status: proposed

English | [中文](2026-10-20-web-core-ai.zh.md)

## Problem

The Web edition (issue #21728) is an install-free trial with login, chat, agent and simple settings. The [database Spec](2026-10-20-web-core-database.md) runs the data services in a browser Core Worker. Chat also needs the main-process AI layer there: `AiStreamManager` (stream registry, persistence of the reply) and `AiService` (provider clients through aiCore and the AI SDK). Both sit on top of desktop-only features. Bundled for the browser as they are, `AiStreamManager` and `AiService` reach 96 `src/main` files and 55 packages that import Node built-ins, Electron or native modules (skills, built-in tools, agent sessions, channels, file processing, Copilot, tracing to disk, `sharp`, …). Most of these come from a handful of feature entry modules, not from the chat path itself.

## Proposal

Run a chat turn in the Core Worker with the unmodified `AiStreamManager` and `AiService`, and keep everything outside the trial's chat out of the bundle. All changes stay in `packages/web-core`; no file under `src/main` is edited.

1. **Replace feature entry modules at build time.** A `replace-desktop-modules` build plugin swaps a module by its path under `src/main` for a stand-in in `packages/web-core/src/disabled/`. A stand-in exports the same names and throws `WebUnsupportedError` when called; swapping the entry module drops everything behind it from the bundle. Replaced: skills (`SkillService`, `builtinSkills`), built-in tools, agent-session dispatch and workspaces, channel listeners, attachment text extraction and file processing, the `@main/utils/file` barrel (only tool-output file storage reaches it), model listing, web search, Copilot / Grok CLI / Ollama provider helpers, trace storage and the Node trace runtime, AI SDK devtools, image download and edit-input normalization, and `LifecycleManager`.
2. **Browser versions of the runtime seams the chat path does use**, by alias or replacement: `customFetch` (the Worker's `fetch`; it still records the final request body for HTTP traces), `appEdition` (`global`), the provider registry loader and `registryDataPaths` (the bundled catalog instead of JSON files on disk), `electron` (only `ipcMain` and `app.getLocale()`), `node:os`, `node:path` (`pathe`), `node:crypto` (`createHash` / `createHmac` via `@noble/hashes`), a `Buffer` global from the `buffer` package, and `sharp` (image measurement throws; token counting already falls back). The database Spec listed `registryDataPaths` and `appEdition` as never replaced; chat reaches them through `ProviderService` and `ProviderRegistryService`, so this Spec replaces them.
3. **Services registered in the Worker** when an account opens: `AiStreamManager` with its `onInit` (it marks replies left `pending` by a closed tab as failed), `AiService` without its desktop `onInit` (built-in tools, skills, the Electron User-Agent hook and the image job handler), `WebPreferenceService` (stored preferences over the defaults, read-only for now), `WebCacheService` (memory and shared tiers, not relayed to the page yet) and a trace store that drops traces. `close` stops live streams before closing the database. The provider, model and assistant DataApi routes are served next to topics and messages.
4. **One Worker entry chunk that nothing imports.** The Worker build moves every eagerly loaded module into a `core` chunk. WebKit evaluates a module Worker's script a second time when a lazily loaded chunk imports from it, which started a second Core Worker without a database on the second chat turn.
5. **Tests against a local OpenAI-compatible endpoint** (`e2e/mockProvider.ts`, with CORS) in Chromium, WebKit and Firefox.

Out of scope: the page-side streaming protocol and chat UI, login, the agent (its tools, sessions and file storage), settings writes, attachments, MCP and topic naming checks.

## Alternatives considered

- **Edit desktop call sites** (lazy imports, splitting modules) so the bundler drops desktop features. The maintainers allowed small call-site changes, but the module replacement needs none, and keeps already-verified desktop logic untouched.
- **Polyfill Node built-ins** (`vite-plugin-node-polyfills`, empty shims). Bundles desktop features that cannot work in a browser, grows the download and moves failures from build time to run time.
- **Run `AiService.onInit` with stubs.** Built-in tools and skills need a file system and a shell; stubbing them all is more code than skipping the hook.
- **Run the AI layer on a server.** Needs per-user server processes, which the design review rejected on cost.
- **Disable code splitting in the Worker** to avoid the WebKit double evaluation. Puts the 2 MB `o200k_base` tokenizer table into the first download.

## Acceptance criteria

- AC1 — The Worker build bundles `AiStreamManager` and `AiService` with no Node built-in, Electron or native import, and no file under `src/main` or `src/renderer` is modified. (verification: packaged artifact and change-scope report)
- AC2 — In Chromium, WebKit and Firefox, a chat turn on a persistent topic streams text deltas from an OpenAI-compatible endpoint, persists the user message and the reply as `success`, sends the stored API key and the earlier turns, and the conversation survives a page reload. (verification: packaged artifact)
- AC3 — A provider error ends the turn with an error result and persists the reply as `error`, never `pending`. (verification: packaged artifact)
- AC4 — A reply still streaming when its tab closes is persisted as `error` the next time the account opens. (verification: packaged artifact)
- AC5 — The gzipped size of the Worker's first download and of each lazily loaded chunk a chat turn fetches is recorded. (verification: packaged artifact, recorded in the implemented note)

## Risks

- **Page weight.** The Worker's first download grows from about 600 KB to about 1 MB gzipped (Worker JavaScript 603 KB, `sqlite3.wasm` 402 KB). The first chat turn then fetches about 104 KB of provider code; the `o200k_base` tokenizer table (1 MB gzipped) is not loaded. The bundled provider catalog alone is about 1.6 MB before compression; serving it from the backend would shrink the first download.
- **CORS and keys in the browser.** Provider requests leave the user's browser, so every endpoint must allow the page's origin, and the API key is visible to the page. For the trial the model gateway of the enterprise backend is the expected endpoint; direct third-party providers work only where they allow browser calls.
- **Path-keyed replacements.** A replacement matches a file path. If a replaced desktop module moves, the real module returns to the bundle: the build fails when it imports a Node built-in or Electron, but a browser-safe module would ship silently. A stand-in missing a name that desktop code imports fails the build.
- **Skipped `AiService.onInit`.** Startup work added there later does not run in the Worker until it is added to the Worker start-up.
- **Read-only preferences, unrelayed shared cache.** Settings changes need a writing `WebPreferenceService`, and stream-status indicators that read the shared cache need a relay to the page; both belong to the UI and settings Specs.
- **Tool-output file storage is disabled.** A tool result large enough to be stored as a file throws. Plain chat has no tools; the agent Spec must decide where those outputs go.
- **Worker entry name in the build config.** The `core` chunk group excludes the harness entry by path; each new Worker entry must be excluded the same way, or the WebKit double evaluation returns.
