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
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
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

    const diagnosed = await migrator.executeWithDiagnostics(migrationRun)

    expect(diagnosed.result.success).toBe(false)
    expect(diagnosed.failure).toMatchObject({
      classification: { errorCode: 'sqlite_too_big' },
      evidence: {
        kind: 'failed_write',
        values: expect.arrayContaining([expect.objectContaining({ role: 'text_value', kind: 'string' })])
      }
    })
    expect(JSON.stringify(diagnosed.failure)).not.toContain('PRIVATE_TRANSLATION_TEXT')
    expect(JSON.stringify(diagnosed.failure)).not.toContain('/Users/alice')
  })
})
