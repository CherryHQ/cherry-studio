import { loggerService } from '@logger'
import { BaseService, ErrorHandling, Injectable, Priority, ServicePhase } from '@main/core/lifecycle'
import { Phase } from '@main/core/lifecycle'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

import { CUSTOM_SQL_STATEMENTS } from './customSqls'
import Seeding from './seeding'
import type { DbType } from './types'

const logger = loggerService.withContext('DbService')

const DB_NAME = 'cherrystudio.sqlite'
const MIGRATIONS_BASE_PATH = 'migrations/sqlite-drizzle'

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
 * import { application } from '@main/core/application'
 *
 * const db = application.get('DbService').getDb()
 * ```
 */
@Injectable('DbService')
@ServicePhase(Phase.BeforeReady)
@Priority(10)
@ErrorHandling('fail-fast')
export class DbService extends BaseService {
  private db: DbType
  private pragmasConfigured = false

  constructor() {
    super()
    try {
      this.ensureDatabaseIntegrity()
      this.db = drizzle({
        connection: { url: pathToFileURL(path.join(app.getPath('userData'), DB_NAME)).href },
        casing: 'snake_case'
      })
      logger.info('Database connection initialized', {
        dbPath: path.join(app.getPath('userData'), DB_NAME)
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
    await this.migrateSeed('preference')
    await this.migrateSeed('translateLanguage')
  }

  /**
   * Configure database PRAGMAs (WAL mode, synchronous, foreign keys).
   *
   * ## Known issue: per-connection PRAGMAs lost after transaction()
   *
   * `@libsql/client`'s `Sqlite3Client.transaction()` nullifies its internal
   * connection (`this.#db = null`) after opening a transaction. The next
   * non-transaction operation lazily creates a **new** `Database` connection
   * whose PRAGMAs reset to libsql compile-time defaults:
   * - `synchronous` reverts to FULL (standard SQLite default)
   * - `foreign_keys` stays ON — libsql (turso's SQLite fork) is compiled with
   *   `SQLITE_DEFAULT_FOREIGN_KEYS=1` (see libsql-ffi/build.rs), unlike
   *   standard SQLite which defaults to OFF
   * - `journal_mode = WAL` is unaffected (persisted in the database file)
   *
   * This is a known limitation with no upstream fix as of @libsql/client 0.17.2.
   * Related issues:
   * - https://github.com/tursodatabase/libsql-client-ts/issues/229
   * - https://github.com/tursodatabase/libsql-client-ts/issues/288
   *
   * TODO: Patch @libsql/client to replay PRAGMAs in `#getDb()` when a new
   * connection is lazily created (similar to PR #328's ATTACH replay pattern).
   */
  private async configurePragmas(): Promise<void> {
    if (this.pragmasConfigured) {
      return
    }

    try {
      // Each PRAGMA must be a separate db.run() call. @libsql/client uses
      // db.prepare() internally which maps to SQLite's sqlite3_prepare_v2() —
      // this API only compiles the FIRST statement in a multi-statement string
      // and silently discards the rest. This is by design in the SQLite C API.
      await this.db.run(sql`PRAGMA journal_mode = WAL`)
      await this.db.run(sql`PRAGMA synchronous = NORMAL`)
      await this.db.run(sql`PRAGMA foreign_keys = ON`)

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
      const migrationsFolder = this.getMigrationsFolder()
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
   * Run seed data migration
   * @param seedName - Name of the seed to run
   */
  private async migrateSeed(seedName: keyof typeof Seeding): Promise<void> {
    try {
      const Seed = Seeding[seedName]
      if (!Seed) {
        throw new Error(`Seed "${seedName}" not found`)
      }

      await new Seed().migrate(this.db)

      logger.info('Seed migration completed successfully', { seedName })
    } catch (error) {
      logger.error('Seed migration failed', error as Error, { seedName })
      throw error
    }
  }

  /**
   * Get the migrations folder based on the app's packaging status
   */
  private getMigrationsFolder(): string {
    if (app.isPackaged) {
      //see electron-builder.yml, extraResources from/to
      return path.join(process.resourcesPath, MIGRATIONS_BASE_PATH)
    } else {
      // in dev/preview, __dirname maybe /out/main
      return path.join(__dirname, '../../', MIGRATIONS_BASE_PATH)
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
    const dbPath = path.join(app.getPath('userData'), DB_NAME)

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
