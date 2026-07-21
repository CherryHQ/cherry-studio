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
import Database from 'better-sqlite3'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import fs from 'fs'
import path from 'path'

import type { MigrationPaths } from './MigrationPaths'

const logger = loggerService.withContext('MigrationDbService')

export class MigrationDbService {
  private constructor(
    private readonly db: DbType,
    private readonly sqlite: Database.Database
  ) {}

  /**
   * Create a MigrationDbService with connection, WAL, schema migrations, and custom SQL.
   * No seeds are run — migration does not need them.
   *
   * All paths come from the pre-resolved MigrationPaths object — never
   * from `app.getPath()` directly. See MigrationPaths.ts for why.
   */
  static create(paths: MigrationPaths): MigrationDbService {
    ensureDatabaseIntegrity(paths.databaseFile)

    const sqlite = new Database(paths.databaseFile)
    const db = drizzle({ client: sqlite, casing: 'snake_case' })

    try {
      // WAL mode persisted in DB file; synchronous=NORMAL is WAL's safe pairing.
      sqlite.pragma('journal_mode = WAL')
      sqlite.pragma('synchronous = NORMAL')
      logger.info('WAL mode configured')
    } catch (error) {
      logger.warn('Failed to configure WAL mode', error as Error)
    }

    // Schema migrations
    migrate(db, { migrationsFolder: paths.migrationsFolder })

    // Keep foreign keys OFF for the ENTIRE migration. better-sqlite3's single persistent
    // connection makes this one PRAGMA hold for every statement until close() — no replay
    // needed (migrate() restores FK = ON on its own connection, so this must run AFTER it).
    //
    // This lets bulk inserts carry not-yet-resolved references; integrity is then verified
    // after all migrators complete (MigrationEngine.verifyForeignKeys), with each migrator
    // also self-checking its own tables via BaseMigrator.assertOwnedForeignKeys. FK
    // enforcement is restored implicitly: this migration connection is disposed via close()
    // when migration ends, and normal runtime uses DbService's own connection (foreign_keys = ON).
    sqlite.pragma('foreign_keys = OFF')

    // Custom SQL (triggers, FTS, etc.) — all idempotent
    for (const statement of CUSTOM_SQL_STATEMENTS) {
      db.run(sql.raw(statement))
    }

    logger.info('Migration database ready')
    return new MigrationDbService(db, sqlite)
  }

  getDb(): DbType {
    return this.db
  }

  close(): void {
    try {
      this.sqlite.close()
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
function ensureDatabaseIntegrity(dbPath: string): void {
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
