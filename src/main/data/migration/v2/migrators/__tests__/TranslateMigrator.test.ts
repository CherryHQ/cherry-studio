import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it, vi } from 'vitest'

import type { MigrationContext } from '../../core/MigrationContext'
import { TranslateMigrator } from '../TranslateMigrator'

function createMigrationRun(db: MigrationContext['db'], historyRows: readonly unknown[]): MigrationContext {
  return {
    sources: {
      dexieExport: {
        tableExists: vi.fn(async (table: string) => table === 'translate_history'),
        readTable: vi.fn(async () => historyRows)
      }
    },
    db,
    sharedData: new Map(),
    paths: {} as MigrationContext['paths'],
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    diagnostics: { recordEvent: vi.fn() }
  } as unknown as MigrationContext
}

describe('TranslateMigrator', () => {
  const dbh = setupTestDatabase()

  it('records bounded translation lengths when SQLite rejects an oversized history batch', async () => {
    const canary = `PRIVATE_TRANSLATION_TEXT_${'x'.repeat(90_000)}`
    const sqliteError = Object.assign(new Error('PRIVATE_STACK_/Users/alice'), { code: 'SQLITE_TOOBIG' })
    const db = new Proxy(dbh.db, {
      get(target, property) {
        if (property === 'transaction') {
          return (operation: (tx: unknown) => void) =>
            operation({
              insert: () => ({
                values: () => ({
                  run: () => {
                    throw sqliteError
                  }
                })
              })
            })
        }
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      }
    })
    const migrationRun = createMigrationRun(db, [
      {
        id: 'oversized',
        sourceText: canary,
        targetText: 'translated',
        sourceLanguage: 'en-us',
        targetLanguage: 'zh-cn',
        createdAt: '2024-01-01T00:00:00.000Z'
      }
    ])
    const migrator = new TranslateMigrator()
    await migrator.prepare(migrationRun)

    const result = await migrator.execute(migrationRun)

    expect(result.success).toBe(false)
    expect(migrationRun.diagnostics.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'sqlite_too_big',
        migratorId: 'translate',
        payloadProfile: expect.objectContaining({
          target: 'translate_history',
          slots: expect.arrayContaining([expect.objectContaining({ slot: 'sourceText', kind: 'string' })])
        })
      })
    )
    expect(JSON.stringify((migrationRun.diagnostics.recordEvent as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(
      'PRIVATE_TRANSLATION_TEXT'
    )
    expect(JSON.stringify((migrationRun.diagnostics.recordEvent as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(
      '/Users/alice'
    )
  })
})
