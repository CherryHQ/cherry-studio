import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockMainLoggerService } from '../../../../../../../tests/__mocks__/MainLoggerService'
import { MigrationEngine } from '../MigrationEngine'
import type { MigrationPaths } from '../MigrationPaths'

vi.mock('../MigrationContext', () => ({
  createMigrationContext: vi.fn().mockResolvedValue({})
}))

const mockPaths: MigrationPaths = {
  userData: '/tmp/test-userdata',
  cherryHome: '/tmp/test-cherryhome',
  databaseFile: '/tmp/test-userdata/cherrystudio.sqlite',
  knowledgeBaseDir: '/tmp/test-userdata/Data/KnowledgeBase',
  versionLogFile: '/tmp/test-userdata/version.log',
  legacyAgentDbFile: '/tmp/test-userdata/Data/agents.db',
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

  it('logs failed runs with an Error object so stack/cause are preserved', async () => {
    const errorSpy = vi.spyOn(mockMainLoggerService, 'error').mockImplementation(() => {})
    const events: string[] = []
    const failing = createTestMigrator('failing', 1, events)
    failing.execute.mockResolvedValueOnce({ success: false, processedCount: 0, error: 'execute exploded' } as any)

    engine.registerMigrators([failing as any])

    const result = await engine.run({}, '/tmp/dexie_export')

    expect(result.success).toBe(false)
    expect(errorSpy).toHaveBeenCalledWith('Migration failed', expect.any(Error))
    const lastCall = errorSpy.mock.calls.at(-1)
    expect(lastCall).toBeDefined()
    expect((lastCall![1] as Error).message).toContain('execute exploded')

    errorSpy.mockRestore()
  })

  it('clears new architecture tables inside one transaction', async () => {
    const deleteFn = vi.fn().mockResolvedValue(undefined)
    const transactionFn = vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({ delete: deleteFn })
    })
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({ count: 0 })
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
    expect(deleteFn).toHaveBeenCalledTimes(25)
    expect(db).not.toHaveProperty('delete')
  })
})
