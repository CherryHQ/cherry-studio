import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Migration completion status and skipMigration() against a real database.
 *
 * Migration is not one big transaction, so a failed run leaves committed
 * migrator data behind. Skipping must clear everything migration wrote (shared
 * definition with the pre-run retry wipe), restore the migrated boot key, and
 * flip the status to completed atomically — or leave everything untouched.
 */
import { appStateTable } from '@data/db/schemas/appState'
import { agentSessionMessageFileRefTable } from '@data/db/schemas/fileRelations'
import { jobScheduleTable } from '@data/db/schemas/job'
import { preferenceTable } from '@data/db/schemas/preference'
import { bootConfigService } from '@main/data/bootConfig'
import type { MigrationStatusValue } from '@shared/data/migration/v2/types'

import { MigrationEngine } from '../MigrationEngine'

vi.mock('@main/data/bootConfig', () => ({
  bootConfigService: {
    set: vi.fn(),
    persist: vi.fn()
  }
}))

vi.mock('../MigrationContext', () => ({
  createMigrationContext: vi.fn().mockResolvedValue({})
}))

const MIGRATION_V2_STATUS = 'migration_v2_status'

const failedStatus: MigrationStatusValue = {
  status: 'failed',
  failedAt: 1,
  version: '2.0.0',
  error: 'ChatMigrator execute failed'
}

describe('MigrationEngine migration status and skipMigration', () => {
  const dbh = setupTestDatabase()
  let engine: MigrationEngine

  beforeEach(() => {
    vi.clearAllMocks()
    engine = new MigrationEngine()
    ;(engine as any)._paths = { migrationDexieExportDir: '/tmp/cherry-migration-test' }
    ;(engine as any).migrationDb = { getDb: () => dbh.db, close: vi.fn() }
    vi.spyOn(engine as any, 'cleanupTempFiles').mockResolvedValue(undefined)
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

  it('records a fresh install as not migrated from v1', async () => {
    vi.spyOn(engine as any, 'hasLegacyData').mockReturnValue(false)

    await expect(engine.needsMigration()).resolves.toBe(false)

    expect(readStatus()).toMatchObject({ status: 'completed', migratedFromV1: false })
    expect(engine.isMigratedFromV1()).toBe(false)
  })

  it('records a successful migration as migrated from v1', async () => {
    await expect(engine.run({}, '/tmp/cherry-migration-test')).resolves.toMatchObject({ success: true })

    expect(readStatus()).toMatchObject({ status: 'completed', migratedFromV1: true })
    expect(engine.isMigratedFromV1()).toBe(true)
  })

  it('restores the v1 migration origin from a completed status', async () => {
    dbh.db
      .insert(appStateTable)
      .values({
        key: MIGRATION_V2_STATUS,
        value: { status: 'completed', migratedFromV1: true, version: '2.0.0' } satisfies MigrationStatusValue
      })
      .run()

    await expect(engine.needsMigration()).resolves.toBe(false)

    expect(engine.isMigratedFromV1()).toBe(true)
  })

  it('does not record a failed migration as migrated from v1', async () => {
    engine.registerMigrators([
      {
        id: 'failing',
        name: 'failing',
        order: 1,
        reset: vi.fn(),
        setProgressCallback: vi.fn(),
        prepare: vi.fn().mockResolvedValue({ success: true, itemCount: 1 }),
        execute: vi.fn().mockResolvedValue({ success: false, processedCount: 0, error: 'failed' })
      } as any
    ])

    await expect(engine.run({}, '/tmp/cherry-migration-test')).resolves.toMatchObject({ success: false })

    expect(readStatus()).toMatchObject({ status: 'failed', migratedFromV1: false })
    expect(engine.isMigratedFromV1()).toBe(false)
  })

  it('clears migrated rows and agent.task schedules, keeps other schedules, and marks completed', async () => {
    seedMigratedData()

    await engine.skipMigration()

    expect(dbh.db.select().from(preferenceTable).all()).toHaveLength(0)
    const schedules = dbh.db.select().from(jobScheduleTable).all()
    expect(schedules.map((s) => s.type)).toEqual(['other.job'])
    expect(readStatus()).toMatchObject({ status: 'completed', migratedFromV1: false, error: null })
    expect(engine.isMigratedFromV1()).toBe(false)
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

  it('clears dangling Agent attachment refs during retry while migration foreign keys are disabled', () => {
    dbh.sqlite.pragma('foreign_keys = OFF')

    try {
      dbh.db
        .insert(agentSessionMessageFileRefTable)
        .values({ id: 'ref-1', fileEntryId: 'missing-file', sourceId: 'missing-message', role: 'attachment' })
        .run()
      expect(dbh.sqlite.pragma('foreign_key_check')).toHaveLength(2)

      ;(engine as any).verifyAndClearNewTables()

      expect(dbh.db.select().from(agentSessionMessageFileRefTable).all()).toHaveLength(0)
      expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
    } finally {
      dbh.sqlite.pragma('foreign_keys = ON')
    }
  })
})
