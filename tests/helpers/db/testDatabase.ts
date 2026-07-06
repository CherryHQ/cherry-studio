import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CUSTOM_SQL_STATEMENTS } from '@data/db/customSqls'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import type { DbType, ISeeder } from '@data/db/types'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import Database from 'better-sqlite3'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterAll, beforeAll, beforeEach } from 'vitest'

import { resolveMigrationsPath } from './internal/migrationsPath'
import { truncateAll } from './internal/truncate'

export interface TestDatabaseOptions {
  /** Seeders to run after schema init. Default: none. */
  seeders?: ISeeder[]
}

export interface TestDatabaseHandle {
  /** Drizzle DB instance — same type as production `DbService.getDb()`. */
  readonly db: DbType
  /**
   * Raw better-sqlite3 connection under the same DB — the native escape hatch
   * for SQL/PRAGMA a test needs to issue outside Drizzle (e.g. `sqlite.prepare(...).all()`,
   * `sqlite.pragma('foreign_key_check')`).
   */
  readonly sqlite: Database.Database
}

/**
 * Module-scoped guard to detect nested `setupTestDatabase()` calls inside
 * the same describe tree. Such nesting would have both invocations race
 * to overwrite `MockMainDbServiceUtils.setDb()`, leaving the outer scope
 * pointing at a stale DB after the inner `afterAll`.
 */
let activeHarnessCount = 0

/**
 * Register a per-file SQLite harness wrapped around Vitest lifecycle hooks.
 *
 * - `beforeAll` creates an isolated file-backed SQLite DB in `os.tmpdir()`,
 *   runs the production migrations + CUSTOM_SQL_STATEMENTS (+ optional
 *   seeders), then wires the resulting Drizzle instance into the global
 *   `MockMainDbServiceUtils` so that any production code calling
 *   `application.get('DbService').getDb()` transparently hits the test DB.
 * - `beforeEach` truncates user tables while keeping schema intact.
 * - `afterAll` closes the connection, removes the tmpdir, and resets mocks.
 *
 * Usage:
 *
 *   describe('MessageService', () => {
 *     const dbh = setupTestDatabase()
 *
 *     it('persists a message', async () => {
 *       await messageService.create({ ... })
 *       const rows = await dbh.db.select().from(messageTable)
 *       expect(rows).toHaveLength(1)
 *     })
 *   })
 *
 * Returns a lazy handle; `.db`/`.sqlite` throw if accessed before the
 * `beforeAll` hook has run.
 */
export function setupTestDatabase(options: TestDatabaseOptions = {}): TestDatabaseHandle {
  let sqlite: Database.Database | null = null
  let db: DbType | null = null
  let tempDir: string | null = null

  beforeAll(async () => {
    if (activeHarnessCount > 0) {
      throw new Error(
        'setupTestDatabase() cannot be nested. It is already active in an outer describe; ' +
          'remove the inner call or merge the describes.'
      )
    }
    activeHarnessCount += 1

    tempDir = mkdtempSync(join(tmpdir(), 'cs-test-db-'))
    const dbPath = join(tempDir, 'test.db')
    sqlite = new Database(dbPath)
    db = drizzle({ client: sqlite, casing: 'snake_case' })

    // Per-connection PRAGMAs — better-sqlite3 keeps one connection, so set once.
    sqlite.pragma('foreign_keys = ON')
    sqlite.pragma('synchronous = NORMAL')

    // Mirror DbService.onInit(): migrations first, then custom SQL.
    migrate(db, { migrationsFolder: resolveMigrationsPath() })
    for (const stmt of CUSTOM_SQL_STATEMENTS) {
      db.run(sql.raw(stmt))
    }

    if (options.seeders?.length) {
      new SeedRunner(db).runAll(options.seeders)
    }

    // Sanity: FK enforcement on, DB not corrupt. Fail loudly if not.
    const fkValue = Number(sqlite.pragma('foreign_keys', { simple: true }) ?? 0)
    if (fkValue !== 1) {
      throw new Error(`Harness init: PRAGMA foreign_keys expected 1, got ${fkValue}`)
    }
    const integrityValue = String(sqlite.pragma('integrity_check', { simple: true }))
    if (integrityValue !== 'ok') {
      throw new Error(`Harness init: PRAGMA integrity_check failed — ${integrityValue}`)
    }

    // Route production services to this real DB.
    MockMainDbServiceUtils.setDb(db)
    MockMainDbServiceUtils.setIsReady(true)
  })

  beforeEach(() => {
    if (!db || !sqlite) {
      throw new Error('Test database not initialised — setupTestDatabase() beforeAll did not run')
    }
    truncateAll(db, sqlite)
  })

  afterAll(async () => {
    try {
      sqlite?.close()
    } catch {
      // best-effort close
    }
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {
        // best-effort cleanup — tmpdir will be reaped by the OS
      }
    }
    sqlite = null
    MockMainDbServiceUtils.resetMocks()
    activeHarnessCount = Math.max(0, activeHarnessCount - 1)
  })

  return {
    get db(): DbType {
      if (!db) {
        throw new Error(
          'setupTestDatabase(): handle.db accessed before beforeAll ran. ' +
            'Call setupTestDatabase() inside a describe() and access .db from it()/beforeEach().'
        )
      }
      return db
    },
    get sqlite(): Database.Database {
      if (!sqlite) {
        throw new Error('setupTestDatabase(): handle.sqlite accessed before beforeAll ran.')
      }
      return sqlite
    }
  }
}
