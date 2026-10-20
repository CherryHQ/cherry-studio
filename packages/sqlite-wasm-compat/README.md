# sqlite-wasm compat

A synchronous, better-sqlite3-compatible connection over `@sqlite.org/sqlite-wasm`.
`drizzle-orm/better-sqlite3` and the main-process data layer run on it unchanged,
which is what lets the Web edition's Core Worker reuse the desktop data services.

It differs from sqlite-wasm's defaults where better-sqlite3 behaves differently:

- `PRAGMA foreign_keys = ON` on open, so the schema's `ON DELETE` actions fire.
- Errors are `SqliteError` with better-sqlite3's `code` (e.g. `SQLITE_CONSTRAINT_UNIQUE`)
  and the bare SQLite message, so `classifySqliteError` keeps working.
- `transaction()` nests with savepoints and rejects promise-returning callbacks.
- Prepared statements are reused by SQL text, bounded by `statementCacheSize`;
  Drizzle prepares a fresh statement for every query.

Only the surface the repository uses is implemented. `backup()`, `serialize()` and
`loadExtension()` are absent; there is no file system, WAL or sqlite-vec in the browser.

Await `loadSqlite()` once before the first `new Database()`. In a cross-origin-isolated
Worker pass `{ vfs: 'opfs' }`; `@cherrystudio/web-core` owns that setup.

## Tests

- `pnpm test:sqlite-wasm-compat` — the facade's own contract.
- `pnpm test:sqlite-wasm-compat:main-suite` — the whole main-process suite with
  better-sqlite3 aliased to this package (`testing/betterSqlite3.ts`). Suites that need
  real database files, the backup API, legacy v1 files or sqlite-vec are excluded by
  category in `vitest.main-suite.config.ts`; everything else must pass.
