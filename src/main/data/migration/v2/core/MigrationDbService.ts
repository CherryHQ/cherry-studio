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

import type { MigrationDatabaseDiagnosticsLease } from '../diagnostics'
import type { MigrationPaths } from './MigrationPaths'

const logger = loggerService.withContext('MigrationDbService')

export class MigrationDbService {
  private activeDiagnosticsLeases = 0
  private closeRequested = false
  private closed = false

  private constructor(
    private readonly db: DbType,
    private readonly sqlite: Database.Database,
    private readonly databaseFile: string
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
    return new MigrationDbService(db, sqlite, paths.databaseFile)
  }

  getDb(): DbType {
    return this.db
  }

  async withDiagnosticsLease<T>(
    run: (lease: MigrationDatabaseDiagnosticsLease) => T | Promise<T>
  ): Promise<{ readonly kind: 'leased'; readonly value: T } | { readonly kind: 'unavailable' }> {
    if (this.closed || this.closeRequested || !this.sqlite.open) return { kind: 'unavailable' }

    const identity = captureDiagnosticsIdentity(this.databaseFile)
    if (identity === undefined) return { kind: 'unavailable' }

    this.activeDiagnosticsLeases += 1
    try {
      const lease = createDiagnosticsLease(this.databaseFile, identity)
      return { kind: 'leased', value: await run(lease) }
    } finally {
      this.activeDiagnosticsLeases -= 1
      if (this.closeRequested && this.activeDiagnosticsLeases === 0) this.closeNow()
    }
  }

  close(): void {
    if (this.closed || this.closeRequested) return
    this.closeRequested = true
    if (this.activeDiagnosticsLeases === 0) this.closeNow()
  }

  private closeNow(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.sqlite.close()
      logger.info('Migration database connection closed')
    } catch (error) {
      logger.warn('Failed to close migration database connection', error as Error)
    }
  }
}

type MigrationDatabaseFileIdentity = MigrationDatabaseDiagnosticsLease['identity']['database']

function createDiagnosticsLease(
  databaseFile: string,
  identity: MigrationDatabaseDiagnosticsLease['identity']
): MigrationDatabaseDiagnosticsLease {
  return Object.freeze({
    databaseFile,
    identity: Object.freeze({
      database: Object.freeze(identity.database),
      wal: Object.freeze(identity.wal),
      shm: Object.freeze(identity.shm)
    })
  }) as MigrationDatabaseDiagnosticsLease
}

function regularFileIdentity(file: string): MigrationDatabaseFileIdentity | undefined {
  try {
    const stats = fs.lstatSync(file, { bigint: true })
    if (!stats.isFile() || stats.isSymbolicLink()) return undefined
    return { device: stats.dev.toString(), inode: stats.ino.toString() }
  } catch {
    return undefined
  }
}

function captureDiagnosticsIdentity(databaseFile: string): MigrationDatabaseDiagnosticsLease['identity'] | undefined {
  const database = regularFileIdentity(databaseFile)
  const wal = regularFileIdentity(`${databaseFile}-wal`)
  const shm = regularFileIdentity(`${databaseFile}-shm`)
  return database === undefined || wal === undefined || shm === undefined ? undefined : { database, wal, shm }
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
