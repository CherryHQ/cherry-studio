import { translateHistoryTable } from '@data/db/schemas/translateHistory'
import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MigrationContext } from '../../core/MigrationContext'
import { TranslateMigrator } from '../TranslateMigrator'

describe('TranslateMigrator streaming', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('counts in prepare and inserts history in bounded execute batches', async () => {
    const history = Array.from({ length: 205 }, (_, index) => ({
      id: `history-${index}`,
      sourceText: `source-${index}`,
      targetText: `target-${index}`,
      sourceLanguage: 'en-us',
      targetLanguage: 'zh-cn',
      createdAt: '2025-01-01T00:00:00.000Z'
    }))
    const readInBatches = vi.fn(async (batchSize: number, onBatch: (rows: typeof history) => Promise<void>) => {
      for (let offset = 0; offset < history.length; offset += batchSize) {
        await onBatch(history.slice(offset, offset + batchSize))
      }
      return history.length
    })
    const readTable = vi.fn()
    const ctx = {
      db: dbh.db,
      sources: {
        dexieExport: {
          tableExists: vi.fn(async (name: string) => name === 'translate_history'),
          createStreamReader: vi.fn(() => ({ count: vi.fn(async () => history.length), readInBatches })),
          readTable
        }
      }
    } as unknown as MigrationContext

    const migrator = new TranslateMigrator()
    expect(await migrator.prepare(ctx)).toMatchObject({ success: true, itemCount: 205 })
    expect(readTable).not.toHaveBeenCalled()

    expect(await migrator.execute(ctx)).toMatchObject({ success: true, processedCount: 205 })
    expect(readInBatches).toHaveBeenCalledWith(100, expect.any(Function))
    expect(dbh.db.select().from(translateHistoryTable).all()).toHaveLength(205)
  })
})
