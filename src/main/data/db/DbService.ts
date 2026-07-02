import { application } from '@application'
import { loggerService } from '@logger'
import { DIAGNOSTICS_ENABLED, SLOW_THRESHOLD_MS } from '@main/core/diagnostics'
import {
  BaseService,
  ErrorHandling,
  Injectable,
  Phase,
  Priority,
  type ProfileActivatable,
  type ProfileActivationContext,
  ServicePhase
} from '@main/core/lifecycle'
import Database from 'better-sqlite3'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import fs from 'fs'
import path from 'path'

import { CUSTOM_SQL_STATEMENTS } from './customSqls'
import { seeders } from './seeding'
import { SeedRunner } from './seeding/SeedRunner'
import type { DbOrTx, DbType } from './types'

const logger = loggerService.withContext('DbService')

/**
 * The connection resource. A sum type so an "open db without its sqlite handle"
 * state cannot be represented — the two are acquired and released together.
 */
type DbConnection =
  | { readonly kind: 'closed' }
  | { readonly kind: 'open'; readonly sqlite: Database.Database; readonly db: DbType }

/**
 * Database service managing the SQLite connection via Drizzle ORM.
 *
 * The connection is per-profile: it is opened (migrate + seed) when a profile
 * is activated and closed when it is deactivated, so switching profiles swaps
 * the entire database. `getDb()` / `withWriteTx()` throw while no profile is
 * bound. Activates first / deactivates last among profile participants, so every
 * other profile-scoped service sees an open DB for its whole active window.
 *
 * @example
 * ```typescript
 * import { application } from '@application'
 *
 * const db = application.get('DbService').getDb()
 * ```
 */
@Injectable('DbService')
@ServicePhase(Phase.BeforeReady)
@Priority(10)
@ErrorHandling('fail-fast')
export class DbService extends BaseService implements ProfileActivatable {
  private connection: DbConnection = { kind: 'closed' }

  /**
   * Open the active profile's database: ensure file integrity, open a fresh
   * better-sqlite3 connection at the profile-resolved path, configure PRAGMAs,
   * migrate, and seed. On any failure the connection is closed and the service
   * stays unbound (error contract) before the error propagates.
   */
  onProfileActivate(ctx: ProfileActivationContext): void {
    const dbPath = application.getPath('app.database.file')
    this.ensureDatabaseIntegrity(dbPath)
    // better-sqlite3 opens a bare filesystem path and keeps a single synchronous
    // connection for the profile's active window; PRAGMAs are set once per open.
    const sqlite = new Database(dbPath)
    try {
      const db = drizzle({ client: sqlite, casing: 'snake_case' })
      if (DIAGNOSTICS_ENABLED) this.installSlowQueryProbe(sqlite)
      this.configurePragmas(sqlite)
      this.migrateDb(db)
      new SeedRunner(db).runAll(seeders)
      this.connection = { kind: 'open', sqlite, db }
      logger.info('Database opened for profile', { profileId: ctx.profileId, dbPath })
    } catch (error) {
      sqlite.close()
      logger.error('Failed to open database for profile', error as Error, { profileId: ctx.profileId })
      throw error
    }
  }

  /**
   * Close the current profile's connection. `close()` is synchronous and flushes
   * the WAL, so there is nothing to drain — better-sqlite3 runs every write to
   * completion in a single JS turn, so no write can be in flight here.
   */
  onProfileDeactivate(): void {
    if (this.connection.kind === 'open') {
      this.connection.sqlite.close()
      this.connection = { kind: 'closed' }
      logger.info('Database closed')
    }
  }

