import { application } from '@application'
import type { Client } from '@libsql/client'
import { createClient } from '@libsql/client'
import { loggerService } from '@logger'
import { DIAGNOSTICS_ENABLED, SLOW_THRESHOLD_MS } from '@main/core/diagnostics'
import { BaseService, ErrorHandling, Injectable, Priority, ServicePhase } from '@main/core/lifecycle'
import { Phase } from '@main/core/lifecycle'
import { Mutex } from 'async-mutex'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

import { CUSTOM_SQL_STATEMENTS } from './customSqls'
import { seeders } from './seeding'
import { SeedRunner } from './seeding/SeedRunner'
import type { DbOrTx, DbType } from './types'

const WRITE_BUSY_RETRY_DELAY_MS = 50

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
  private client: Client
  private db: DbType
  private pragmasConfigured = false
  private readonly writeMutex = new Mutex()

  constructor() {
    super()
    try {
      this.ensureDatabaseIntegrity()
      const url = pathToFileURL(application.getPath('app.database.file')).href
      this.client = createClient({ url })
      this.db = drizzle({ client: this.client, casing: 'snake_case' })
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
   * Opt-in (CS_DIAGNOSTICS): log any libsql call slower than 15ms with its SQL,
   * row count, and the caller's stack (esbuild keeps function names, so the
   * endpoint/service that issued the query is identifiable). libsql's local
   * `file:` driver runs queries synchronously on the main thread, so a large
   * result set blocks the loop — this pins which one. Covers single statements,
   * batches, and interactive transactions: drizzle routes transaction statements
   * through the tx object returned by `client.transaction()`, not the client, so
   * each surface is wrapped.
   */
  private installSlowQueryProbe(): void {
    type AsyncFn = (...args: unknown[]) => Promise<unknown>

    const sqlOf = (stmt: unknown): string => {
      if (typeof stmt === 'string') return stmt
      if (Array.isArray(stmt)) return String(stmt[0] ?? '?')
      return (stmt as { sql?: string })?.sql ?? '?'
    }
    const describeExecute = (args: unknown[], res: unknown): string =>
      `rows=${(res as { rows?: unknown[] })?.rows?.length ?? '?'} sql=${sqlOf(args[0]).slice(0, 160)}`
    const describeBatch = (args: unknown[]): string => {
      const stmts = (args[0] as unknown[]) ?? []
      return `batch(${stmts.length}) sql=${stmts.map(sqlOf).join('; ').slice(0, 160)}`
    }
    const frames = (stack: string | undefined): string =>
      (stack ?? '')
        .split('\n')
        .filter((l) => l.includes('index.js'))
        .slice(0, 8)
        .map((l) => l.trim())
        .join(' <- ')

    // Wrap one async method in-place; time it and log when slow.
    const instrument = (
      target: Record<string, AsyncFn>,
      method: string,
      label: string,
      describe: (args: unknown[], res: unknown) => string
    ): void => {
      const orig = target[method].bind(target)
      target[method] = async (...args: unknown[]) => {
        const callerStack = new Error().stack
        const t0 = performance.now()
        const res = await orig(...args)
        const dt = performance.now() - t0
        if (dt > SLOW_THRESHOLD_MS.dbQuery) {
          logger.info(
            `[Diagnostics/slow-query] ${dt.toFixed(1)}ms ${label} ${describe(args, res)} | ${frames(callerStack)}`
          )
        }
        return res
      }
    }

    const client = this.client as unknown as Record<string, AsyncFn>
    instrument(client, 'execute', 'execute', describeExecute)
    instrument(client, 'batch', 'batch', describeBatch)

    // Interactive transactions bypass the client wrappers above — wrap the tx
    // object drizzle calls execute/batch on (a fresh one per transaction()).
    const origTransaction = client.transaction.bind(client)
    client.transaction = async (...args: unknown[]) => {
      const tx = (await origTransaction(...args)) as Record<string, AsyncFn>
      instrument(tx, 'execute', 'tx.execute', describeExecute)
      instrument(tx, 'batch', 'tx.batch', describeBatch)
      return tx
    }
  }

  /**
   * Lifecycle: Initialize database with WAL mode, run migrations and seeds
   */
  protected async onInit(): Promise<void> {
    await this.configurePragmas()
    await this.migrateDb()
    await new SeedRunner(this.db).runAll(seeders)
  }

  /**
   * Configure database PRAGMAs (WAL mode, synchronous, foreign keys).
   *
   * ## Background: per-connection PRAGMAs lost after transaction()
   *
   * `@libsql/client`'s `Sqlite3Client.transaction()` nullifies its internal
   * connection (`this.#db = null`) after opening a transaction. The next
   * non-transaction operation lazily creates a **new** `Database` connection
   * whose PRAGMAs reset to libsql compile-time defaults:
   * - `synchronous` reverts to FULL (standard SQLite default)
   * - `foreign_keys` stays ON — libsql is compiled with
   *   `SQLITE_DEFAULT_FOREIGN_KEYS=1` (see libsql-ffi/build.rs), unlike standard SQLite
   * - `journal_mode = WAL` is unaffected (persisted in the database file)
   *
   * ## Fix: patched setPragma() with PRAGMA replay
   *
   * We patched `@libsql/client` (see patches/@libsql__client@0.15.15.patch)
   * to add `client.setPragma()`, which registers per-connection PRAGMAs and
   * automatically replays them in `#getDb()` and `reconnect()` whenever a
   * new connection is created. Pattern borrowed from upstream PR #328's
   * ATTACH replay mechanism.
   *
   * Related upstream issues (still open, no official fix as of 0.17.2):
   * - https://github.com/tursodatabase/libsql-client-ts/issues/229
   * - https://github.com/tursodatabase/libsql-client-ts/issues/288
   */
  private async configurePragmas(): Promise<void> {
    if (this.pragmasConfigured) {
      return
    }

    try {
      // WAL mode is persisted in the database file — only needs to run once,
      // no replay needed across connections.
      await this.db.run(sql`PRAGMA journal_mode = WAL`)

      // Per-connection PRAGMAs — use setPragma() so they are automatically
      // replayed when @libsql/client creates a new connection after transaction().
      this.client.setPragma('PRAGMA synchronous = NORMAL')
      this.client.setPragma('PRAGMA foreign_keys = ON')

      this.pragmasConfigured = true
      logger.info('Database PRAGMAs configured (WAL, synchronous, foreign_keys)')
    } catch (error) {
      logger.warn('Failed to configure database PRAGMAs', error as Error)
    }
  }

  /**
   * Run database migrations
   */
  private async migrateDb(): Promise<void> {
    try {
      const migrationsFolder = application.getPath('app.database.migrations')
      await migrate(this.db, { migrationsFolder })

      // Run custom SQL that Drizzle cannot manage (triggers, virtual tables, etc.)
      await this.runCustomMigrations()

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
  private async runCustomMigrations(): Promise<void> {
    try {
      for (const statement of CUSTOM_SQL_STATEMENTS) {
        await this.db.run(sql.raw(statement))
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
   * Serialized write transaction. All write paths SHOULD use this instead of
   * `getDb().transaction()` to avoid SQLITE_BUSY caused by libsql client-ts
   * upstream issue #288 (busy_timeout ineffective for async transactions).
   *
   * Defense in depth:
   *   1. Process-wide FIFO mutex (async-mutex) serializes write transactions
   *      so OUR writes never collide with each other. Non-cancellable —
   *      callers MUST NOT invoke `writeMutex.cancel()`; shutdown coordinates
   *      via service lifecycle, not lock cancellation.
   *   2. libsql client defaults to `BEGIN IMMEDIATE` (drizzle libsql adapter
   *      drops the config arg; libsql core sets mode="write" → BEGIN
   *      IMMEDIATE). So a transaction acquires the write lock at BEGIN, not
   *      lazily on first write — read-then-write tx never fails mid-way.
   *   3. Single 50ms BUSY retry guards against transient external locks
   *      (legacy direct `db.transaction()` callsites not yet migrated, or
   *      external processes opening the db during dev).
   *
   * Reads do NOT need this — WAL mode gives readers snapshot isolation that
   * is never blocked by writers.
   *
   * ## Concurrency semantics for callers
   *
   * - `acquire()` never throws; later callers wait (pending Promise) until
   *   earlier callers release. No `SQLITE_BUSY` ever surfaces from us to the
   *   caller unless the single retry also fails due to external interference.
   * - FIFO ordering: enqueue order = lock-acquire order = DB write order.
   *
   * ## Invariant for `fn`
   *
   * `fn` MUST only perform DB operations. Do NOT `await` network IO, file IO,
   * or handler execution inside `fn` — that would starve the mutex queue.
   *
   * @example Single write
   * ```ts
   * await dbService.withWriteTx((tx) =>
   *   jobService.setMetadataTx(tx, id, metadata)
   * )
   * ```
   *
   * @example Compose multiple writes into one transaction
   * ```ts
   * await dbService.withWriteTx(async (tx) => {
   *   await jobService.cancelByIdsTx(tx, ids, error)
   *   await jobService.resetToPendingByIdsTx(tx, otherIds)
   * })
   * ```
   */
  public async withWriteTx<T>(fn: (tx: DbOrTx) => Promise<T>): Promise<T> {
    if (!this.isReady) {
      throw new Error('Database is not initialized, please call init() first!')
    }
    const release = await this.writeMutex.acquire()
    try {
      try {
        return await this.db.transaction(fn)
      } catch (err) {
        if ((err as { code?: string }).code !== 'SQLITE_BUSY') throw err
        logger.warn('withWriteTx: SQLITE_BUSY, retrying once', {
          delayMs: WRITE_BUSY_RETRY_DELAY_MS
        })
        await new Promise((resolve) => setTimeout(resolve, WRITE_BUSY_RETRY_DELAY_MS))
        return await this.db.transaction(fn)
      }
    } finally {
      release()
    }
  }

  /**
   * Ensure database file integrity before opening connection.
   * Handles two scenarios that cause SQLITE_IOERR_SHORT_READ:
   * 1. Main .db file is 0 bytes (corrupt) — remove so libsql recreates it
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
