import type { MigrationStatusValue } from '@shared/data/migration/v2/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    vi.spyOn(engine as any, 'markAgentsCompleted').mockResolvedValue(undefined)
    vi.spyOn(engine as any, 'markAgentsFailed').mockResolvedValue(undefined)
    vi.spyOn(engine as any, 'cleanupTempFiles').mockResolvedValue(undefined)
  })

  function mockStatuses(fullStatus?: MigrationStatusValue, agentsStatus?: MigrationStatusValue) {
    const get = vi.fn<() => Promise<{ value: MigrationStatusValue } | undefined>>().mockResolvedValue(undefined)
    get.mockResolvedValueOnce(fullStatus ? { value: fullStatus } : undefined)
    get.mockResolvedValueOnce(agentsStatus ? { value: agentsStatus } : undefined)

    ;(engine as any).migrationDb = {
      getDb: vi.fn(() => ({
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({ get }))
          }))
        }))
      })),
      close: vi.fn()
    }
    return { get }
  }

  it('resets every migrator before each run starts', async () => {
    const events: string[] = []
    const boot = createTestMigrator('boot', 1, events)
    const chat = createTestMigrator('chat', 2, events)

    engine.registerMigrators([chat as any, boot as any])
    vi.spyOn(engine as any, 'getPendingMigrationPlan').mockResolvedValue({
      fullMigrationNeeded: true,
      agentsMigrationNeeded: false,
      migrators: [boot, chat]
    })

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

  it('requires migration again when core v2 is complete but agents import is still pending', async () => {
    mockStatuses({ status: 'completed', version: '2.0.0', completedAt: Date.now(), error: null }, undefined)
    vi.spyOn(engine as any, 'hasCoreLegacyData').mockReturnValue(false)
    vi.spyOn(engine as any, 'hasLegacyAgentsData').mockReturnValue(true)

    await expect(engine.needsMigration()).resolves.toBe(true)
  })

  it('marks agents import as completed when no legacy agents db exists anymore', async () => {
    mockStatuses({ status: 'completed', version: '2.0.0', completedAt: Date.now(), error: null }, undefined)
    vi.spyOn(engine as any, 'hasCoreLegacyData').mockReturnValue(false)
    vi.spyOn(engine as any, 'hasLegacyAgentsData').mockReturnValue(false)

    await expect(engine.needsMigration()).resolves.toBe(false)
    expect((engine as any).markAgentsCompleted).toHaveBeenCalledTimes(1)
  })

  it('skips migration when both core v2 and agents import are already completed', async () => {
    mockStatuses(
      { status: 'completed', version: '2.0.0', completedAt: Date.now(), error: null },
      { status: 'completed', version: '2.1.0-agents', completedAt: Date.now(), error: null }
    )
    vi.spyOn(engine as any, 'hasCoreLegacyData').mockReturnValue(false)
    vi.spyOn(engine as any, 'hasLegacyAgentsData').mockReturnValue(false)

    await expect(engine.needsMigration()).resolves.toBe(false)
  })

  it('runs only the agents migrator and clears only agents tables for an agents-only migration', async () => {
    const events: string[] = []
    const boot = createTestMigrator('boot', 1, events)
    const agents = createTestMigrator('agents', 2.5, events)

    engine.registerMigrators([boot as any, agents as any])

    vi.spyOn(engine as any, 'getPendingMigrationPlan').mockResolvedValue({
      fullMigrationNeeded: false,
      agentsMigrationNeeded: true,
      migrators: [agents]
    })
    const clearAgentsTables = vi.spyOn(engine as any, 'verifyAndClearAgentsTables').mockResolvedValue(undefined)

    await engine.run({}, '/tmp/dexie_export', '/tmp/localstorage_export/export.json')

    expect(clearAgentsTables).toHaveBeenCalledTimes(1)
    expect((engine as any).verifyAndClearNewTables).not.toHaveBeenCalled()
    expect(events).toStrictEqual(['agents:reset', 'agents:prepare', 'agents:execute', 'agents:validate'])
  })

  it('marks both core and agents migration as completed when the user skips migration', async () => {
    await engine.skipMigration()

    expect((engine as any).markCompleted).toHaveBeenCalledTimes(1)
    expect((engine as any).markAgentsCompleted).toHaveBeenCalledTimes(1)
  })
})
