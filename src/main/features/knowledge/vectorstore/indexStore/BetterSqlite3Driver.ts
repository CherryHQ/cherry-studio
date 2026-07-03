import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { toAsarUnpackedPath } from '@main/utils/asar'
import Database from 'better-sqlite3'
import { getLoadablePath } from 'sqlite-vec'

import type { SqliteDriver, SqliteReclaimOutcome, SqliteTransaction, SqlQueryResult, SqlValue } from './types'

/**
 * VACUUM in {@link BetterSqlite3Driver.reclaim} only when the freelist is BOTH a large
 * fraction of the file AND past an absolute floor. The fraction skips rewriting a
 * huge index to reclaim a relatively tiny delete (whose freed pages a later index
 * would reuse anyway); the floor skips the whole-file-rewrite block when there is
 * little to actually return. Below either bound, reclaim just truncates the WAL.
 */
const VACUUM_MIN_FREELIST_RATIO = 0.2
const VACUUM_MIN_FREED_BYTES = 8 * 1024 * 1024

/** A value better-sqlite3 will accept as a bound statement parameter. */
type Bindable = string | number | bigint | Buffer | null

/**
 * Normalize a {@link SqlValue} into something better-sqlite3 can bind. better-sqlite3
 * only binds numbers, bigints, strings, Buffers and null — it rejects bare booleans,
 * `Uint8Array`s that aren't Buffers, and `ArrayBuffer`s. The vector blobs arrive as
 * `Uint8Array` (see encodeVectorBlob), so wrap them as a Buffer with no copy.
 */
function toBindable(value: SqlValue): Bindable {
  if (value === null) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  return value
}

/**
 * SqliteDriver backed by a synchronous better-sqlite3 connection (the only engine).
 *
 * No internal write mutex: every writer (rebuildMaterial / deleteMaterials /
 * reclaimSpace) runs under `KnowledgeLockManager.withBaseMutationLock(baseId)`, a
 * per-base async-mutex that already serializes all writes to a base's index — so the
 * driver never self-serializes. better-sqlite3's single connection makes
 * `transaction` inherently atomic; reads run on the same connection and ride WAL /
 * busy_timeout. `transaction` uses better-sqlite3's native `db.transaction(fn).immediate`
 * (BEGIN IMMEDIATE, matching the old libsql 'write' tx) rather than hand-rolled
 * BEGIN/COMMIT/ROLLBACK: it runs `fn` synchronously to completion in one JS turn, so
 * BEGIN and COMMIT can never straddle an event-loop yield — no unrelated read on this
 * connection can ever observe a transaction mid-flight. It also throws `TypeError` if
 * `fn` returns a Promise, turning an accidental async callback into a loud failure
 * instead of a silent early commit.
 *
 * NOTE (future KB-owner cleanup): the driver trusts callers to hold the base lock and does not
 * self-check it. A cheap `transactionActive` reentrancy assertion in {@link transaction} could
 * turn a forgotten lock into an explicit driver error instead of SQLite's opaque "cannot start
 * a transaction within a transaction" — worth considering, intentionally left out of this migration.
 */
export class BetterSqlite3Driver implements SqliteDriver {
  private closed = false

  constructor(private readonly db: Database.Database) {}

  execute(sql: string, args: SqlValue[] = []): SqlQueryResult {
    this.assertOpen()
    const stmt = this.db.prepare(sql)
    const bound = args.map(toBindable)
    // `reader` is true for statements that yield rows (SELECT, row-returning PRAGMA).
    // run() throws on those and all() throws on non-row statements, so split on it.
    if (stmt.reader) {
      return { rows: stmt.all(...bound) as Array<Record<string, SqlValue>>, changes: 0 }
    }
    const result = stmt.run(...bound)
    return { rows: [], changes: result.changes }
  }

  transaction<T>(fn: (tx: SqliteTransaction) => T): T {
    this.assertOpen()
    const handle: SqliteTransaction = {
      execute: (sql, args) => this.execute(sql, args)
    }
    // .immediate acquires the write lock up front (BEGIN IMMEDIATE), so a
    // read-then-write transaction never fails mid-way after the read already ran.
    return this.db.transaction((tx: SqliteTransaction) => fn(tx)).immediate(handle)
  }

