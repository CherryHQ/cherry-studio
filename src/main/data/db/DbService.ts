import { application } from '@application'
import type { Client } from '@libsql/client'
import { createClient } from '@libsql/client'
import { loggerService } from '@logger'
import { BaseService, ErrorHandling, Injectable, Priority, ServicePhase } from '@main/core/lifecycle'
import { Phase } from '@main/core/lifecycle'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

import { CUSTOM_SQL_STATEMENTS } from './customSqls'
import { seeders } from './seeding'
import { SeedRunner } from './seeding/SeedRunner'
import type { DbType } from './types'

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

  constructor() {
    super()
    try {
      this.ensureDatabaseIntegrity()
      const url = pathToFileURL(application.getPath('app.database.file')).href
      this.client = createClient({ url })
      this.db = drizzle({ client: this.client, casing: 'snake_case' })
      logger.info('Database connection initialized', {
        dbPath: application.getPath('app.database.file')
      })
    } catch (error) {
      logger.error('Failed to initialize database connection', error as Error)
      throw new Error('Database initialization failed')
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
   *   `SQLITE_DEFAULT_FOREIGN_KEYS=1`, unlike standard SQLite
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
      // DbService is `@ErrorHandling('fail-fast')` — a PRAGMA failure here means
      // subsequent migrations would run with foreign_keys off / synchronous=FULL
      // / no WAL, which is unsafe. Rethrow so the lifecycle container halts boot.
      logger.error('Failed to configure database PRAGMAs', error as Error)
      throw error
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
