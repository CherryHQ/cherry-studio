# Database Construction (Build, Migrations, Custom SQL, FTS5)

How the SQLite database is **built at boot and evolved over time**. Scope: drizzle migrations, the `CUSTOM_SQL_STATEMENTS` replay, FTS5 / `fts_rowid`, and the additive-vs-rebuild rule.

> **Not here (linked, not duplicated):** schema-authoring patterns (FKs, raw-SQL casing, `rowToEntity`) → [database-patterns.md](./database-patterns.md); default-value & nullability rules → [best-practice-default-values-and-nullability.md](./best-practice-default-values-and-nullability.md); naming (tables / `XxxRow` types) → [naming-conventions.md](../naming-conventions.md); the test harness → [testing/database-testing.md](../testing/database-testing.md); the data-system choice (BootConfig / Cache / Preference / DataApi / `app_state`) → [data/README.md](./README.md); the one-shot v1→v2 data-migration engine → [v2-migration-guide.md](./v2-migration-guide.md).

## 1. Boot init order

`DbService.onInit()` (`src/main/data/db/DbService.ts`) builds the DB in a fixed order:

| # | Step | Notes |
|---|---|---|
| 1 | `ensureDatabaseIntegrity()` (constructor) | Deletes a 0-byte `.db` and orphaned `-wal`/`-shm` sidecars to avoid `SQLITE_IOERR_SHORT_READ`. Opening the DB can delete files. |
| 2 | `configurePragmas()` | `journal_mode=WAL` via `db.run()` (persisted in the file, once); `synchronous=NORMAL` + `foreign_keys=ON` via patched `client.setPragma()` (per-connection — see below). |
| 3 | `migrate()` | Applies un-applied drizzle migrations from `migrations/sqlite-drizzle/`. |
| 4 | `runCustomMigrations()` | Replays `CUSTOM_SQL_STATEMENTS` (FTS vtables + triggers) — **every boot**, unconditionally. |
| 5 | `SeedRunner.runAll(seeders)` | Runs on the just-migrated schema; a schema change a seeder relies on must land in the migration first. See [database-seeding-guide.md](./database-seeding-guide.md). |

**libsql per-connection PRAGMA replay.** `@libsql/client`'s `transaction()` nullifies its connection; the next op opens a fresh connection that resets per-connection PRAGMAs (`synchronous`→FULL; `foreign_keys` stays ON only because libsql is compiled `SQLITE_DEFAULT_FOREIGN_KEYS=1`). A one-shot `PRAGMA foreign_keys=ON` would silently revert at the first transaction boundary, so the repo patches `@libsql/client` (`patches/@libsql__client@*.patch`) to add `client.setPragma()`, which re-applies them on every reconnect. `WAL` is exempt (persisted in the file).

## 2. Drizzle migrations

**Commands** (source of truth = `package.json`):

| Command | Runs | Purpose |
|---|---|---|
| `pnpm db:migrations:generate` | `drizzle-kit generate` | Diff schemas → new `.sql` + snapshot |
| `pnpm db:migrations:check` | `drizzle-kit check` | Migration-chain integrity |

Config — `migrations/sqlite-drizzle.config.ts`: `out=./migrations/sqlite-drizzle`; schema glob `./src/main/data/db/schemas/**/!(*.test).ts` (recursive; excludes `*.test.ts` so drizzle-kit never loads vitest files); `dialect:'sqlite'`; `casing:'snake_case'` (TS `ftsRowid` → DB `fts_rowid`).

The chain is **git-tracked**: `migrations/sqlite-drizzle/*.sql` + `meta/_journal.json` (ordered index) + `meta/*_snapshot.json`. Touching a schema file means you MUST regenerate **and commit** the artifacts.

### regenerate, never rename

On a merge/rebase conflict with an upstream migration: **delete your local `.sql` + its `meta/*_snapshot.json`, then re-run `pnpm db:migrations:generate`**. Never rename/renumber the `.sql` or hand-edit the snapshot — that reuses the snapshot's random `id`, forks the chain, and makes `generate` abort for everyone.

⚠️ **`drizzle-kit generate` exits `0` even on a forked chain** — it can never be your integrity check. Only `pnpm db:migrations:check` detects a duplicate/forked chain. CI runs **both** (chain-check + a generate-and-diff drift gate). **Local `pnpm lint` / `pnpm test` / `pnpm build:check` run neither** — chain forks and schema↔migration drift are invisible until CI, so regenerate + commit before pushing.

### Additive vs table-rebuild

drizzle decides automatically; your lever is schema design. A rebuild copies every row via `INSERT...SELECT`, **does not backfill** existing rows (legacy NULLs need a hand-edited `COALESCE` in the rebuild SQL), and drops attached triggers (§3).

