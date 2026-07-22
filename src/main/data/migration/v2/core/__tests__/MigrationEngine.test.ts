import { miniAppLogoFileRefTable, providerLogoFileRefTable } from '@data/db/schemas/fileRelations'
import { groupTable } from '@data/db/schemas/group'
import { entityTagTable, tagTable } from '@data/db/schemas/tagging'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockMainLoggerService } from '../../../../../../../tests/__mocks__/MainLoggerService'
import { MigrationEngine } from '../MigrationEngine'
import type { MigrationPaths } from '../MigrationPaths'

vi.mock('../MigrationContext', () => ({
  createMigrationContext: vi.fn().mockResolvedValue({})
}))

// Let initialize() run without opening a real SQLite file: a bare fake DB whose
// migration-status read returns no row (so needsMigration hits the fresh-install
// branch we want to exercise).
vi.mock('../MigrationDbService', () => ({
  MigrationDbService: {
    create: () => ({
      getDb: () => ({
        select: () => ({ from: () => ({ where: () => ({ get: () => undefined }) }) })
      }),
      close: () => {}
    })
  }
}))

const mockPaths: MigrationPaths = {
  userData: '/tmp/test-userdata',
  cherryHome: '/tmp/test-cherryhome',
  databaseFile: '/tmp/test-userdata/cherrystudio.sqlite',
  knowledgeBaseDir: '/tmp/test-userdata/Data/KnowledgeBase',
  filesDataDir: '/tmp/test-userdata/Data/Files',
  versionLogFile: '/tmp/test-userdata/version.log',
  legacyAgentDbFile: '/tmp/test-userdata/Data/agents.db',
  agentWorkspacesDir: '/tmp/test-userdata/Data/AgentWorkspaces',
  customMiniAppsFile: '/tmp/test-userdata/Data/Files/custom-minapps.json',
  legacyConfigFile: '/tmp/test-cherryhome/config/config.json',
  migrationsFolder: '/tmp/test-migrations'
}

function createTestMigrator(id: string, order: number, events: string[]) {
  return {
    id,
    name: id,
    description: `${id} migrator`,
    order,
    setProgressCallback: vi.fn(),
    reset: vi.fn(() => {
      events.push(`${id}:reset`)
    }),
    prepare: vi.fn(async () => {
      events.push(`${id}:prepare`)
      return { success: true, itemCount: 0 }
    }),
    execute: vi.fn(async () => {
      events.push(`${id}:execute`)
      return { success: true, processedCount: 0 }
    }),
    validate: vi.fn(async () => {
      events.push(`${id}:validate`)
      return {
        success: true,
        errors: [],
        stats: { sourceCount: 0, targetCount: 0, skippedCount: 0 }
      }
    })
  }
}

