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
})
