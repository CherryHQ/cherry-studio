/**
 * skipMigration() against a real database.
 *
 * Migration is not one big transaction, so a failed run leaves committed
 * migrator data behind. Skipping must clear everything migration wrote (shared
 * definition with the pre-run retry wipe), restore the migrated boot key, and
 * flip the status to completed atomically — or leave everything untouched.
 */
import { appStateTable } from '@data/db/schemas/appState'
import { jobScheduleTable } from '@data/db/schemas/job'
import { preferenceTable } from '@data/db/schemas/preference'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { bootConfigService } from '@main/data/bootConfig'
import type { MigrationStatusValue } from '@shared/data/migration/v2/types'

import { MigrationEngine } from '../MigrationEngine'

vi.mock('@main/data/bootConfig', () => ({
  bootConfigService: {
    set: vi.fn(),
    persist: vi.fn()
  }
}))

const MIGRATION_V2_STATUS = 'migration_v2_status'

const failedStatus: MigrationStatusValue = {
  status: 'failed',
  failedAt: 1,
  version: '2.0.0',
  error: 'ChatMigrator execute failed'
}

describe('MigrationEngine.skipMigration', () => {
  const dbh = setupTestDatabase()
  let engine: MigrationEngine

  beforeEach(() => {
    vi.clearAllMocks()
    engine = new MigrationEngine()
    ;(engine as any).migrationDb = { getDb: () => dbh.db, close: vi.fn() }
  })

  /** Rows a partially-failed run would leave behind: business data + schedules. */
  function seedMigratedData() {
    dbh.db.insert(preferenceTable).values({ key: 'ui.theme', value: 'dark' }).run()
    dbh.db
      .insert(jobScheduleTable)
      .values([
        {
          type: 'agent.task',
          name: 'daily-report',
          trigger: { kind: 'once', at: 0 },
          jobInputTemplate: {},
          catchUpPolicy: { kind: 'skip-missed' }
        },
        {
          type: 'other.job',
          name: 'keep-me',
          trigger: { kind: 'once', at: 0 },
          jobInputTemplate: {},
          catchUpPolicy: { kind: 'skip-missed' }
        }
      ])
      .run()
  }

  function readStatus(): MigrationStatusValue | undefined {
    const row = dbh.db.select().from(appStateTable).where(eq(appStateTable.key, MIGRATION_V2_STATUS)).get()
    return row?.value as MigrationStatusValue | undefined
  }

  it('clears migrated rows and agent.task schedules, keeps other schedules, and marks completed', async () => {
    seedMigratedData()

    await engine.skipMigration()

    expect(dbh.db.select().from(preferenceTable).all()).toHaveLength(0)
    const schedules = dbh.db.select().from(jobScheduleTable).all()
    expect(schedules.map((s) => s.type)).toEqual(['other.job'])
    expect(readStatus()).toMatchObject({ status: 'completed', error: null })
  })

  it('restores hardware acceleration to its default and never touches user_data_path', async () => {
    await engine.skipMigration()

    expect(bootConfigService.set).toHaveBeenCalledWith('app.disable_hardware_acceleration', false)
    expect(bootConfigService.persist).toHaveBeenCalledTimes(1)
    const touchedKeys = vi.mocked(bootConfigService.set).mock.calls.map(([key]) => key)
    expect(touchedKeys).not.toContain('app.user_data_path')
  })

  it('leaves the database untouched when the boot config write fails', async () => {
    seedMigratedData()
    dbh.db.insert(appStateTable).values({ key: MIGRATION_V2_STATUS, value: failedStatus }).run()
    vi.mocked(bootConfigService.persist).mockImplementationOnce(() => {
      throw new Error('disk full')
    })

    await expect(engine.skipMigration()).rejects.toThrow('disk full')

    expect(dbh.db.select().from(preferenceTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(jobScheduleTable).all()).toHaveLength(2)
    expect(readStatus()).toMatchObject({ status: 'failed' })
  })

  it('rolls back all clears when the status write fails mid-transaction', async () => {
    seedMigratedData()
    // The status upsert is the last statement in the transaction — sabotaging it
    // proves the preceding deletes ran and were rolled back with it.
    dbh.sqlite.exec(
      `CREATE TRIGGER skip_sabotage BEFORE INSERT ON app_state BEGIN SELECT RAISE(ABORT, 'sabotage'); END`
    )

    try {
      await expect(engine.skipMigration()).rejects.toThrow('sabotage')

      expect(dbh.db.select().from(preferenceTable).all()).toHaveLength(1)
      expect(dbh.db.select().from(jobScheduleTable).all()).toHaveLength(2)
      expect(readStatus()).toBeUndefined()
    } finally {
      dbh.sqlite.exec('DROP TRIGGER skip_sabotage')
    }
  })

  it('shares one cleanup definition with the pre-run retry wipe', async () => {
    seedMigratedData()

    ;(engine as any).verifyAndClearNewTables()

    expect(dbh.db.select().from(preferenceTable).all()).toHaveLength(0)
    const schedules = dbh.db.select().from(jobScheduleTable).all()
    expect(schedules.map((s) => s.type)).toEqual(['other.job'])
  })
})