  reclaim(preVacuumStatements: readonly string[] = []): SqliteReclaimOutcome {
    this.assertOpen()
    // Checkpoint first: frees the WAL (cheap) and folds committed frees from the
    // delete into the main file so freelist_count reflects them. The base lock
    // serializes writes, so VACUUM (which cannot run inside a transaction) executes
    // in autocommit as required.
    this.db.pragma('wal_checkpoint(TRUNCATE)')

    const pageSize = this.readPragmaInt('page_size')
    const pageCount = this.readPragmaInt('page_count')
    const freelist = this.readPragmaInt('freelist_count')
    const ratio = pageCount > 0 ? freelist / pageCount : 0
    if (ratio < VACUUM_MIN_FREELIST_RATIO || freelist * pageSize < VACUUM_MIN_FREED_BYTES) {
      return { vacuumed: false, reclaimedBytes: 0 }
    }

    // Run caller-owned maintenance now that we've committed to the whole-file rewrite —
    // gated behind the same threshold so a sub-threshold delete never pays for it. The
    // driver stays schema-agnostic: the knowledge store passes its external-content FTS
    // 'optimize' (which compacts the dead trigram-segment rows VACUUM cannot reach on its
    // own), but that table name and op live with the schema, not in this generic driver.
    for (const statement of preVacuumStatements) {
      this.db.exec(statement)
    }
    this.db.pragma('wal_checkpoint(TRUNCATE)')

    // VACUUM rewrites the whole file and renumbers every table's implicit rowid, so any
    // external-content FTS in the schema must key on a stable surrogate column rather than
    // the implicit rowid (the knowledge schema's fts_rowid does — see schema.ts; keying on
    // the implicit rowid would reintroduce the #16132 desync). VACUUM rewrites into the WAL,
    // so checkpoint+truncate again to release it.
    this.db.exec('VACUUM')
    this.db.pragma('wal_checkpoint(TRUNCATE)')
    const pageCountAfter = this.readPragmaInt('page_count')
    return { vacuumed: true, reclaimedBytes: Math.max(0, pageCount - pageCountAfter) * pageSize }
  }

  /** Read a single-value PRAGMA (e.g. `page_count`) as a number. */
  private readPragmaInt(pragma: string): number {
    return Number(this.db.pragma(pragma, { simple: true }) ?? 0)
  }

  isClosed(): boolean {
    return this.closed
  }

  /** Idempotent: a second close() (e.g. shutdown after an explicit deleteStore) is a no-op. */
  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.db.close()
  }

  /** Fail use-after-close with a deterministic error instead of an opaque driver one. */
  private assertOpen(): void {
    if (this.closed) {
      throw new Error('Knowledge index store driver is closed')
    }
  }
}

/**
 * Open a per-base index database driver at `filePath`. Configures the connection
 * PRAGMAs: a busy timeout (so reads outside a write don't hit SQLITE_BUSY against a
 * concurrent write), synchronous = NORMAL (WAL's safe pairing), foreign keys (so the
 * schema's ON DELETE CASCADE / SET NULL fire), and WAL journal mode. Then loads the
 * sqlite-vec extension that provides `vec_distance_cosine`. Mirrors the main
 * DbService PRAGMA setup. better-sqlite3 keeps one connection, so each PRAGMA is set
 * once and holds for the connection's lifetime — no replay machinery is needed.
 */
export function openBetterSqlite3IndexDriver(filePath: string): BetterSqlite3Driver {
  // better-sqlite3 creates the database FILE but not its parent directory (unlike libsql's
  // file: URL client), so ensure the base's index dir exists before opening.
  mkdirSync(dirname(filePath), { recursive: true })
  const db = new Database(filePath)
  try {
    db.pragma('busy_timeout = 5000')
    db.pragma('synchronous = NORMAL')
    db.pragma('foreign_keys = ON')
    db.pragma('journal_mode = WAL')
    // sqlite-vec ships per-platform prebuilt extensions; getLoadablePath() resolves the
    // current platform's vec0.<dylib|so|dll>, and toAsarUnpackedPath rewrites the asar
    // path to its unpacked copy so dlopen sees a real on-disk file in the packaged app.
    db.loadExtension(toAsarUnpackedPath(getLoadablePath()))
  } catch (error) {
    // Close the just-opened connection so a failed open never leaks the file handle
    // (on Windows a leaked handle would later block deleting the base directory).
    db.close()
    throw error
  }
  return new BetterSqlite3Driver(db)
}
