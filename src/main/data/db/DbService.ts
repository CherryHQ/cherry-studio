import { application } from '@application'
import { loggerService } from '@logger'
import { DIAGNOSTICS_ENABLED, SLOW_THRESHOLD_MS } from '@main/core/diagnostics'
import { BaseService, ErrorHandling, Injectable, Priority, ServicePhase } from '@main/core/lifecycle'
import { Phase } from '@main/core/lifecycle'
import Database from 'better-sqlite3'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import fs from 'fs'
import path from 'path'

import { CUSTOM_SQL_STATEMENTS } from './customSqls'
import { seeders } from './seeding/seederRegistry'
import { SeedRunner } from './seeding/SeedRunner'
import type { DbOrTx, DbType } from './types'

const logger = loggerService.withContext('DbService')

/**
 * Database service managing SQLite connection via Drizzle ORM
 * Managed by the lifecycle system for centralized database access
 *
 * Features:
 * - Database initialization and connection management
 * - Migration and seeding support
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
export class DbService extends BaseService {
  private sqlite: Database.Database
  private db: DbType
  private pragmasConfigured = false

  constructor() {
    super()
    try {
      this.ensureDatabaseIntegrity()
      // better-sqlite3 opens a bare filesystem path (not a file: URL) and keeps a single
      // persistent connection for the process lifetime, so the per-connection PRAGMAs set
      // once in configurePragmas() never need replaying.
      this.sqlite = new Database(application.getPath('app.database.file'))
      this.db = drizzle({ client: this.sqlite, casing: 'snake_case' })
      if (DIAGNOSTICS_ENABLED) this.installSlowQueryProbe()
      logger.info('Database connection initialized', {
        dbPath: application.getPath('app.database.file')
      })
    } catch (error) {
      logger.error('Failed to initialize database connection', error as Error)
      throw new Error('Database initialization failed')
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
  private installSlowQueryProbe(): void {
    const frames = (stack: string | undefined): string =>
      (stack ?? '')
        .split('\n')
        .filter((l) => l.includes('main.js'))
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
    const sqlite = this.sqlite as unknown as { prepare: AnyFn; exec: AnyFn }

    const origPrepare = sqlite.prepare.bind(sqlite)
    sqlite.prepare = (...prepareArgs: unknown[]) => {
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

    const origExec = sqlite.exec.bind(sqlite)
    sqlite.exec = (...execArgs: unknown[]) => {
      const callerStack = new Error().stack
      const t0 = performance.now()
      const res = origExec(...execArgs)
      logSlow(performance.now() - t0, 'exec', `sql=${String(execArgs[0] ?? '?').slice(0, 160)}`, callerStack)
      return res
    }
  }

  /**
   * Lifecycle: Initialize database with WAL mode, run migrations and seeds
   */
  protected onInit(): void {
    this.configurePragmas()
    this.migrateDb()
    new SeedRunner(this.db).runAll(seeders)
  }

  /**
   * Configure database PRAGMAs (WAL mode, synchronous, foreign keys, busy timeout).
   *
   * better-sqlite3 keeps a single persistent connection, so each PRAGMA is set once
   * here and holds for the process lifetime — no replay machinery is needed.
   * `journal_mode = WAL` is additionally persisted in the database file;
   * `synchronous = NORMAL` is WAL's safe pairing; `foreign_keys = ON` enables the
   * schema's ON DELETE CASCADE / SET NULL; `busy_timeout` makes a brief external
   * lock (e.g. a dev tool opening the db) wait rather than fail.
   */
  private configurePragmas(): void {
    if (this.pragmasConfigured) {
      return
    }

    try {
      this.sqlite.pragma('journal_mode = WAL')
      this.sqlite.pragma('synchronous = NORMAL')
      this.sqlite.pragma('foreign_keys = ON')
      this.sqlite.pragma('busy_timeout = 5000')

      this.pragmasConfigured = true
      logger.info('Database PRAGMAs configured (WAL, synchronous, foreign_keys, busy_timeout)')
    } catch (error) {
      logger.warn('Failed to configure database PRAGMAs', error as Error)
    }
  }

  /**
   * Run database migrations
   */
  private migrateDb(): void {
    try {
      const migrationsFolder = application.getPath('app.database.migrations')
      migrate(this.db, { migrationsFolder })

      // Run custom SQL that Drizzle cannot manage (triggers, virtual tables, etc.)
      this.runCustomMigrations()

      logger.info('Database migration completed successfully')
    } catch (error) {
      logger.error('Database migration failed', error as Error)
      throw error
    }
  }

  /**
   * Run custom SQL statements that Drizzle cannot manage
   *
   * This includes triggers, virtual tables, and other SQL objects.
   * Called after every migration because:
   * 1. Drizzle doesn't track these in schema
   * 2. DROP TABLE removes associated triggers
   * 3. All statements use IF NOT EXISTS, so they're idempotent
   */
  private runCustomMigrations(): void {
    try {
      for (const statement of CUSTOM_SQL_STATEMENTS) {
        this.db.run(sql.raw(statement))
      }
      logger.debug('Custom migrations completed', { count: CUSTOM_SQL_STATEMENTS.length })
    } catch (error) {
      logger.error('Custom migrations failed', error as Error)
      throw error
    }
  }

  /**
   * Get the database instance
   * @throws {Error} If database is not initialized
   */
  public getDb(): DbType {
    if (!this.isReady) {
      throw new Error('Database is not initialized, please call init() first!')
    }
    return this.db
  }

  /**
   * Composes writes into one `BEGIN IMMEDIATE` transaction. Use it when a mutation
   * must commit all-or-nothing across more than one statement (multiple writes, or a
   * read-then-write); a single autocommit write does not need it — better-sqlite3 runs
   * each statement atomically on its one connection. It is not the readiness gate
   * either: `getDb()` already throws when the DB isn't ready.
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
   * async work to await, and an `async` wrapper would just be libsql-era residue
   * (the old client was async). Call it directly from `async` service methods; no
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
    if (!this.isReady) {
      throw new Error('Database is not initialized, please call init() first!')
    }
    return this.db.transaction(fn, { behavior: 'immediate' })
  }

  /**
   * Ensure database file integrity before opening connection.
   * Handles two scenarios that cause SQLITE_IOERR_SHORT_READ:
   * 1. Main .db file is 0 bytes (corrupt) — remove so SQLite recreates it
   * 2. Main .db file missing but orphaned -wal/-shm remain — SQLite attempts
   *    WAL recovery against an empty file and fails
   */
  private ensureDatabaseIntegrity(): void {
    const dbPath = application.getPath('app.database.file')

    const dbExists = fs.existsSync(dbPath)

    if (dbExists) {
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
