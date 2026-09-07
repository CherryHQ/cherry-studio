import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { appStateTable } from '@data/db/schemas/appState'
import { AppEditionService, appEditionService } from '@data/services/AppEditionService'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MigrationEngine } from '../MigrationEngine'

vi.mock('@main/utils/appEdition', () => ({ getPackageEdition: () => 'cn' }))
vi.mock('@main/data/bootConfig', () => ({ bootConfigService: { set: vi.fn(), persist: vi.fn() } }))
vi.mock('../MigrationContext', () => ({ createMigrationContext: vi.fn(async () => ({})) }))

describe('migration edition identity', () => {
  const dbh = setupTestDatabase()
  let engine: MigrationEngine
  let versionLogFile: string

  beforeEach(async () => {
    versionLogFile = path.join(path.dirname(dbh.sqlite.name), 'version.log')
    await rm(versionLogFile, { force: true })
    engine = new MigrationEngine()
    Object.assign(engine, {
      migrationDb: { getDb: () => dbh.db },
      _paths: { versionLogFile, migrationTempDir: path.join(path.dirname(dbh.sqlite.name), 'migration_temp') }
    })
  })

  function completedStatus() {
    dbh.db
      .insert(appStateTable)
      .values({
        key: 'migration_v2_status',
        value: { status: 'completed', version: '2.0.0', completedAt: 1 }
      })
      .run()
  }

  it('persists global identity after successful migration even under a China package', async () => {
    expect((await engine.run({}, '/unused')).success).toBe(true)
    expect(new AppEditionService().getEdition()).toBe('global')
    expect(await engine.needsMigration()).toBe(false)
    expect(new AppEditionService().getEdition()).toBe('global')
  })

  it('keeps a fresh China install in China after the migration gate marks it completed', async () => {
    vi.spyOn(engine as unknown as { hasLegacyData(): boolean }, 'hasLegacyData').mockReturnValue(false)
    expect(await engine.needsMigration()).toBe(false)
    expect(appEditionService.getMigrationOrigin(dbh.db)).toBe(false)
    expect(new AppEditionService().getEdition()).toBe('cn')
  })

  it('does not grant global identity when migration fails', async () => {
    vi.spyOn(engine as unknown as { verifyForeignKeys(): void }, 'verifyForeignKeys').mockImplementation(() => {
      throw new Error('invalid references')
    })
    expect((await engine.run({}, '/unused')).success).toBe(false)
    expect(new AppEditionService().getEdition()).toBe('cn')
    expect(await engine.needsMigration()).toBe(true)
  })

  it('records an explicit skip so old v1 history cannot turn it into a migration later', async () => {
    await writeFile(versionLogFile, '1.9.12|mac|prod|packaged|install|2026-08-01T00:00:00Z\n')
    await engine.skipMigration()
    expect(await engine.needsMigration()).toBe(false)
    expect(new AppEditionService().getEdition()).toBe('cn')
  })

  it.each([
    [
      '1.9.12|mac|prod|packaged|install|2026-08-01T00:00:00Z\n2.0.12|mac|prod|packaged|install|2026-09-01T00:00:00Z',
      'global'
    ],
    ['2.0.0-rc.1|mac|prod|packaged|install|2026-08-01T00:00:00Z', 'cn'],
    ['1.9.12 invalid record', 'cn'],
    ['', 'cn']
  ])('backfills old completed installs using valid v1 history: %s', async (history, edition) => {
    completedStatus()
    if (history) await writeFile(versionLogFile, history)
    expect(await engine.needsMigration()).toBe(false)
    expect(new AppEditionService().getEdition()).toBe(edition)
    await rm(versionLogFile, { force: true })
    expect(await engine.needsMigration()).toBe(false)
    expect(new AppEditionService().getEdition()).toBe(edition)
  })

  it('rolls back migration completion if persisting the edition fails', async () => {
    vi.spyOn(appEditionService, 'recordMigrationOrigin').mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    expect((await engine.run({}, '/unused')).success).toBe(false)
    const row = dbh.db.select().from(appStateTable).where(eq(appStateTable.key, 'migration_v2_status')).get()
    expect(row?.value).toMatchObject({ status: 'failed' })
    expect(new AppEditionService().getEdition()).toBe('cn')
  })

  it('keeps an established global identity through a later skip', async () => {
    expect((await engine.run({}, '/unused')).success).toBe(true)
    await engine.skipMigration()
    expect(new AppEditionService().getEdition()).toBe('global')
  })
})
