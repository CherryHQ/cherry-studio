# Agent Note: Web Core Worker database layer

Status: proposed

English | [中文](2026-10-20-web-core-database.zh.md)

## Problem

Issue #21728 asks for a Web edition. Its purpose is an install-free trial: people try Cherry Studio in the browser instead of downloading and starting the desktop app. Its scope is login, chat, agent and simple settings; every other module stays desktop-only. The design review chose to run all computation in the user's browser: UI on the main thread, and a Core Worker hosting the data-layer services and aiCore. The issue's independent backend is the existing enterprise backend's shared services (login, the `/v1` model gateway, `configurations`, backup); it runs no per-user process, because the review rejected per-user server containers on cost. That design assumes the v2 data layer (better-sqlite3 + Drizzle, 28 migrations, FTS5 with triggers, a custom SQL function) can run in the browser unchanged. If it cannot, most upper-layer work must be redone.

A throwaway spike on 2026-10-19/20 showed it can, and found one data-safety hazard: with the default `opfs-sahpool` VFS, killing the Worker mid-write (page reload) corrupted the database (60k-row transaction: Chrome 4/4, Safari engine from 400 ms; small-transaction loops: Chrome ~10%, Safari 2–5%). The non-pooled `opfs` VFS rolled back cleanly in every sampled run (10/10 large-transaction kills across both browsers; 0/32 Chrome and 0/48 Safari-engine small-transaction samples), but it requires cross-origin isolation (`COOP: same-origin`, `COEP: require-corp`) and writes are slower (10k messages: Chrome 3.6 s → 4.8 s, WebKit 1.2 s → 4.4 s). The spike code was discarded; this note turns its findings into product code.

## Proposal

Deliver only the database layer of milestone M0; login, chat, agent and settings stay in later Specs. The other M0 checks — slimming `AiStreamManager` for the Worker, Safari corruption detection with backup restore, and the impact of cross-origin isolation on third-party resources — are not covered here.

1. **`packages/sqlite-wasm-compat`** — a better-sqlite3-compatible facade over `@sqlite.org/sqlite-wasm`. Drizzle's better-sqlite3 driver only needs `prepare().run/get/all/raw` and `transaction().deferred/immediate/exclusive`, so `src/main/data` stays untouched. The facade must:
   - set `PRAGMA foreign_keys = ON` on open (sqlite-wasm defaults to OFF);
   - rethrow errors with a SQLite `code` such as `SQLITE_CONSTRAINT_UNIQUE`;
   - reject promise-returning transaction callbacks as better-sqlite3 does;
   - support `function()` for `knowledge_item_name` and nested transactions via savepoints;
   - support `pragma()` with `{ simple: true }`, which the test harness and integrity checks call;
   - accept an injected storage backend: in-memory (Node tests) or OPFS (browser).
2. **`packages/web-core`** — the Core Worker host for the database:
   - open the DB with the non-pooled `opfs` VFS, retrying for up to ~3 s because a previous Worker's handles release late;
   - take one Web Lock per account so a second tab is refused (the non-pooled VFS no longer refuses it);
   - run `applyMigrations` from the existing migration chain and keep every Worker task under 1 s by chunking and yielding; `drizzle-orm/better-sqlite3/migrator` is aliased to a reader of the migration files bundled at build time, because the stock one reads the folder with `node:fs`;
   - resolve `@application` and `@logger` to browser implementations by bundler alias, so `src/main` is not edited;
   - provide a browser `DbService` with the same `getDb()` and `withWriteTx()` that opens the database itself, without the desktop WAL and `busy_timeout` settings;
   - replace the same way only the Electron- or Node-bound modules that in-scope services reach. M0 replaces those reached by `TopicService`, `MessageService` and `ApiServer`: `src/main/core/diagnostics`, `src/main/core/platform.ts` (it reads `process` at module load), and the `node:crypto` and `node:util` imports. The login, agent and settings Specs add the replacements their services need; modules that serve only out-of-scope features (for example `registryDataPaths`, `appEdition`, `retiredAgentRuntimeMigration`) are never replaced.
3. **Real services in the Worker**: `TopicService` and `MessageService` run in the Worker through the DataApi `ApiServer`, called from a test page over `postMessage`.
4. **Measurements** at 50k messages, far more than a trial account holds (cold migrate, warm boot, queries), in Chromium and WebKit. The 500k figures gathered while building this are kept under Risks for reference.

Placement: both packages live under `packages/`, so the closed top-level sets of `src/` and the Electron build are unaffected. A Web build entry and `apps/` layout are deferred to the milestone that needs them.

## Alternatives considered