  /**
   * Opt-in (CS_DIAGNOSTICS): log any DB call slower than 15ms with its SQL, row
   * count, and the caller's stack (esbuild keeps function names, so the
   * endpoint/service that issued the query is identifiable). better-sqlite3 runs
   * every statement synchronously on the main thread, so a large result set blocks
   * the loop — this pins which one. drizzle compiles each query to a prepared
   * statement on our single connection, so wrapping this connection's `prepare`
   * (instrumenting the statement's run/get/all) and `exec` (raw multi-statement
   * SQL such as migrations and custom DDL) covers every query through one hook.
   */
  private installSlowQueryProbe(sqlite: Database.Database): void {
    const frames = (stack: string | undefined): string =>
      (stack ?? '')
        .split('\n')
        .filter((l) => l.includes('index.js'))
        .slice(0, 8)
        .map((l) => l.trim())
        .join(' <- ')

    const logSlow = (dt: number, label: string, detail: string, stack: string | undefined): void => {
      if (dt > SLOW_THRESHOLD_MS.dbQuery) {
        logger.info(`[Diagnostics/slow-query] ${dt.toFixed(1)}ms ${label} ${detail} | ${frames(stack)}`)
      }
    }

    const describe = (method: 'run' | 'get' | 'all', res: unknown, sqlText: string): string => {
      const rows =
        method === 'all'
          ? String((res as unknown[])?.length ?? '?')
          : method === 'get'
            ? res == null
              ? '0'
              : '1'
            : `changes=${(res as { changes?: number })?.changes ?? '?'}`
      return `${rows} sql=${sqlText}`
    }

    type AnyFn = (...args: unknown[]) => unknown
    const raw = sqlite as unknown as { prepare: AnyFn; exec: AnyFn }

    const origPrepare = raw.prepare.bind(raw)
    raw.prepare = (...prepareArgs: unknown[]) => {
      const stmt = origPrepare(...prepareArgs) as Record<string, AnyFn>
      const sqlText = String(prepareArgs[0] ?? '?').slice(0, 160)
      for (const method of ['run', 'get', 'all'] as const) {
        const orig = stmt[method]
        if (typeof orig !== 'function') continue
        const bound = orig.bind(stmt)
        stmt[method] = (...args: unknown[]) => {
          const callerStack = new Error().stack
          const t0 = performance.now()
          const res = bound(...args)
          logSlow(performance.now() - t0, method, describe(method, res, sqlText), callerStack)
          return res
        }
      }
      return stmt
    }

    const origExec = raw.exec.bind(raw)
    raw.exec = (...execArgs: unknown[]) => {
      const callerStack = new Error().stack
      const t0 = performance.now()
      const res = origExec(...execArgs)
      logSlow(performance.now() - t0, 'exec', `sql=${String(execArgs[0] ?? '?').slice(0, 160)}`, callerStack)
      return res
    }
  }

  /**
   * Configure database PRAGMAs (WAL mode, synchronous, foreign keys, busy timeout).
   *
   * Set once per opened connection. `journal_mode = WAL` is additionally persisted
   * in the database file; `synchronous = NORMAL` is WAL's safe pairing;
   * `foreign_keys = ON` enables the schema's ON DELETE CASCADE / SET NULL;
   * `busy_timeout` makes a brief external lock (e.g. a dev tool opening the db)
   * wait rather than fail.
   */
  private configurePragmas(sqlite: Database.Database): void {
    try {
      sqlite.pragma('journal_mode = WAL')
      sqlite.pragma('synchronous = NORMAL')
      sqlite.pragma('foreign_keys = ON')
      sqlite.pragma('busy_timeout = 5000')
      logger.info('Database PRAGMAs configured (WAL, synchronous, foreign_keys, busy_timeout)')
    } catch (error) {
      logger.warn('Failed to configure database PRAGMAs', error as Error)
    }
  }

  /**
   * Run database migrations, then the custom SQL Drizzle cannot manage.
   */
  private migrateDb(db: DbType): void {
    try {
      const migrationsFolder = application.getPath('app.database.migrations')
      migrate(db, { migrationsFolder })
      this.runCustomMigrations(db)
      logger.info('Database migration completed successfully')
    } catch (error) {
      logger.error('Database migration failed', error as Error)
      throw error
    }
  }

  /**
   * Run custom SQL statements that Drizzle cannot manage (triggers, virtual
   * tables, etc.). Called after every migration because Drizzle doesn't track
   * these, DROP TABLE removes associated triggers, and all statements use
   * IF NOT EXISTS so they are idempotent.
   */
  private runCustomMigrations(db: DbType): void {
    try {
      for (const statement of CUSTOM_SQL_STATEMENTS) {
        db.run(sql.raw(statement))
      }
      logger.debug('Custom migrations completed', { count: CUSTOM_SQL_STATEMENTS.length })
    } catch (error) {
      logger.error('Custom migrations failed', error as Error)
      throw error
    }
  }

