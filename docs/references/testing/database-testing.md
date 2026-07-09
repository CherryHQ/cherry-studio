# Database Testing Guide

This guide covers how to write tests that exercise the SQLite data layer in the
main process. It documents the unified test harness introduced alongside the
v2 refactor and the idioms that replace the older hand-rolled setups.

## TL;DR

For any service, handler, seeder, or migration that reads or writes SQLite,
use `setupTestDatabase()` from `@test-helpers/db`. It wires a real, isolated,
file-backed SQLite database into Vitest's lifecycle and exposes it through
the production `application.get('DbService').getDb()` path. You do not need
to mock `@application`, nor write any `CREATE TABLE` SQL, nor reach for the
`vi.mock('node:fs', importOriginal)` escape hatch.

```typescript
import { setupTestDatabase } from '@test-helpers/db'
import { messageService } from '@data/services/MessageService'
import { messageTable } from '@data/db/schemas/message'
import { eq } from 'drizzle-orm'

describe('MessageService', () => {
  const dbh = setupTestDatabase()

  it('persists a message', async () => {
    const msg = await messageService.create({ topicId: 't1', role: 'user', ... })
    const [row] = await dbh.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.id, msg.id))
    expect(row).toMatchObject({ role: 'user' })
  })
})
```

## What the Harness Does

On the first test in a file the harness:

1. Creates a unique temporary directory under `os.tmpdir()`.
2. Opens a better-sqlite3 file-backed database at `<tmp>/test.db` and hands the
   raw connection out as `dbh.sqlite`.
3. Runs the production migrations (`migrations/sqlite-drizzle/`) and the
   project's `CUSTOM_SQL_STATEMENTS` (FTS5 virtual tables, triggers). The
   resulting schema is byte-for-byte identical to what the real app sees
   after `DbService.onInit`.
4. Sets durable PRAGMAs (`foreign_keys = ON`, `synchronous = NORMAL`) once on
   the single persistent connection. better-sqlite3 keeps one connection open
   for the database's lifetime, so PRAGMAs set here persist — no replay needed.
5. Swaps the globally-mocked `DbService` to hand out the real database
   via `MockMainDbServiceUtils.setDb()`. Any production code that calls
   `application.get('DbService').getDb()` now transparently hits the test DB.
6. Asserts `PRAGMA integrity_check = 'ok'` and `PRAGMA foreign_keys = 1`.

Before every test it truncates all user tables (keeping schema and the
`__drizzle_migrations` journal intact). FTS5 shadow tables clear through
the base-table `AFTER DELETE` trigger cascade.

After the whole file runs it closes the client, removes the tmpdir, and
resets the mocks.

## When to Use the Harness

### Do use it for

- Service tests that touch SQLite (`MessageService`, `AssistantService`, …).
- Handler integration tests where the real DB matters (e.g. `temporaryChats.integration.test.ts`).
- Seeder tests.
- Anything that exercises FK cascades, FTS5, `RETURNING` semantics, or
  transactions — because those are exactly where Drizzle-chain mocks lie.

### Do NOT use it for

- Pure logic tests (mappers, transformers, Zod schemas, pagination helpers).
- Handler tests that only verify wiring/routing — these legitimately mock
  the downstream service because the assertion is about the call shape,
  not the DB state.
- Pure migrator unit tests that only verify orchestration logic (phase
  ordering, idempotency, source fallbacks) under
  `src/main/data/migration/v2/migrators/__tests__/*` — a real DB would
  not add coverage over what a mock context already asserts. However,
  many migrator tests are **integration-style** and use `setupTestDatabase()`
  to verify actual SQL output (inserts, FK constraints, ordering, pin
  migration). This is the dominant pattern (~12 of 21 migrator test files).
  Use `setupTestDatabase()` when your migrator test needs to assert database
  state; keep a mock-based approach when you only orchestrate sources.
  
  If you use `setupTestDatabase()` in a migrator test, **do NOT** add a
  redundant local `vi.mock('@application', ...)` — the global setup in
  `tests/main.setup.ts` already mocks `@application` via
  `mockApplicationFactory()`, and the harness transparently wires the
  real database through `MockMainDbServiceUtils.setDb()`. Adding a
  second override is unnecessary and can conflict with the harness.
