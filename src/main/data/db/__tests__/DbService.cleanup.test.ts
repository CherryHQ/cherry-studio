import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import type * as DbServiceModule from '@data/db/DbService'
import { MigrationDbService } from '@data/migration/v2/core/MigrationDbService'
import type { MigrationPaths } from '@data/migration/v2/core/MigrationPaths'
import { BaseService } from '@main/core/lifecycle'

const { DbService } = await vi.importActual<typeof DbServiceModule>('@data/db/DbService')

describe('database connection cleanup', () => {
  const dbh = setupTestDatabase()
  afterEach(() => {
    vi.restoreAllMocks()
    BaseService.resetInstances()
  })

  function migrationPaths(): MigrationPaths {
    return {
      databaseFile: dbh.sqlite.name,
      migrationsFolder: path.resolve('migrations/sqlite-drizzle')
    } as MigrationPaths
  }

  it('closes the runtime connection after lifecycle destruction', async () => {
    vi.spyOn(application, 'getPath').mockImplementation((key) => {
      if (key === 'app.database.file') return dbh.sqlite.name
      if (key === 'app.database.migrations') return path.resolve('migrations/sqlite-drizzle')
      throw new Error(`Unexpected path ${key}`)
    })
    const service = new DbService()
    const connection = service['sqlite']
    expect(connection.open).toBe(true)
    await service._doDestroy()
    expect(connection.open).toBe(false)
    expect(dbh.sqlite.pragma('integrity_check', { simple: true })).toBe('ok')
    await service._doDestroy()
  })

  it('releases the migration connection on a WAL I/O error before applying any schema changes', () => {
    const error = Object.assign(new Error('disk I/O error'), { code: 'SQLITE_IOERR_TRUNCATE' })
    const failedConnections: Database.Database[] = []
    const original = Database.prototype.pragma
    vi.spyOn(Database.prototype, 'pragma').mockImplementation(function (this: Database.Database, source, options) {
      if (source === 'journal_mode = WAL' && this !== dbh.sqlite) {
        failedConnections.push(this)
        throw error
      }
      return original.call(this, source, options)
    })
    const before = dbh.sqlite.prepare('SELECT * FROM __drizzle_migrations').all()
    expect(() => MigrationDbService.create(migrationPaths())).toThrow('Migration database initialization failed')
    expect(failedConnections[0]?.open).toBe(false)
    expect(dbh.sqlite.prepare('SELECT * FROM __drizzle_migrations').all()).toEqual(before)
    expect(dbh.sqlite.pragma('integrity_check', { simple: true })).toBe('ok')
  })

  it('preserves the database after a real lock conflict and succeeds once the writer exits', () => {
    dbh.sqlite.pragma('journal_mode = WAL')
    dbh.sqlite.exec('BEGIN IMMEDIATE')
    const original = Database.prototype.pragma
    vi.spyOn(Database.prototype, 'pragma').mockImplementation(function (this: Database.Database, source, options) {
      if (this !== dbh.sqlite) original.call(this, 'busy_timeout = 0')
      return original.call(this, source, options)
    })
    try {
      expect(() => MigrationDbService.create(migrationPaths())).toThrow()
    } finally {
      dbh.sqlite.exec('ROLLBACK')
    }
    const connection = MigrationDbService.create(migrationPaths())
    connection.close()
    expect(dbh.sqlite.pragma('integrity_check', { simple: true })).toBe('ok')
  })

  it('releases the runtime connection when initialization fails', () => {
    vi.spyOn(application, 'getPath').mockImplementation(() => dbh.sqlite.name)
    const service = new DbService()
    const connection = service['sqlite']
    const error = Object.assign(new Error('disk I/O error'), { code: 'SQLITE_IOERR_TRUNCATE' })
    vi.spyOn(connection, 'pragma').mockImplementation(() => {
      throw error
    })
    expect(() => service['onInit']()).toThrow(error)
    expect(connection.open).toBe(false)
  })
})