  /**
   * Get the database instance.
   * @throws {Error} If no profile is bound (the DB is closed).
   */
  public getDb(): DbType {
    if (this.connection.kind !== 'open') {
      throw new Error('DbService: database is not active — no profile is bound (open on profile activation).')
    }
    return this.connection.db
  }

  /**
   * Composes writes into one `BEGIN IMMEDIATE` transaction. Use it when a mutation
   * must commit all-or-nothing across more than one statement (multiple writes, or a
   * read-then-write); a single autocommit write does not need it — better-sqlite3 runs
   * each statement atomically on its one connection. It is not the readiness gate
   * either: it throws (like `getDb()`) when no profile is bound.
   *
   * The premise is **atomicity**, not serialization. better-sqlite3 keeps one
   * synchronous connection, so a transaction runs to completion in a single JS turn
   * and can never interleave with another write — writes serialize by construction,
   * with no process-wide mutex or BUSY retry (those tamed libsql's async
   * per-transaction connections, upstream issue #288). This is a thin wrapper over
   * `db.transaction(fn, { behavior: 'immediate' })`: `BEGIN IMMEDIATE` takes the write
   * lock up front, which matters only if a second connection ever writes concurrently
   * — with today's single connection it behaves identically to a plain
   * `db.transaction(fn)`, so it is the correct write-intent default, not a live
   * necessity. A direct `db.transaction()` is therefore equivalent for atomicity;
   * `withWriteTx` is the conventional, greppable write seam.
   *
   * Returns **synchronously**: better-sqlite3 runs the whole transaction on its
   * single connection with no I/O wait, so the write has already committed by the
   * time this returns `T`. It is intentionally NOT `async` — there is no real
   * async work to await. Call it directly from `async` service methods; no
   * `await` needed.
   *
   * Reads do NOT need this — WAL mode gives readers snapshot isolation that is
   * never blocked by writers.
   *
   * ## Invariant for `fn`
   *
   * `fn` MUST be synchronous and perform only DB operations. better-sqlite3
   * rejects a transaction function that returns a Promise, so do NOT `await`
   * network IO, file IO, or handler execution inside `fn` — compose only DB
   * writes here.
   *
   * @example Single write
   * ```ts
   * dbService.withWriteTx((tx) => jobService.setMetadataTx(tx, id, metadata))
   * ```
   *
   * @example Compose multiple writes into one transaction
   * ```ts
   * dbService.withWriteTx((tx) => {
   *   jobService.cancelByIdsTx(tx, ids, error)
   *   jobService.resetToPendingByIdsTx(tx, otherIds)
   * })
   * ```
   */
  public withWriteTx<T>(fn: (tx: DbOrTx) => T): T {
    if (this.connection.kind !== 'open') {
      throw new Error('DbService: database is not active — no profile is bound (open on profile activation).')
    }
    return this.connection.db.transaction(fn, { behavior: 'immediate' })
  }

  /**
   * Ensure database file integrity before opening the connection.
   * Handles two scenarios that cause SQLITE_IOERR_SHORT_READ:
   * 1. Main .db file is 0 bytes (corrupt) — remove so SQLite recreates it
   * 2. Main .db file missing but orphaned -wal/-shm remain — SQLite attempts
   *    WAL recovery against an empty file and fails
   */
  private ensureDatabaseIntegrity(dbPath: string): void {
    if (fs.existsSync(dbPath)) {
      const stats = fs.statSync(dbPath)
      if (stats.size === 0) {
        logger.warn('Database file is empty (0 bytes), removing')
        fs.unlinkSync(dbPath)
      } else {
        return
      }
    }

    for (const suffix of ['-wal', '-shm']) {
      const auxPath = dbPath + suffix
      if (fs.existsSync(auxPath)) {
        logger.warn(`Removing orphaned auxiliary file: ${path.basename(auxPath)}`)
        fs.unlinkSync(auxPath)
      }
    }
  }
}
