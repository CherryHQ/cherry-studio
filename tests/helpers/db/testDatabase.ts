import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { CUSTOM_SQL_STATEMENTS } from '@data/db/customSqls'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import type { DbType, ISeeder } from '@data/db/types'
import type { Client } from '@libsql/client'
import { createClient } from '@libsql/client'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
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
  /** Underlying LibSQL client — use for `client.execute` escape hatch. */
  readonly client: Client
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
 * - `afterAll` closes the client, removes the tmpdir, and resets mocks.
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
 * Returns a lazy handle; `.db`/`.client` throw if accessed before the
 * `beforeAll` hook has run.
 */
export function setupTestDatabase(options: TestDatabaseOptions = {}): TestDatabaseHandle {
  let client: Client | null = null
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
    client = createClient({ url: pathToFileURL(dbPath).href })
    db = drizzle({ client, casing: 'snake_case' })

    // Durable per-connection PRAGMAs — the patched @libsql/client replays
    // these on every connection reset (e.g. after db.transaction()).
    client.setPragma('PRAGMA foreign_keys = ON')
    client.setPragma('PRAGMA synchronous = NORMAL')

    // Mirror DbService.onInit(): migrations first, then custom SQL.
    await migrate(db, { migrationsFolder: resolveMigrationsPath() })
    for (const stmt of CUSTOM_SQL_STATEMENTS) {
      await db.run(sql.raw(stmt))
    }

    if (options.seeders?.length) {
      await new SeedRunner(db).runAll(options.seeders)
    }

    // Sanity: FK enforcement on, DB not corrupt. Fail loudly if not.
    const fkResult = await client.execute('PRAGMA foreign_keys')
    const fkValue = Number(fkResult.rows[0]?.[0] ?? 0)
    if (fkValue !== 1) {
      throw new Error(`Harness init: PRAGMA foreign_keys expected 1, got ${fkValue}`)
    }
    const integrityResult = await client.execute('PRAGMA integrity_check')
    const integrityValue = String(integrityResult.rows[0]?.[0])
    if (integrityValue !== 'ok') {
      throw new Error(`Harness init: PRAGMA integrity_check failed — ${integrityValue}`)
    }

    // Route production services to this real DB.
    MockMainDbServiceUtils.setDb(db)
    MockMainDbServiceUtils.setIsReady(true)
  })

  beforeEach(async () => {
    if (!db || !client) {
      throw new Error('Test database not initialised — setupTestDatabase() beforeAll did not run')
    }
    await truncateAll(db, client)
  })

  afterAll(async () => {
    try {
      client?.close()
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
    get client(): Client {
      if (!client) {
        throw new Error('setupTestDatabase(): handle.client accessed before beforeAll ran.')
      }
      return client
    }
  }
}