- Orchestration-layer service tests that mock their downstream data
  service (`KnowledgeService`, `McpService`) — they test
  coordination, not persistence.

## Options

```typescript
export interface TestDatabaseOptions {
  seeders?: ISeeder[]
}
```

- `seeders`: run these after schema init. Useful for the small set of
  service tests that depend on seeded data (`ProviderRegistryService`,
  preset-aware flows).

```typescript
setupTestDatabase({ seeders: [presetProviderSeeder] })
```

## Migration Recipes

### Removing a legacy `vi.mock('@application', ...)` override

```diff
- let realDb: DbType | null = null
-
- vi.mock('@application', () => ({
-   application: {
-     get: vi.fn(() => ({
-       getDb: vi.fn(() => realDb)
-     }))
-   }
- }))
-
- const { MessageService } = await import('../MessageService')
-
- describe('MessageService', () => {
-   beforeEach(async () => {
-     const client = createClient({ url: 'file::memory:' })
-     realDb = drizzle({ client, casing: 'snake_case' })
-     await initializeTables(realDb)
-   })
-   afterEach(() => { realDb = null })
- })
+ import { setupTestDatabase } from '@test-helpers/db'
+ import { messageService } from '@data/services/MessageService'
+
+ describe('MessageService', () => {
+   const dbh = setupTestDatabase()
+   // no manual setup — dbh.db is ready in every it()
+ })
```

### Replacing mock-chain assertions with state assertions

```diff
- const values = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([row]) })
- mockInsert.mockReturnValue({ values })
-
- await service.create(dto)
-
- expect(values).toHaveBeenCalledWith({
-   name: 'New Base',
-   embeddingModelId: 'embed-model',
-   ...
- })
+ const created = await service.create(dto)
+
+ expect(created.name).toBe('New Base')
+ const [row] = await dbh.db.select().from(knowledgeBaseTable)
+ expect(row.name).toBe('New Base')
+ expect(row.embeddingModelId).toBe('embed-model')
```

The new form is stronger: it catches DB-side constraint rewrites
(snake_case column naming, NOT NULL defaults, CHECK rejections) that the
mock could not see.

## Anti-Patterns

Avoid all of the following when you are using the harness.

### Do NOT mock `@application` to override `DbService`

The global setup already mocks `@application` via `mockApplicationFactory()`,
and the harness wires the real DB through `MockMainDbServiceUtils.setDb()`.
A test-local override would trample that wiring.

### Do NOT hand-write `CREATE TABLE` SQL in tests

The harness runs real migrations. Hand-written schemas drift silently when
the production schema evolves; real migrations fail loudly on drift.

### Do NOT use `describe.concurrent` / `test.concurrent` within a harness scope

`MockMainDbServiceUtils.setDb()` is a module-level singleton per test file.
Running sibling tests concurrently would race on that singleton and the
`beforeEach` truncate cycle.

### Do NOT nest `setupTestDatabase()` calls

The harness refuses nested setup with a clear error. Place a single call
at the top of the outermost describe that needs a DB, or split nested
describes into sibling describes.

### Do NOT re-add `vi.mock('node:fs', importOriginal)` in test files

The global `tests/main.setup.ts` keeps `node:fs`, `node:os`, and
`node:path` real now. You don't need to undo a mock that doesn't exist.
If your test genuinely needs to stub a specific fs method (e.g.
`fs.existsSync` returning a fixed value), use `vi.spyOn(fs, 'existsSync')`
or declare a local `vi.mock('node:fs', ...)` with the
`createNodeFsMock` helper from `@test-helpers/mocks/nodeFsMock`.

## Gotchas

### better-sqlite3 native module ABI

better-sqlite3 is a native module, and unlike the repo's other natives it is
NOT N-API — so it is ABI-specific and must be compiled for whichever runtime
loads it. A native `.node` has a single build slot / one ABI, and the app
(Electron) and the tests (system Node) want different ABIs.

