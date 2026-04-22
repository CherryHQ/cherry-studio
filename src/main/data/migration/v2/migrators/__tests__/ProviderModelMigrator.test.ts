import { pinTable } from '@data/db/schemas/pin'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MigrationContext } from '../../core/MigrationContext'
import { ProviderModelMigrator } from '../ProviderModelMigrator'

const { loggerWarnMock } = vi.hoisted(() => ({
  loggerWarnMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: vi.fn(),
      warn: loggerWarnMock,
      error: vi.fn(),
      debug: vi.fn()
    }))
  }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

interface MockContextOptions {
  failOnPinInsert?: boolean
}

function createMockContext(
  reduxState: Record<string, unknown> = {},
  sourceData: Record<string, unknown> = {},
  options: MockContextOptions = {}
): MigrationContext {
  const insertValues: unknown[][] = []
  let stagedInsertValues: unknown[][] = []
  const flattenInsertedRows = () =>
    insertValues
      .flatMap((batch) => batch)
      .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
  const getInsertedProviders = () =>
    flattenInsertedRows().filter((row) => Object.hasOwn(row, 'providerId') && !Object.hasOwn(row, 'modelId'))
  const getInsertedModels = () => flattenInsertedRows().filter((row) => Object.hasOwn(row, 'modelId'))
  const getInsertedPins = () => flattenInsertedRows().filter((row) => row.entityType === 'model')

  const mockTx = {
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((vals: unknown) => {
        const rows = Array.isArray(vals) ? vals : [vals]
        if (options.failOnPinInsert && table === pinTable) {
          throw new Error('pin insert failed')
        }
        stagedInsertValues.push(rows)
        return {
          onConflictDoNothing: vi.fn(() => Promise.resolve())
        }
      })
    }))
  }

  return {
    sources: {
      reduxState: {
        getCategory: vi.fn((cat: string) => reduxState[cat])
      },
      dexieSettings: {
        get: vi.fn((key: string) => sourceData[key])
      },
      dexieExport: {
        tableExists: vi.fn((table: string) =>
          Promise.resolve(Array.isArray(sourceData[table]))
        ),
        createStreamReader: vi.fn((table: string) => ({
          readInBatches: vi.fn(
            async (batchSize: number, callback: (items: unknown[], index: number) => Promise<void>) => {
              const rows = Array.isArray(sourceData[table]) ? sourceData[table] : []
              const safeBatchSize = Math.max(batchSize, 1)

              for (let index = 0; index < rows.length; index += safeBatchSize) {
                await callback(rows.slice(index, index + safeBatchSize), index / safeBatchSize)
              }
            }
          )
        }))
      }
    },
    db: {
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        stagedInsertValues = []
        const result = await fn(mockTx)
        insertValues.push(...stagedInsertValues)
        return result
      }),
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => ({
          get: vi.fn(() =>
            Promise.resolve({
              count:
                table === userProviderTable
                  ? getInsertedProviders().length
                  : table === pinTable
                    ? getInsertedPins().length
                    : getInsertedModels().length
            })
          ),
          limit: vi.fn(() => ({
            all: vi.fn(() => Promise.resolve(table === userProviderTable ? getInsertedProviders().slice(0, 5) : []))
          }))
        }))
      }))
    },
    _insertValues: insertValues
  } as unknown as MigrationContext & { _insertValues: unknown[][] }
}

function makeProvider(id: string, models: Array<{ id: string }> = []) {
  return {
    id,
    name: `Provider ${id}`,
    type: 'openai',
    enabled: true,
    models
  }
}

