/**
 * Migration-specific bare DB service.
 *
 * Provides a lightweight database connection for V2 migration checks and execution,
 * completely independent of the application lifecycle system.
 *
 * This file lives inside migration/v2/ so it is removed when migration is deleted.
 */

import { CUSTOM_SQL_STATEMENTS } from '@data/db/customSqls'
import type { DbType } from '@data/db/types'
import { loggerService } from '@logger'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

const logger = loggerService.withContext('MigrationDbService')

const DB_NAME = 'cherrystudio.sqlite'
const MIGRATIONS_BASE_PATH = 'migrations/sqlite-drizzle'

export class MigrationDbService {
  private db: DbType

  private constructor(db: DbType) {
    this.db = db
  }

  /**
   * Create a MigrationDbService with connection, WAL, schema migrations, and custom SQL.
   * No seeds are run — migration does not need them.
   */
  static async create(): Promise<MigrationDbService> {
    ensureDatabaseIntegrity()

    const dbUrl = pathToFileURL(path.join(app.getPath('userData'), DB_NAME)).href
    const db = drizzle({ connection: { url: dbUrl }, casing: 'snake_case' })

    // Each PRAGMA must be a separate statement — @libsql/client's db.prepare()
    // only compiles the first statement in a multi-statement string, silently
    // discarding the rest.
    try {
      await db.run(sql`PRAGMA journal_mode = WAL`)
      await db.run(sql`PRAGMA synchronous = NORMAL`)
      logger.info('WAL mode configured')
    } catch (error) {
      logger.warn('Failed to configure WAL mode', error as Error)
    }

    // Schema migrations
    const migrationsFolder = app.isPackaged
      ? path.join(process.resourcesPath, MIGRATIONS_BASE_PATH)
      : path.join(__dirname, '../../', MIGRATIONS_BASE_PATH)
    await migrate(db, { migrationsFolder })

    // libsql is compiled with SQLITE_DEFAULT_FOREIGN_KEYS=1 (see libsql-ffi/build.rs),
    // so every new connection has foreign_keys = ON by default. Drizzle's migrate()
    // also forces foreign_keys = ON in its finally block. Turn it OFF for migration:
    // bulk inserts with self-referencing FKs (message.parentId → message.id) need FK
    // disabled. Migration validates data integrity via PRAGMA foreign_key_check after
    // all migrators complete (see MigrationEngine.verifyForeignKeys).
    await db.run(sql`PRAGMA foreign_keys = OFF`)

    // Custom SQL (triggers, FTS, etc.) — all idempotent
    for (const statement of CUSTOM_SQL_STATEMENTS) {
      await db.run(sql.raw(statement))
    }

    logger.info('Migration database ready')
    return new MigrationDbService(db)
  }

  getDb(): DbType {
    return this.db
  }

  close(): void {
    try {
      ;(this.db as any).$client?.close()
      logger.info('Migration database connection closed')
    } catch (error) {
      logger.warn('Failed to close migration database connection', error as Error)
    }
  }
}

/**
 * Ensure database file integrity before opening connection.
 * Duplicated from DbService — this file is temporary and will be removed with migration.
 */
function ensureDatabaseIntegrity(): void {
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
