import { readFileSync } from 'node:fs'

import { setupTestDatabase } from '@test-helpers/db'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import { describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import { checkDatabaseVersion } from '../checkDatabaseVersion'
import type * as DbServiceModule from '../DbService'
import { readAppliedChain } from '../restore/appliedChain'

const { DbService } = await vi.importActual<typeof DbServiceModule>('../DbService')

describe('DbService migration compatibility', () => {
  const dbh = setupTestDatabase()

  it('accepts a database at the bundled version', () => {
    expect(() => checkDatabaseVersion(dbh.sqlite, resolveMigrationsPath())).not.toThrow()
  })

  it('accepts an older database so its remaining migrations can run', () => {
    const latest = readAppliedChain(dbh.sqlite).at(-1)!
    dbh.sqlite.exec('SAVEPOINT older_database')
    try {
      dbh.sqlite.prepare('DELETE FROM __drizzle_migrations WHERE created_at = ?').run(latest.folderMillis)
      expect(() => checkDatabaseVersion(dbh.sqlite, resolveMigrationsPath())).not.toThrow()
    } finally {
      dbh.sqlite.exec('ROLLBACK TO older_database')
      dbh.sqlite.exec('RELEASE older_database')
    }
  })

  it('rejects a database migrated by a newer build before modifying the database', async () => {
    const latest = readAppliedChain(dbh.sqlite).at(-1)!
    const future = latest.folderMillis + 1
    dbh.sqlite
      .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
      .run('future-migration', future)
    const before = readFileSync(dbh.sqlite.name)
    const service = Object.create(DbService.prototype)
    Object.defineProperty(service, 'sqlite', { value: dbh.sqlite })
    Object.defineProperty(service, 'db', { value: dbh.db })
    const getPath = vi.spyOn(application, 'getPath').mockReturnValue(resolveMigrationsPath())
    try {
      const failure = await service._doInit().catch((error: unknown) => error)
      expect(dbh.sqlite.pragma('journal_mode', { simple: true })).toBe('delete')
      expect(readFileSync(dbh.sqlite.name)).toEqual(before)
      expect(failure).toMatchObject({ name: 'DatabaseSchemaTooNewError' })
    } finally {
      getPath.mockRestore()
    }
  })
})
