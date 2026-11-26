import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import { describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { FatalStartupError } from '@main/core/lifecycle'

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
      expect(failure).toBeInstanceOf(FatalStartupError)
    } finally {
      getPath.mockRestore()
    }
  })
})

describe('DbService with an inverted migration timestamp', () => {
  const migrations = resolveMigrationsPath()
  const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8')) as {
    entries: Array<{ tag: string; when: number }>
  }
  const previous = journal.entries.at(-2)!
  const dbh = setupTestDatabase({ beforeMigration: previous.tag })

  it('migrates and reopens its own database but rejects a genuinely newer schema without writing', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'cs-inverted-migrations-'))
    cpSync(migrations, fixture, { recursive: true })
    journal.entries.at(-1)!.when = previous.when - 1
    writeFileSync(join(fixture, 'meta/_journal.json'), JSON.stringify(journal))
    const originalGetPath = vi.mocked(application.getPath).getMockImplementation()!
    const getPath = vi.spyOn(application, 'getPath').mockImplementation((key, filename) => {
      if (key === 'app.database.migrations') return fixture
      if (key === 'feature.provider_registry.data') return resolve('packages/provider-registry/data', filename ?? '')
      if (key === 'feature.agents.builtin') return resolve('resources/builtin-agents', filename ?? '')
      return originalGetPath(key, filename)
    })
    const service = () => {
      const instance = Object.create(DbService.prototype)
      Object.defineProperty(instance, 'sqlite', { value: dbh.sqlite })
      Object.defineProperty(instance, 'db', { value: dbh.db })
      return instance as InstanceType<typeof DbService>
    }
    try {
      await service()._doInit()
      const applied = readAppliedChain(dbh.sqlite)
      expect(applied).toHaveLength(journal.entries.length)
      expect(applied.slice(-2).map((entry) => entry.folderMillis)).toEqual([previous.when - 1, previous.when])
      expect(dbh.sqlite.prepare('PRAGMA table_info(mcp_server)').all()).toContainEqual(
        expect.objectContaining({ name: 'skill_permissions' })
      )

      await expect(service()._doInit()).resolves.toBeUndefined()
      expect(readAppliedChain(dbh.sqlite)).toEqual(applied)
      expect(dbh.sqlite.pragma('integrity_check', { simple: true })).toBe('ok')

      dbh.sqlite
        .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
        .run('future-migration', previous.when + 1)
      dbh.sqlite.pragma('wal_checkpoint(TRUNCATE)')
      dbh.sqlite.pragma('journal_mode = DELETE')
      const before = readFileSync(dbh.sqlite.name)
      await expect(service()._doInit()).rejects.toMatchObject({ name: 'DatabaseSchemaTooNewError' })
      expect(dbh.sqlite.pragma('journal_mode', { simple: true })).toBe('delete')
      expect(readFileSync(dbh.sqlite.name)).toEqual(before)
    } finally {
      getPath.mockRestore()
      rmSync(fixture, { recursive: true, force: true })
    }
  })
})