- **Keep `opfs-sahpool`, rely on backups.** Loses data on ordinary page reloads in Safari; backup would be the primary mechanism instead of a last resort. Kept only as the fallback if the product refuses cross-origin isolation.
- **Run services behind a server-side SQLite.** Needs per-user server state, which the review rejected on cost.
- **Fork the services for the browser.** Duplicates business logic; the spike showed the Drizzle driver seam makes this unnecessary.
- **Place the code in `src/web`.** A fourth process root needs a change to the closed-set naming rules first; no benefit for the database layer.
- **Port every desktop module.** Login, chat, agent and simple settings are enough to show the product; each further module adds download weight and more Electron-only code to replace.
- **Wait for Firefox before starting.** Firefox is checked in this Spec's last AC rather than blocking the shim.

## Acceptance criteria

- AC1 — With the wasm driver substituted for better-sqlite3, the whole main-process suite passes except suites excluded, by enumerated out-of-scope category (real database files and backup/restore, the backup API, legacy v1 migration, sqlite-vec vector store, live network probes), in the compatibility run's config. (verification: unit)
- AC2 — The driver sets foreign keys ON, preserves SQLite error codes, rejects promise-returning transaction callbacks and supports nested transactions; a cascade delete removes dependent rows. (verification: unit)
- AC3 — In Chromium and WebKit, a Core Worker opens an OPFS database with the non-pooled VFS, applies all production migrations including the FTS5 table and its triggers, and the data and `PRAGMA integrity_check` survive a page reload. (verification: packaged artifact, Playwright in both engines)
- AC4 — Killing the Worker at 10 different moments of a 60k-row transaction leaves a database that passes `integrity_check` with the transaction fully rolled back, in both engines. (verification: packaged artifact)
- AC5 — A second tab for the same account is refused by the Web Lock and cannot write to the database. (verification: packaged artifact)
- AC6 — `TopicService` and `MessageService` run unmodified in the Worker: creating a topic, appending messages and listing them return correct results through the DataApi server, and `MessageService.search` finds a message by full-text search. (verification: packaged artifact)
- AC7 — No file under `src/main` or `src/renderer` is modified, and the Electron data-layer tests still pass. (verification: unit and change-scope report)
- AC8 — Cold migrate, warm boot and query timings at 50k messages are recorded for both engines, and no Worker task during migration or startup checks exceeds 1 s. (verification: packaged artifact, recorded in the implemented note)
- AC9 — The same suite is run once in Firefox and its result is recorded; failures do not block AC1–AC8 but must be listed as risks. (verification: packaged artifact)

## Risks

- **Agent in the browser.** The desktop agent reads and writes local files and runs commands; a browser can do neither. Without a server-side sandbox, which the review rejected on cost, the Web agent is limited to network tools such as web search and remote MCP servers. The owners must confirm this is the agent they expect.
- **Small `opfs` crash samples.** 0/32 and 0/48 do not prove safety; corruption must still be detected, and a later Spec decides whether recovery resets the trial database or restores a backup.
- **Cross-origin isolation.** COOP/COEP can break third-party iframes and un-CORP'd subresources; the owners must accept this before the Web build ships. Login must use a full-page redirect, because `COOP: same-origin` cuts a popup's link to the page that opened it.
- **Page weight.** A trial depends on a fast first visit. The database layer alone downloads about 600 KB gzipped (Worker 203 KB, `sqlite3.wasm` 402 KB); each later module must be checked against a first-load budget.
- **One tab per account.** A second tab is refused rather than sharing the database; trial users rarely open two, so the UI only needs a clear notice. After a deploy, a new tab cannot open until the old tab, still on the previous schema, closes.
- **Chrome grace period is inferred.** The 1 s task budget relies on an unverified ~2 s kill grace.
- **Boot cost grows with data.** At 50k messages the warm boot check stays within budget (Chromium 107 ms, WebKit 228 ms, Firefox 352 ms), mostly `foreign_key_check`. At 500k it exceeds 1 s in WebKit (1.8 s) and Firefox (3.4 s): acceptable for a trial, but if the Web edition ever keeps long-term data, the check must run only when a migration was applied, which changes `src/main`.
- **Bulk-write stalls.** While seeding 500k messages, single 2,000-row write chunks took up to 7.4 s (Chromium), 6.6 s (WebKit) and 24 s (Firefox), blocking every other Worker request; the cause is not isolated. Trial writes are far smaller, but imports must not write in large transactions.
- **Firefox is slower.** Every functional test passes, but writes are 4–6× slower than in Chromium (a 60k-row transaction takes 18.5 s).
- **Shim drift.** The facade covers only the better-sqlite3 surface the repo uses; new usages of other methods (`backup`, `serialize`, `loadExtension`) fail until added. The main-suite compatibility run (AC1) is a manual script, not a CI gate, so it can regress unnoticed.
- **Bundle aliasing.** If `src/main` services start importing more Electron-only modules, the browser build breaks; the `bundle-web-core` validation task fails on any Node or Electron import, and the fix may need a new browser replacement.
- **Search route.** `/search/contents` also searches agent sessions, whose services are not browser-ready; until they are, the Web UI cannot use that route unchanged.