describe('MigrationEngine', () => {
  let engine: MigrationEngine

  beforeEach(() => {
    engine = new MigrationEngine()

    ;(engine as any)._paths = mockPaths
    ;(engine as any).migrationDb = {
      getDb: vi.fn(() => ({})),
      close: vi.fn()
    }

    vi.spyOn(engine as any, 'verifyAndClearNewTables').mockResolvedValue(undefined)
    vi.spyOn(engine as any, 'verifyForeignKeys').mockResolvedValue(undefined)
    vi.spyOn(engine as any, 'markCompleted').mockResolvedValue(undefined)
    vi.spyOn(engine as any, 'markFailed').mockResolvedValue(undefined)
    vi.spyOn(engine as any, 'cleanupTempFiles').mockResolvedValue(undefined)
  })

  it('resets every migrator before each run starts', async () => {
    const events: string[] = []
    const boot = createTestMigrator('boot', 1, events)
    const chat = createTestMigrator('chat', 2, events)

    engine.registerMigrators([chat as any, boot as any])

    await engine.run({}, '/tmp/dexie_export', '/tmp/localstorage_export/export.json')
    await engine.run({}, '/tmp/dexie_export', '/tmp/localstorage_export/export.json')

    expect(boot.reset).toHaveBeenCalledTimes(2)
    expect(chat.reset).toHaveBeenCalledTimes(2)
    expect(events).toStrictEqual([
      'boot:reset',
      'chat:reset',
      'boot:prepare',
      'boot:execute',
      'boot:validate',
      'chat:prepare',
      'chat:execute',
      'chat:validate',
      'boot:reset',
      'chat:reset',
      'boot:prepare',
      'boot:execute',
      'boot:validate',
      'chat:prepare',
      'chat:execute',
      'chat:validate'
    ])
  })

  it('aggregates prepare and execute warnings into the migrator result on success', async () => {
    const events: string[] = []
    const migrator = createTestMigrator('knowledge', 1, events)
    migrator.prepare.mockResolvedValueOnce({ success: true, itemCount: 0, warnings: ['prepare warn'] } as any)
    migrator.execute.mockResolvedValueOnce({ success: true, processedCount: 0, warnings: ['execute warn'] } as any)

    engine.registerMigrators([migrator as any])

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result.success).toBe(true)
    expect(result.migratorResults).toHaveLength(1)
    expect(result.migratorResults[0].warnings).toEqual(['prepare warn', 'execute warn'])
  })

  it('omits the warnings field when a migrator reports none', async () => {
    const events: string[] = []
    const migrator = createTestMigrator('clean', 1, events)

    engine.registerMigrators([migrator as any])

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result.migratorResults[0].warnings).toBeUndefined()
  })

  it('preserves the complete failed-run error for diagnostics and clears it before the next run', async () => {
    const errorSpy = vi.spyOn(mockMainLoggerService, 'error').mockImplementation(() => {})
    const events: string[] = []
    const failing = createTestMigrator('failing', 1, events)
    const migrationError = new Error('execute exploded')
    migrationError.stack = 'Error: execute exploded\n    at execute (/app/main.js:42:7)'
    failing.execute.mockRejectedValueOnce(migrationError)

    engine.registerMigrators([failing as any])

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result.success).toBe(false)
    expect(errorSpy).toHaveBeenCalledWith('Migration failed', expect.any(Error))
    const lastCall = errorSpy.mock.calls.at(-1)
    expect(lastCall).toBeDefined()
    expect((lastCall![1] as Error).message).toContain('execute exploded')
    expect(engine.getLastDiagnosticFailure()).toEqual({
      code: 'migration_engine_failed',
      origin: 'main',
      operation: 'run_migration',
      error: {
        name: 'Error',
        message: 'execute exploded',
        stack: 'Error: execute exploded\n    at execute (/app/main.js:42:7)'
      }
    })

    await engine.run({}, '/tmp/dexie_export')
    expect(engine.getLastDiagnosticFailure()).toBeUndefined()

    errorSpy.mockRestore()
  })

  it('keeps the migration failure authoritative when persisting failed status also fails', async () => {
    const errorSpy = vi.spyOn(mockMainLoggerService, 'error').mockImplementation(() => {})
    const events: string[] = []
    const failing = createTestMigrator('failing', 1, events)
    const migrationError = new Error('execute exploded')
    const persistenceError = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' })
    failing.execute.mockRejectedValueOnce(migrationError)
    vi.mocked((engine as any).markFailed).mockRejectedValueOnce(persistenceError)
    engine.registerMigrators([failing as any])

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result).toMatchObject({ success: false, error: 'execute exploded' })
    expect((engine as any).getLastDiagnosticFailure()).toMatchObject({
      code: 'migration_engine_failed',
      origin: 'main',
      operation: 'run_migration',
      error: { message: 'execute exploded' },
      statusPersistenceError: { message: 'database is locked', code: 'SQLITE_BUSY' }
    })
    expect(errorSpy).toHaveBeenCalledWith('Failed to persist migration failure status', persistenceError)
    errorSpy.mockRestore()
  })

  it('aborts the whole migration when validate() reports targetCount below sourceCount minus skippedCount', async () => {
    // The engine reconciliation that KnowledgeVectorMigrator's per-base isolation (C1) depends on:
    // an uncredited shortfall (a base whose rows counted into sourceCount but produced no target
    // units and were NOT added to skippedCount) trips `targetCount < sourceCount - skippedCount`
    // and fails the whole migration.
    const errorSpy = vi.spyOn(mockMainLoggerService, 'error').mockImplementation(() => {})
    const events: string[] = []
    const migrator = createTestMigrator('knowledge_vector', 1, events)
    migrator.validate.mockResolvedValueOnce({
      success: true,
      errors: [],
      stats: { sourceCount: 2, targetCount: 1, skippedCount: 0 }
    } as any)

    engine.registerMigrators([migrator as any])

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result.success).toBe(false)
    expect(result.error).toContain('count mismatch')
    expect((engine as any).markFailed).toHaveBeenCalled()

    errorSpy.mockRestore()
  })

  it('accepts the run when skippedCount credits the shortfall (per-base failure isolation)', async () => {
    // The flip side: crediting the failed base's expected units to skippedCount (what C1 does in
    // the per-base catch) drops expectedCount in lockstep with the missing targetCount, so the same
    // 2-source / 1-target outcome reconciles and the migration succeeds instead of aborting.
    const events: string[] = []
    const migrator = createTestMigrator('knowledge_vector', 1, events)
    migrator.validate.mockResolvedValueOnce({
      success: true,
      errors: [],
      stats: { sourceCount: 2, targetCount: 1, skippedCount: 1 }
    } as any)

    engine.registerMigrators([migrator as any])

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result.success).toBe(true)
    expect((engine as any).markFailed).not.toHaveBeenCalled()
  })

  describe('needsMigration — legacyDataConfirmed flag', () => {
    it('returns true without markCompleted when legacyDataConfirmed is true (no status row)', async () => {
      const freshEngine = new MigrationEngine()
      freshEngine.initialize(mockPaths, true)
      // Isolate the flag: without the OR, an empty electron-store would markCompleted+false.
      vi.spyOn(freshEngine as any, 'hasLegacyData').mockReturnValue(false)
      const markSpy = vi.spyOn(freshEngine as any, 'markCompleted').mockResolvedValue(undefined)

      expect(await freshEngine.needsMigration()).toBe(true)
      expect(markSpy).not.toHaveBeenCalled()
    })

    it('markCompleted + returns false when not legacyDataConfirmed and no legacy data', async () => {
      const freshEngine = new MigrationEngine()
      freshEngine.initialize(mockPaths, false)
      vi.spyOn(freshEngine as any, 'hasLegacyData').mockReturnValue(false)
      const markSpy = vi.spyOn(freshEngine as any, 'markCompleted').mockResolvedValue(undefined)

      expect(await freshEngine.needsMigration()).toBe(false)
      expect(markSpy).toHaveBeenCalledTimes(1)
    })
  })

  it('clears new architecture tables inside one transaction', async () => {
    const runFn = vi.fn()
    const deleteFn = vi.fn(() => ({ run: runFn }))
    const transactionFn = vi.fn((fn: (tx: unknown) => void) => {
      fn({ delete: deleteFn })
    })
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          get: vi.fn(() => ({ count: 0 }))
        }))
      })),
      transaction: transactionFn
    }
    ;(engine as any).migrationDb = {
      getDb: vi.fn(() => db),
      close: vi.fn()
    }
    vi.mocked((engine as any).verifyAndClearNewTables).mockRestore()

    await (engine as any).verifyAndClearNewTables()

    expect(transactionFn).toHaveBeenCalledTimes(1)
    expect(deleteFn).toHaveBeenCalledTimes(db.select.mock.calls.length)
    expect(db).not.toHaveProperty('delete')
  })

  it('includes supporting migration tables in the clear set (retry safety)', async () => {
    // Migration runs with foreign_keys OFF, so clearing owner / file_entry rows does
    // NOT cascade to the logo ref rows — they must be cleared explicitly, else a
    // retry collides with the unique (source_id) index and can never recover.
    const deletedTables: unknown[] = []
    const db = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ get: vi.fn(() => ({ count: 0 })) })) })),
      transaction: vi.fn((fn: (tx: unknown) => void) =>
        fn({
          delete: (table: unknown) => {
            deletedTables.push(table)
            return { run: vi.fn() }
          }
        })
      )
    }
    ;(engine as any).migrationDb = { getDb: vi.fn(() => db), close: vi.fn() }
    vi.mocked((engine as any).verifyAndClearNewTables).mockRestore()

    await (engine as any).verifyAndClearNewTables()

    expect(deletedTables).toContain(providerLogoFileRefTable)
    expect(deletedTables).toContain(miniAppLogoFileRefTable)
    expect(deletedTables).toContain(groupTable)
    expect(deletedTables).toContain(entityTagTable)
    expect(deletedTables).toContain(tagTable)
  })
})