describe('ProviderModelMigrator', () => {
  let migrator: ProviderModelMigrator

  beforeEach(() => {
    migrator = new ProviderModelMigrator()
    loggerWarnMock.mockClear()
  })

  describe('prepare', () => {
    it('returns success with provider count', async () => {
      const ctx = createMockContext({
        llm: {
          providers: [makeProvider('openai'), makeProvider('anthropic')]
        }
      })

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(2)
    })

    it('handles missing providers gracefully', async () => {
      const ctx = createMockContext({ llm: {} })

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(0)
    })

    it('deduplicates providers by ID', async () => {
      const ctx = createMockContext({
        llm: {
          providers: [makeProvider('openai'), makeProvider('openai'), makeProvider('anthropic')]
        }
      })

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(2) // deduplicated
      expect(result.warnings).toBeDefined()
      expect(result.warnings?.some((w) => w.includes('duplicate'))).toBe(true)
    })
  })

  describe('execute', () => {
    it('returns success with zero count when no providers', async () => {
      const ctx = createMockContext({ llm: {} })
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      expect(result.processedCount).toBe(0)
    })

    it('inserts provider row and model rows', async () => {
      const ctx = createMockContext({
        llm: {
          providers: [makeProvider('openai', [{ id: 'gpt-4o' }, { id: 'gpt-4' }])]
        }
      })
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      expect(result.processedCount).toBe(1)

      // First insert: 1 provider, second insert: 2 models (batch)
      const inserted = (ctx as unknown as { _insertValues: unknown[][] })._insertValues
      expect(inserted).toHaveLength(2)
      expect(inserted[0]).toHaveLength(1) // 1 provider row
      expect(inserted[1]).toHaveLength(2) // 2 model rows
      expect((inserted[0][0] as Record<string, unknown>).providerId).toBe('openai')
    })

    it('deduplicates models within a provider', async () => {
      const ctx = createMockContext({
        llm: {
          providers: [makeProvider('openai', [{ id: 'gpt-4o' }, { id: 'gpt-4o' }])]
        }
      })
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)

      // Should insert only 1 unique model, not 2
      const inserted = (ctx as unknown as { _insertValues: unknown[][] })._insertValues
      const modelInsert = inserted[1] // second insert is the model batch
      expect(modelInsert).toHaveLength(1)
    })

    it('migrates pinned models from Dexie settings into pin rows in legacy order', async () => {
      const ctx = createMockContext(
        {
          llm: {
            providers: [makeProvider('openai', [{ id: 'gpt-4o' }]), makeProvider('anthropic', [{ id: 'claude-3' }])]
          }
        },
        {
          'pinned:models': [
            { id: 'gpt-4o', provider: 'openai' },
            '{"id":"gpt-4o","provider":"openai"}',
            'anthropic/claude-3',
            'openai::gpt-4o',
            'missing::model',
            ''
          ]
        }
      )
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      const inserted = (ctx as unknown as { _insertValues: unknown[][] })._insertValues
      const pinRows = inserted.flat().filter((row): row is { entityId: string; orderKey: string } => {
        const pinRow = row as { entityId?: unknown; entityType?: unknown; orderKey?: unknown }
        return (
          pinRow.entityType === 'model' && typeof pinRow.entityId === 'string' && typeof pinRow.orderKey === 'string'
        )
      })

      expect(pinRows.map((row) => row.entityId)).toEqual(['openai::gpt-4o', 'anthropic::claude-3'])
      expect(pinRows.every((row) => row.orderKey.length > 0)).toBe(true)
      expect(pinRows[0].orderKey < pinRows[1].orderKey).toBe(true)
    })

    it('rolls back provider and model inserts when pin insertion fails', async () => {
      const ctx = createMockContext(
        {
          llm: {
            providers: [makeProvider('openai', [{ id: 'gpt-4o' }])]
          }
        },
        {
          'pinned:models': ['openai::gpt-4o']
        },
        {
          failOnPinInsert: true
        }
      )
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(false)
      expect(result.error).toContain('pin insert failed')
      expect((ctx as unknown as { _insertValues: unknown[][] })._insertValues).toEqual([])
    })
  })

  describe('reset', () => {
    it('clears internal state', async () => {
      const ctx = createMockContext({
        llm: {
          providers: [makeProvider('openai')]
        }
      })
      await migrator.prepare(ctx)

      migrator.reset()

      const result = await migrator.execute(ctx)
      expect(result.processedCount).toBe(0)
    })
  })
})
