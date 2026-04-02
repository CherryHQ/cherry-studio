import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MigrationEngine } from '../MigrationEngine'

vi.mock('../MigrationContext', () => ({
  createMigrationContext: vi.fn().mockResolvedValue({})
}))

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
