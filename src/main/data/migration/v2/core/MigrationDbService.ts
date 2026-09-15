/**
 * Migration-specific bare DB service.
 *
 * Provides a lightweight database connection for V2 migration checks and execution,
 * completely independent of the application lifecycle system.
 *
 * This file lives inside migration/v2/ so it is removed when migration is deleted.
 */

import fs from 'fs'
import path from 'path'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { applyMigrations } from '@data/db/applyMigrations'
import type { DbType } from '@data/db/types'
import { loggerService } from '@logger'

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
    try {
      const db = drizzle({ client: sqlite, casing: 'snake_case' })
      sqlite.pragma('journal_mode = WAL')
      sqlite.pragma('synchronous = NORMAL')
      logger.info('WAL mode configured')

      if (!fs.existsSync(paths.migrationsFolder)) {
        throw new Error(`Migrations folder not found: ${paths.migrationsFolder}`)
      }
      applyMigrations(db, paths.migrationsFolder)
      // Migrators validate foreign keys after importing interdependent records.
      sqlite.pragma('foreign_keys = OFF')
      logger.info('Migration database ready')
      return new MigrationDbService(db, sqlite)
    } catch (error) {
      try {
        sqlite.close()
      } catch (closeError) {
        logger.warn('Failed to close migration database', closeError as Error)
      }
      throw new Error('Migration database initialization failed', { cause: error })
    }
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
