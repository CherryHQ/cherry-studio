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
2. Opens a LibSQL file-backed database at `file://<tmp>/test.db` using
   `pathToFileURL` (safe on Windows too).
3. Runs the production migrations (`migrations/sqlite-drizzle/`) and the
   project's `CUSTOM_SQL_STATEMENTS` (FTS5 virtual tables, triggers). The
   resulting schema is byte-for-byte identical to what the real app sees
   after `DbService.onInit`.
4. Registers durable PRAGMAs (`foreign_keys = ON`, `synchronous = NORMAL`)
   via the patched `@libsql/client` `setPragma()` so they survive the
   transaction-induced connection recycle. See the "Gotchas" section.
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
- LibSQL client-level contract tests (`pragmaReplay.test.ts`) — they need
  direct control over the underlying client.
- Migrator tests under `src/main/data/migration/v2/migrators/__tests__/*` —
  their mock context has been deliberately modelled to verify the
  migrator's orchestration logic (phase ordering, idempotency, source
  fallbacks). A real DB would not add coverage over what the mock
  already asserts.
- Orchestration-layer service tests that mock their downstream data
  service (`KnowledgeRuntimeService`, `KnowledgeOrchestrationService`,
  `MCPService`) — they test coordination, not persistence.

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

### LibSQL transaction connection recycle

`@libsql/client`'s `transaction()` releases the current connection and
lazily creates a new one on the next operation. Without the project's
patched `setPragma()` replay mechanism, per-connection PRAGMAs (like
`foreign_keys = ON`) would silently revert after every transaction.

The harness correctly uses `setPragma()` to register durable settings
(replayed on every reconnect), but uses one-shot `client.execute()` for
transient settings (like temporarily toggling FK off during truncate) —
otherwise the replay array would grow linearly with truncate cycles.

### `file:` URL on Windows

A naive `'file:' + path.join(tmpdir(), 'test.db')` produces an illegal URL
on Windows (`file:C:\path\to\db`). The harness uses
`pathToFileURL(dbPath).href` which yields `file:///C:/path/to/db`.

### FTS5 and NULL content

`searchable_text` is populated by the `AFTER INSERT` trigger from the
message's `data.blocks`; messages without any `main_text` block end up
with NULL `searchable_text`. The FTS5 `AFTER DELETE` trigger then deletes
using the NULL value. This is safe — truncate passes — but your FTS
assertions must account for the possibility.

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