| Change | Result |
|---|---|
| `ALTER TABLE x ADD COLUMN …` — incl. a nullable `.unique()` column (emitted as `ADD COLUMN` + a separate `CREATE UNIQUE INDEX`) | **In-place** (fast metadata) |
| `DROP COLUMN` | In-place (single `ALTER`, modern SQLite) |
| add/change a CHECK, FOREIGN KEY, PRIMARY KEY, column `DEFAULT`, or NOT-NULL tightening | **Full table rebuild** (`PRAGMA foreign_keys=OFF` → `CREATE __new` → `INSERT…SELECT` → `DROP` → `RENAME`) |

A DB column `DEFAULT` is effectively **near-permanent** (SQLite has no `ALTER COLUMN SET DEFAULT`; changing it forces a rebuild that never touches existing rows) — prefer service-layer `?? DEFAULT` for product-chosen values. See [Default Values & Nullability § DB defaults are near-permanent](./best-practice-default-values-and-nullability.md#db-defaults-are-near-permanent).

**Packaged-app path:** `migrate()` reads `application.getPath('app.database.migrations')` → `extraResources/migrations/sqlite-drizzle` when packaged, else a dev-relative path. A migrations folder not shipped via electron-builder `extraResources` works in dev but fails the packaged build at boot.

## 3. Custom SQL (`CUSTOM_SQL_STATEMENTS`)

Drizzle cannot manage **virtual tables (FTS5) or triggers**, so they are NOT in any `.sql`. They live as `string[]` in the schema files (`MESSAGE_FTS_STATEMENTS` in `schemas/message.ts`, `AGENT_SESSION_MESSAGE_FTS_STATEMENTS` in `schemas/agentSessionMessage.ts`), are aggregated in `customSqls.ts` (`CUSTOM_SQL_STATEMENTS`), and `DbService.runCustomMigrations()` replays them after `migrate()` on **every boot**. This is mandatory: a table rebuild's `DROP TABLE` silently drops the table's triggers, so they must be re-asserted afterward — which happens in the same boot (self-healing).

### Cost: O(1) metadata, ~0.1 ms — do NOT gate it on "did a migration run"

Re-running the whole FTS custom-SQL set is **~0.1 ms and independent of row count** (measured with `@libsql/client`: 0.11 ms on an empty DB, 0.13 ms at 50k rows). It is pure metadata — `CREATE VIRTUAL TABLE IF NOT EXISTS` (skipped if present) + `DROP/CREATE TRIGGER` (touch only `sqlite_master`); it does **not** touch rows, re-tokenize, or rebuild any index.

Gating it on "did drizzle apply a migration this boot" would save nothing measurable **and break correctness**: trigger/vtable definitions live here, not in migrations, so a release can change a **trigger body** (e.g. the searchable-text extraction or the `fts_rowid` wiring) with **no schema migration** — re-asserting every boot is exactly what makes that body change take effect on existing DBs. The real condition for re-running is "the definition changed **or** a rebuild dropped it", not "a migration ran"; cheap unconditional re-assertion covers both without detecting either. (Gating safely would require versioning the custom SQL — a per-statement state-tracking mechanism whose complexity isn't worth ~0.1 ms.)

### Two buckets — where work belongs

| Bucket | Examples | Where | Cost |
|---|---|---|---|
| Idempotent schema-object re-assertion | FTS vtables, triggers | `CUSTOM_SQL_STATEMENTS` — **every boot** | O(1) metadata |
| One-shot data operations | backfill, FTS `rebuild`, re-tokenization | a journaled one-shot migration — **never every boot** | O(N) |

Keeping the O(N) bucket out of `CUSTOM_SQL_STATEMENTS` is load-bearing — a boot-time backfill placed there would re-run O(N) on every launch.

### Idempotency rules

The array re-runs every boot, **non-transactionally, one `db.run` per statement**, and `DbService` is fail-fast — a non-idempotent statement throws on the second boot and aborts startup. Order matters: a `CREATE TRIGGER` must come after the `CREATE VIRTUAL TABLE` it references.

- **Virtual tables** → `CREATE VIRTUAL TABLE IF NOT EXISTS` (survives across boots).
- **Triggers** → `DROP TRIGGER IF EXISTS <name>` + a bare `CREATE TRIGGER` (NOT `IF NOT EXISTS`), so an edited body actually replaces the old one. `IF NOT EXISTS` on a trigger would freeze a stale body forever.

## 4. FTS5 external-content tables

Both chat search tables (`message_fts`, `agent_session_message_fts`) are FTS5 external-content tables. **This is the canonical home for the `fts_rowid` rule.**

### Never key on the implicit `rowid` — key on a stable `fts_rowid` column

A table rebuild (drizzle's `INSERT…SELECT` drops the implicit rowid) **and `VACUUM`** reshuffle the base table's implicit `rowid`. An external-content FTS5 table with `content_rowid='rowid'` keeps the old rowids and then **silently** points at the wrong rows — wrong/missing hits, **no error raised**. Fix: a real `integer().unique()` column `fts_rowid`, `content_rowid='fts_rowid'`, assigned by the AFTER INSERT trigger. Because `fts_rowid` is a real column, drizzle's rebuild copies it verbatim and VACUUM never moves it → the index stays aligned **by construction**. (Refs: SQLite forum `acdc2aa30a`, [fts5 docs](https://sqlite.org/fts5.html).)

### Verification: only `integrity-check, 1` is reliable

`INSERT INTO <fts>(<fts>) VALUES('integrity-check')` (the default) does NOT compare the index against the content table — a rowid desync passes silently. Use `INSERT INTO <fts>(<fts>, rank) VALUES('integrity-check', 1)`. The regression guard `src/main/data/db/__tests__/ftsRebuild.test.ts` reproduces a rowid-reshuffling rebuild and asserts `integrity-check, 1` stays clean (and that a NULL `fts_rowid` makes it throw).

### `fts_rowid` properties

| Property | Detail |
|---|---|
| Nullable by design | The AFTER INSERT trigger fills it after the row exists; a `NOT NULL` column would reject the row before the trigger runs. |
| Assignment | `fts_rowid = (SELECT COALESCE(MAX(fts_rowid),0)+1 FROM <table>)` in the AFTER INSERT trigger. The `…_fts_rowid_uniq` UNIQUE index makes this an O(log N) min/max lookup (a bare column → O(N²) bulk migration) and rejects any duplicate loudly. Race-free **only** because writes serialize through `DbService.withWriteTx` (see [database-patterns.md](./database-patterns.md) → Write Serialization). |
| Local-only physical identity | Like `rowid`: never set by app code, **never exported/imported in backups**. Restore MUST insert row-by-row through the trigger; a content row left with NULL `fts_rowid` makes `integrity-check, 1` fail and the row unsearchable. |
| `searchable_text` | Trigger-populated (NOT a SQLite `GENERATED` column). `group_concat` over text parts wrapped in `COALESCE(…,'')` (it returns NULL for tool-only/empty messages; the column is `NOT NULL DEFAULT ''`). `message` extracts `text` parts + `data-code`/`data-translation`/`data-compact` content + `data-error` message; `agent_session_message` extracts `text`+`reasoning`. Adding a searchable part type means updating `searchableTextExpression` — and because triggers are DROP+CREATE, the fix lands on existing DBs at the next boot replay. |

### Deferred hazard: knowledge `search_text_fts`

`src/main/features/knowledge/vectorstore/indexStore/schema.ts` still uses `content_rowid='rowid'` — the same bug class. It is a **separate per-base `index.sqlite`** (not the main DB, not drizzle-managed, not in `CUSTOM_SQL_STATEMENTS`), safe today only because it is never VACUUMed and has no table-rebuild/RENAME path (DDL replays via `IF NOT EXISTS`; `rebuildMaterial` is row-level). If that ever changes, migrate it to a stable integer key. Documented inline in that file.

## 5. Testing the build

`setupTestDatabase()` runs the **real** production migrations + `CUSTOM_SQL_STATEMENTS`, so the test schema is byte-identical to production — hand-writing `CREATE TABLE` in tests is banned. Raw SQL / PRAGMA / FTS `MATCH` go through `dbh.client.execute`; the rebuild regression lives in `ftsRebuild.test.ts`. See [testing/database-testing.md](../testing/database-testing.md).

## 6. Gotchas (quick reference)

| Gotcha | One-liner |
|---|---|
| Custom SQL is NOT in any `.sql` | FTS vtables/triggers live in TS (`customSqls.ts`) and re-run every boot; a rebuild's `DROP TABLE` drops triggers. |
| `generate` exits 0 on a forked chain | Only `db:migrations:check` catches it. CI runs both; local lint/test run neither. |
| regenerate, never rename | Delete `.sql` + snapshot, re-run generate. Renaming forks the chain. |
| Commit the generated artifacts | CI fails on `git status --porcelain migrations/`; regenerating without committing is a CI failure. |
| Additive ≠ rebuild | CHECK/FK/PK/DEFAULT/NOT-NULL changes force a full rebuild that does not backfill existing rows. |
| DB `DEFAULT` is near-permanent | Prefer service `?? DEFAULT` for product-chosen values. |
| Triggers DROP+CREATE, vtables IF NOT EXISTS | `IF NOT EXISTS` on a trigger freezes a stale body. |
| FTS keys on `fts_rowid`, not `rowid` | Implicit rowid reshuffles on rebuild/VACUUM → silent desync. |
| Default `integrity-check` is unreliable | Use `integrity-check, 1` for external-content FTS. |
| `fts_rowid` is local-only | Never back it up; restore through the trigger. |
| Concurrent writes use `withWriteTx` | Not `db.transaction()` — concurrent libsql async transactions surface `SQLITE_BUSY`. |
| Packaged migrations need `extraResources` | Works in dev, fails packaged if not shipped. |
| Per-connection PRAGMAs need `setPragma` | `transaction()` recycles the connection; one-shot PRAGMAs revert. |