We keep the module at the **Node ABI** for tests — that's what `pnpm install`
produces and what Vitest (running under system Node) needs. The `main` project
loads the real native module, so `pnpm test:main` first runs `pnpm rebuild:node`
(via its `pretest:main` hook) to guarantee the Node ABI, then runs the suite;
`pnpm test` does the same via its `pretest` hook. The other Vitest projects
never load better-sqlite3, so their ABI is irrelevant.

The Electron-app entry scripts (`dev`, `dev:watch`, `debug`, `start`) and
packaging need the **Electron ABI** instead; each of those scripts prepends
`pnpm rebuild:electron` (`--force`, so it reliably re-flips even when a test run
left the module at the Node ABI). Switching between the app and the DB tests
therefore flips the ABI, but each flip is a **cached restore** (~0.3s to
Electron, ~2s to Node — not a recompile) and happens automatically:
`pretest`/`pretest:main` before tests, the app scripts before the app.

If you use an interactive runner (`pnpm test:watch`, `pnpm test:coverage`, an
IDE's Vitest) right after `pnpm dev`, flip back first with `pnpm rebuild:node`
(or just run `pnpm test:main` once). CI is unaffected: each job installs fresh
(Node ABI) and runs under system Node; the general-test job's `pretest:main` is
a ~2s no-op there.

**Alternatives considered — why not run the tests under Electron?** Running the
`main` project inside Electron-as-Node (`ELECTRON_RUN_AS_NODE=1 electron …vitest`)
would pin one ABI and delete the flip entirely, and it was prototyped and passed
(real better-sqlite3 + `vec0` loaded at the Electron ABI, no segfault). It was
still rejected — the flip is the cheaper problem:

- **Plain-Node runners could no longer run `main`.** `pnpm test`, a bare
  `vitest`, and the IDE's Vitest extension all run under system Node; with the
  module pinned to the Electron ABI they would fail to load it. The split keeps
  `main` runnable from every one of those.
- **It needs a cross-platform wrapper.** Setting `ELECTRON_RUN_AS_NODE=1` and
  pointing Electron at Vitest portably needs either a new `cross-env` dependency
  or a bespoke runner script (an inline `VAR=1 electron …` does not work in
  Windows `cmd`). The wrapper's very existence is the friction signal.
- **CI pays a cold electron-rebuild every run.** CI runners are ephemeral, so
  their cache is always cold; pinning the Electron ABI would rebuild
  better-sqlite3 to it on every job. The split runs `main` on the `pnpm install`
  default Node ABI, so CI never electron-rebuilds.

The flip's old pain was manual flipping plus `electron-rebuild`'s silent skip
without `--force`; both are fixed (`--force`, and the app scripts prepend the
rebuild), leaving a sub-second cached restore. Measured proof it is a restore,
not a recompile: after `rm -rf build`, the rebuild took 0.28s and produced zero
`.o` object files (a real compile takes tens of seconds and leaves many).

### FTS5 and NULL content

`searchable_text` is populated by the `AFTER INSERT` trigger from the
message's `data.parts` (text-bearing parts); messages with no text part end
up with empty `searchable_text` (the trigger wraps `group_concat` in
`COALESCE(…, '')`). The FTS5 `AFTER DELETE` trigger then deletes using that
value. This is safe — truncate passes — but your FTS assertions must account
for the possibility.

### Truncate vs drop

`beforeEach` truncates user tables; it does not drop or recreate them.
Tests that need to physically drop a table (e.g. rollback-on-corruption
regression tests) will corrupt the harness for every subsequent test in
the file. Keep those scenarios confined to their own dedicated file and
avoid sharing the harness.

## The Mock System

See [`tests/__mocks__/README.md`](../../../tests/__mocks__/README.md) for
the broader mock catalogue. Key pieces the harness relies on:

- `@test-mocks/main/application` — `mockApplicationFactory()` is wired
  globally in `tests/main.setup.ts`.
- `@test-mocks/main/DbService` — the global mock's `MockMainDbServiceUtils`
  is what the harness mutates to route production lookups to the real DB.
- `@test-helpers/mocks/nodeFsMock` — factory for tests that need to stub
  `node:fs` locally (the global setup no longer does this).
