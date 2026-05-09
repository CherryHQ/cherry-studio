/**
 * Migration-specific bare DB service.
 *
 * Provides a lightweight database connection for V2 migration checks and execution,
 * completely independent of the application lifecycle system.
 *
 * This file lives inside migration/v2/ so it is removed when migration is deleted.
 */

import { CUSTOM_SQL_STATEMENTS } from '@data/db/customSqls'
import { reconcileDrizzleJournalOrderKeyDrift } from '@data/db/reconcileDrizzleJournalOrderKeyDrift'
import type { DbType } from '@data/db/types'
import { createClient } from '@libsql/client'
import { loggerService } from '@logger'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

import type { MigrationPaths } from './MigrationPaths'

const logger = loggerService.withContext('MigrationDbService')

export class MigrationDbService {
  private db: DbType

  private constructor(db: DbType) {
    this.db = db
  }

  /**
   * Create a MigrationDbService with connection, WAL, schema migrations, and custom SQL.
   * No seeds are run — migration does not need them.
   *
   * All paths come from the pre-resolved MigrationPaths object — never
   * from `app.getPath()` directly. See MigrationPaths.ts for why.
   */
  static async create(paths: MigrationPaths): Promise<MigrationDbService> {
    ensureDatabaseIntegrity(paths.databaseFile)

    const dbUrl = pathToFileURL(paths.databaseFile).href
    const client = createClient({ url: dbUrl })
    const db = drizzle({ client, casing: 'snake_case' })

    try {
      // WAL mode persisted in DB file — no replay needed
      await db.run(sql`PRAGMA journal_mode = WAL`)
      // Per-connection PRAGMA — use setPragma() to survive transaction() reconnects
      client.setPragma('PRAGMA synchronous = NORMAL')
      logger.info('WAL mode configured')
    } catch (error) {
      logger.warn('Failed to configure WAL mode', error as Error)
    }

    // Schema migrations
    await reconcileDrizzleJournalOrderKeyDrift(db, paths.migrationsFolder)
    await migrate(db, { migrationsFolder: paths.migrationsFolder })

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
