import type { MigrationStatusValue } from '@shared/data/migration/v2/types'
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

  function mockStatus(statusValue?: MigrationStatusValue) {
    const get = vi.fn().mockResolvedValue(statusValue ? { value: statusValue } : undefined)
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

  it('requires migration again when the stored completed version is outdated and legacy data exists', async () => {
    mockStatus({ status: 'completed', version: '2.0.0', completedAt: Date.now(), error: null })
    vi.spyOn(engine as any, 'hasLegacyData').mockReturnValue(true)

    await expect(engine.needsMigration()).resolves.toBe(true)
  })

  it('marks the new target version as completed when no legacy data exists anymore', async () => {
    mockStatus({ status: 'completed', version: '2.0.0', completedAt: Date.now(), error: null })
    vi.spyOn(engine as any, 'hasLegacyData').mockReturnValue(false)

    await expect(engine.needsMigration()).resolves.toBe(false)
    expect((engine as any).markCompleted).toHaveBeenCalledTimes(1)
  })

  it('skips migration when the stored completed version matches the current target', async () => {
    mockStatus({ status: 'completed', version: '2.1.0', completedAt: Date.now(), error: null })

    await expect(engine.needsMigration()).resolves.toBe(false)
  })
})
