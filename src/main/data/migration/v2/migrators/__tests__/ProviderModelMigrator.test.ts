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
        tableExists: vi.fn((table: string) => Promise.resolve(Array.isArray(sourceData[table]))),
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
        from: vi.fn((table: unknown) => {
          const getCount = vi.fn(() =>
            Promise.resolve({
              count:
                table === userProviderTable
                  ? getInsertedProviders().length
                  : table === pinTable
                    ? getInsertedPins().length
                    : getInsertedModels().length
            })
          )

          return {
            get: getCount,
            where: vi.fn(() => ({ get: getCount })),
            limit: vi.fn(() => ({
              all: vi.fn(() => Promise.resolve(table === userProviderTable ? getInsertedProviders().slice(0, 5) : []))
            }))
          }
        })
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

    it('adds llm default-model references that are missing from provider.models', async () => {
      const ctx = createMockContext({
        llm: {
          providers: [makeProvider('openai', [{ id: 'gpt-4o' }])],
          defaultModel: {
            id: 'gpt-5.1',
            provider: 'openai',
            name: 'GPT 5.1',
            group: 'OpenAI'
          }
        }
      })
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      const inserted = (ctx as unknown as { _insertValues: unknown[][] })._insertValues
      const modelInsert = inserted[1] as Array<Record<string, unknown>>
      expect(modelInsert.map((row) => row.id)).toEqual(['openai::gpt-4o', 'openai::gpt-5.1'])
    })

    it('validates collected model counts after execute when references add missing models', async () => {
      const ctx = createMockContext({
        llm: {
          providers: [makeProvider('openai', [{ id: 'gpt-4o' }])],
          defaultModel: {
            id: 'gpt-5.1',
            provider: 'openai',
            name: 'GPT 5.1',
            group: 'OpenAI'
          }
        }
      })

      const prepareResult = await migrator.prepare(ctx)

      expect(prepareResult.success).toBe(true)
      expect(prepareResult.itemCount).toBe(1)

      const executeResult = await migrator.execute(ctx)

      expect(executeResult.success).toBe(true)

      const validateResult = await migrator.validate(ctx)

      expect(validateResult.success).toBe(true)
      expect(validateResult.errors).toEqual([])
      expect(validateResult.stats).toEqual({
        sourceCount: 1,
        targetCount: 1,
        skippedCount: 0
      })
    })

    it('adds assistant-referenced models that are missing from provider.models', async () => {
      const providerId = 'a17b6846-e129-4508-b81a-b6e11a5efb85'
      const ctx = createMockContext({
        llm: {
          providers: [makeProvider(providerId, [{ id: 'gpt-4o' }])]
        },
        assistants: {
          assistants: [
            {
              id: 'assistant-1',
              name: 'Assistant',
              model: {
                id: '[L]gemini-2.5-pro',
                provider: providerId,
                name: 'Gemini 2.5 Pro',
                group: 'Gemini'
              }
            }
          ],
          presets: []
        }
      })
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      const inserted = (ctx as unknown as { _insertValues: unknown[][] })._insertValues
      const modelInsert = inserted[1] as Array<Record<string, unknown>>
      expect(modelInsert.map((row) => row.id)).toEqual([`${providerId}::gpt-4o`, `${providerId}::[L]gemini-2.5-pro`])
    })

    it('does not collect defaultAssistant models because defaultAssistant is not migrated', async () => {
      const ctx = createMockContext({
        llm: {
          providers: [makeProvider('openai', [{ id: 'gpt-4o' }])]
        },
        assistants: {
          assistants: [],
          presets: [],
          defaultAssistant: {
            id: 'default-assistant',
            name: 'Default Assistant',
            model: {
              id: 'gpt-5.1',
              provider: 'openai',
              name: 'GPT 5.1',
              group: 'OpenAI'
            }
          }
        }
      })
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      const inserted = (ctx as unknown as { _insertValues: unknown[][] })._insertValues
      const modelInsert = inserted[1] as Array<Record<string, unknown>>
      expect(modelInsert.map((row) => row.id)).toEqual(['openai::gpt-4o'])
    })

    it('adds models referenced by presets, assistant.defaultModel, and assistant.settings.defaultModel', async () => {
      const ctx = createMockContext({
        llm: {
          providers: [makeProvider('openai', [{ id: 'gpt-4o' }])]
        },
        assistants: {
          assistants: [
            {
              id: 'assistant-1',
              name: 'Assistant',
              defaultModel: {
                id: 'gpt-5.1-mini',
                provider: 'openai',
                name: 'GPT 5.1 Mini',
                group: 'OpenAI'
              },
              settings: {
                defaultModel: {
                  id: 'gpt-5.1-nano',
                  provider: 'openai',
                  name: 'GPT 5.1 Nano',
                  group: 'OpenAI'
                }
              }
            }
          ],
          presets: [
            {
              id: 'preset-1',
              name: 'Preset',
              model: {
                id: 'gpt-5.1',
                provider: 'openai',
                name: 'GPT 5.1',
                group: 'OpenAI'
              }
            }
          ]
        }
      })
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      const inserted = (ctx as unknown as { _insertValues: unknown[][] })._insertValues
      const modelInsert = inserted[1] as Array<Record<string, unknown>>
      expect(modelInsert.map((row) => row.id)).toEqual([
        'openai::gpt-4o',
        'openai::gpt-5.1-mini',
        'openai::gpt-5.1-nano',
        'openai::gpt-5.1'
      ])
    })

    it('adds models referenced by topicNamingModel, quickModel, and translateModel', async () => {
      const ctx = createMockContext({
        llm: {
          providers: [makeProvider('openai', [{ id: 'gpt-4o' }])],
          topicNamingModel: {
            id: 'gpt-5.1-topic',
            provider: 'openai',
            name: 'GPT 5.1 Topic',
            group: 'OpenAI'
          },
          quickModel: {
            id: 'gpt-5.1-quick',
            provider: 'openai',
            name: 'GPT 5.1 Quick',
            group: 'OpenAI'
          },
          translateModel: {
            id: 'gpt-5.1-translate',
            provider: 'openai',
            name: 'GPT 5.1 Translate',
            group: 'OpenAI'
          }
        }
      })
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      const inserted = (ctx as unknown as { _insertValues: unknown[][] })._insertValues
      const modelInsert = inserted[1] as Array<Record<string, unknown>>
      expect(modelInsert.map((row) => row.id)).toEqual([
        'openai::gpt-4o',
        'openai::gpt-5.1-topic',
        'openai::gpt-5.1-quick',
        'openai::gpt-5.1-translate'
      ])
    })

    it('salvages composite model ids whose embedded provider is unknown when explicit provider is valid', async () => {
      const ctx = createMockContext({
        llm: {
          providers: [makeProvider('openai', [{ id: 'gpt-4o' }])],
          defaultModel: {
            id: 'ghost-provider::gpt-5.1',
            provider: 'openai',
            name: 'GPT 5.1',
            group: 'OpenAI'
          }
        }
      })
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      const inserted = (ctx as unknown as { _insertValues: unknown[][] })._insertValues
      const modelInsert = inserted[1] as Array<Record<string, unknown>>
      expect(modelInsert.map((row) => row.id)).toEqual(['openai::gpt-4o', 'openai::gpt-5.1'])
    })

    it('aggregates unknown-provider references instead of logging each occurrence', async () => {
      const ctx = createMockContext({
        llm: {
          providers: [makeProvider('openai', [{ id: 'gpt-4o' }])],
          defaultModel: {
            id: 'ghost-provider::gpt-5.1',
            provider: 'still-ghost',
            name: 'Ghost 5.1',
            group: 'Ghost'
          }
        },
        knowledge: {
          bases: [
            {
              id: 'knowledge-1',
              name: 'Knowledge',
              model: {
                id: 'ghost-provider::bge-m3',
                provider: 'still-ghost',
                name: 'Ghost Embed',
                group: 'Ghost'
              }
            }
          ]
        }
      })

      const prepareResult = await migrator.prepare(ctx)

      expect(prepareResult.success).toBe(true)
      expect(loggerWarnMock).toHaveBeenCalledWith('Skipped model references for unknown providers during migration', {
        count: 2,
        samples: [
          {
            source: 'llm.defaultModel',
            providerId: 'ghost-provider',
            modelId: 'gpt-5.1'
          },
          {
            source: 'knowledge[0]:knowledge-1.model',
            providerId: 'ghost-provider',
            modelId: 'bge-m3'
          }
        ]
      })
    })

    it('adds chat message model references that are missing from provider.models', async () => {
      const ctx = createMockContext(
        {
          llm: {
            providers: [makeProvider('openai', [{ id: 'gpt-4o' }])]
          }
        },
        {
          topics: [
            {
              id: 'topic-1',
              messages: [
                {
                  id: 'message-1',
                  role: 'assistant',
                  model: { id: 'gpt-5.1', provider: 'openai', name: 'GPT 5.1', group: 'OpenAI' }
                }
              ]
            }
          ]
        }
      )
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      const inserted = (ctx as unknown as { _insertValues: unknown[][] })._insertValues
      const modelInsert = inserted[1] as Array<Record<string, unknown>>
      expect(modelInsert.map((row) => row.id)).toEqual(['openai::gpt-4o', 'openai::gpt-5.1'])
    })

    it('adds chat message fallback modelId references that are already composite', async () => {
      const ctx = createMockContext(
        {
          llm: {
            providers: [makeProvider('openai', [{ id: 'gpt-4o' }])]
          }
        },
        {
          topics: [
            {
              id: 'topic-1',
              messages: [
                {
                  id: 'message-1',
                  role: 'assistant',
                  modelId: 'openai::gpt-5.1'
                }
              ]
            }
          ]
        }
      )
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      const inserted = (ctx as unknown as { _insertValues: unknown[][] })._insertValues
      const modelInsert = inserted[1] as Array<Record<string, unknown>>
      expect(modelInsert.map((row) => row.id)).toEqual(['openai::gpt-4o', 'openai::gpt-5.1'])
    })

    it('uses composite message.modelId fallback when message.model points to an unknown provider', async () => {
      const ctx = createMockContext(
        {
          llm: {
            providers: [makeProvider('openai', [{ id: 'gpt-4o' }])]
          }
        },
        {
          topics: [
            {
              id: 'topic-1',
              messages: [
                {
                  id: 'message-1',
                  role: 'assistant',
                  model: { id: 'gpt-5.1', provider: 'ghost-provider', name: 'GPT 5.1', group: 'Ghost' },
                  modelId: 'openai::gpt-5.1'
                }
              ]
            }
          ]
        }
      )
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      const inserted = (ctx as unknown as { _insertValues: unknown[][] })._insertValues
      const modelInsert = inserted[1] as Array<Record<string, unknown>>
      expect(modelInsert.map((row) => row.id)).toEqual(['openai::gpt-4o', 'openai::gpt-5.1'])
    })

    it('ignores composite message.modelId when message.model already resolves to a different provider model', async () => {
      const ctx = createMockContext(
        {
          llm: {
            providers: [
              makeProvider('openai', [{ id: 'gpt-4o' }]),
              makeProvider('anthropic', [{ id: 'claude-3-5-sonnet' }])
            ]
          }
        },
        {
          topics: [
            {
              id: 'topic-1',
              messages: [
                {
                  id: 'message-1',
                  role: 'assistant',
                  model: { id: 'gpt-4o', provider: 'openai', name: 'GPT 4o', group: 'OpenAI' },
                  modelId: 'anthropic::claude-3-5-sonnet'
                }
              ]
            }
          ]
        }
      )
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      const inserted = (ctx as unknown as { _insertValues: unknown[][] })._insertValues
      const openaiModelInsert = inserted[1] as Array<Record<string, unknown>>
      const anthropicModelInsert = inserted[3] as Array<Record<string, unknown>>

      expect(openaiModelInsert.map((row) => row.id)).toEqual(['openai::gpt-4o'])
      expect(anthropicModelInsert.map((row) => row.id)).toEqual(['anthropic::claude-3-5-sonnet'])
    })

    it('does not warn when composite message.modelId matches message.model', async () => {
      const ctx = createMockContext(
        {
          llm: {
            providers: [makeProvider('openai', [{ id: 'gpt-4o' }])]
          }
        },
        {
          topics: [
            {
              id: 'topic-1',
              messages: [
                {
                  id: 'message-1',
                  role: 'assistant',
                  model: { id: 'gpt-4o', provider: 'openai', name: 'GPT 4o', group: 'OpenAI' },
                  modelId: 'openai::gpt-4o'
                }
              ]
            }
          ]
        }
      )

      const prepareResult = await migrator.prepare(ctx)

      expect(prepareResult.success).toBe(true)
      expect(loggerWarnMock).not.toHaveBeenCalledWith(
        'Detected mismatched legacy bare modelId values during migration',
        expect.anything()
      )
    })

    it('skips bare chat message modelId values that have no provider info', async () => {
      const ctx = createMockContext(
        {
          llm: {
            providers: [makeProvider('openai', [{ id: 'gpt-4o' }])]
          }
        },
        {
          topics: [
            {
              id: 'topic-1',
              messages: [
                {
                  id: 'message-1',
                  role: 'assistant',
                  modelId: 'gpt-5.1'
                }
              ]
            }
          ]
        }
      )
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      const inserted = (ctx as unknown as { _insertValues: unknown[][] })._insertValues
      const modelInsert = inserted[1] as Array<Record<string, unknown>>
      expect(modelInsert.map((row) => row.id)).toEqual(['openai::gpt-4o'])
    })

    it('aggregates skipped bare chat message modelId warnings', async () => {
      const ctx = createMockContext(
        {
          llm: {
            providers: [makeProvider('openai', [{ id: 'gpt-4o' }])]
          }
        },
        {
          topics: [
            {
              id: 'topic-1',
              messages: [
                { id: 'message-1', role: 'assistant', modelId: 'gpt-5.1' },
                { id: 'message-2', role: 'assistant', modelId: 'claude-3.7-sonnet' }
              ]
            }
          ]
        }
      )

      const prepareResult = await migrator.prepare(ctx)

      expect(prepareResult.success).toBe(true)
      expect(loggerWarnMock).toHaveBeenCalledWith('Skipped legacy bare modelId references during migration', {
        count: 2,
        samples: ['message-1:gpt-5.1', 'message-2:claude-3.7-sonnet']
      })
    })

    it('aggregates skipped bare chat message modelId warnings across dexie batches and caps samples at five', async () => {
      const ctx = createMockContext(
        {
          llm: {
            providers: [makeProvider('openai', [{ id: 'gpt-4o' }])]
          }
        },
        {
          topics: Array.from({ length: 101 }, (_, index) => ({
            id: `topic-${index}`,
            messages: [{ id: `message-${index}`, role: 'assistant', modelId: `bare-${index}` }]
          }))
        }
      )

      const prepareResult = await migrator.prepare(ctx)

      expect(prepareResult.success).toBe(true)
      expect(loggerWarnMock).toHaveBeenCalledWith('Skipped legacy bare modelId references during migration', {
        count: 101,
        samples: ['message-0:bare-0', 'message-1:bare-1', 'message-2:bare-2', 'message-3:bare-3', 'message-4:bare-4']
      })
    })

    it('still registers mentions when a message has only a bare modelId', async () => {
      const ctx = createMockContext(
        {
          llm: {
            providers: [makeProvider('openai', [{ id: 'gpt-4o' }])]
          }
        },
        {
          topics: [
            {
              id: 'topic-1',
              messages: [
                {
                  id: 'message-1',
                  role: 'assistant',
                  modelId: 'gpt-5.1',
                  mentions: [{ id: 'gpt-5.1', provider: 'openai', name: 'GPT 5.1', group: 'OpenAI' }]
                }
              ]
            }
          ]
        }
      )
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      const inserted = (ctx as unknown as { _insertValues: unknown[][] })._insertValues
      const modelInsert = inserted[1] as Array<Record<string, unknown>>
      expect(modelInsert.map((row) => row.id)).toEqual(['openai::gpt-4o', 'openai::gpt-5.1'])
      expect(loggerWarnMock).toHaveBeenCalledWith('Skipped legacy bare modelId references during migration', {
        count: 1,
        samples: ['message-1:gpt-5.1']
      })
    })

    it('aggregates mismatched bare modelId warnings when model and modelId disagree', async () => {
      const ctx = createMockContext(
        {
          llm: {
            providers: [makeProvider('openai', [{ id: 'gpt-4o' }])]
          }
        },
        {
          topics: [
            {
              id: 'topic-1',
              messages: [
                {
                  id: 'message-1',
                  role: 'assistant',
                  model: { id: 'gpt-4o', provider: 'openai', name: 'GPT 4o', group: 'OpenAI' },
                  modelId: 'claude-3.5-sonnet'
                }
              ]
            }
          ]
        }
      )

      const prepareResult = await migrator.prepare(ctx)

      expect(prepareResult.success).toBe(true)
      expect(loggerWarnMock).toHaveBeenCalledWith('Detected mismatched legacy bare modelId values during migration', {
        count: 1,
        samples: [
          {
            messageId: 'message-1',
            modelId: 'claude-3.5-sonnet',
            messageModelId: 'gpt-4o'
          }
        ]
      })
    })

    it('registers composite modelId fallback when message.model is incomplete', async () => {
      const ctx = createMockContext(
        {
          llm: {
            providers: [makeProvider('openai', [{ id: 'gpt-4o' }])]
          }
        },
        {
          topics: [
            {
              id: 'topic-1',
              messages: [
                {
                  id: 'message-1',
                  role: 'assistant',
                  model: { id: 'gpt-5.1' },
                  modelId: 'openai::gpt-5.1'
                }
              ]
            }
          ]
        }
      )
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      const inserted = (ctx as unknown as { _insertValues: unknown[][] })._insertValues
      const modelInsert = inserted[1] as Array<Record<string, unknown>>
      expect(modelInsert.map((row) => row.id)).toEqual(['openai::gpt-4o', 'openai::gpt-5.1'])
    })

    it('tolerates null topics, corrupt messages, and topics with non-array messages field', async () => {
      const ctx = createMockContext(
        {
          llm: {
            providers: [makeProvider('openai', [{ id: 'gpt-4o' }])]
          }
        },
        {
          topics: [
            null,
            { id: 'topic-broken', messages: 'corrupted' },
            { id: 'topic-broken-2', messages: [null] },
            { id: 'topic-ok', messages: undefined }
          ]
        }
      )

      const prepareResult = await migrator.prepare(ctx)

      expect(prepareResult.success).toBe(true)
      const result = await migrator.execute(ctx)
      expect(result.success).toBe(true)
      const inserted = (ctx as unknown as { _insertValues: unknown[][] })._insertValues
      const modelInsert = inserted[1] as Array<Record<string, unknown>>
      expect(modelInsert.map((row) => row.id)).toEqual(['openai::gpt-4o'])
    })

    it('tolerates corrupt assistant and knowledge entries without aborting preparation', async () => {
      const ctx = createMockContext({
        llm: {
          providers: [makeProvider('openai', [{ id: 'gpt-4o' }])],
          defaultModel: {
            id: 'gpt-5.1',
            provider: 'openai',
            name: 'GPT 5.1',
            group: 'OpenAI'
          }
        },
        assistants: {
          assistants: [null, 'corrupted', { id: 'assistant-1', model: { id: 'gpt-5.1-mini', provider: 'openai' } }],
          presets: [undefined]
        },
        knowledge: {
          bases: [
            null,
            42,
            { id: 'knowledge-1', name: 'Knowledge', model: { id: 'gpt-5.1-embed', provider: 'openai' } }
          ]
        }
      })

      const prepareResult = await migrator.prepare(ctx)

      expect(prepareResult.success).toBe(true)
      const result = await migrator.execute(ctx)
      expect(result.success).toBe(true)
      const inserted = (ctx as unknown as { _insertValues: unknown[][] })._insertValues
      const modelInsert = inserted[1] as Array<Record<string, unknown>>
      expect(modelInsert.map((row) => row.id)).toEqual([
        'openai::gpt-4o',
        'openai::gpt-5.1',
        'openai::gpt-5.1-mini',
        'openai::gpt-5.1-embed'
      ])
    })

    it('adds knowledge base model references that are missing from provider.models', async () => {
      const ctx = createMockContext({
        llm: {
          providers: [makeProvider('silicon', [{ id: 'qwen' }])]
        },
        knowledge: {
          bases: [
            {
              id: 'knowledge-1',
              name: 'Knowledge',
              model: {
                id: 'BAAI/bge-m3',
                provider: 'silicon',
                name: 'BGE M3',
                group: 'Embedding'
              },
              rerankModel: {
                id: 'BAAI/bge-reranker',
                provider: 'silicon',
                name: 'BGE Reranker',
                group: 'Rerank'
              }
            }
          ]
        }
      })
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      const inserted = (ctx as unknown as { _insertValues: unknown[][] })._insertValues
      const modelInsert = inserted[1] as Array<Record<string, unknown>>
      expect(modelInsert.map((row) => row.id)).toEqual([
        'silicon::qwen',
        'silicon::BAAI/bge-m3',
        'silicon::BAAI/bge-reranker'
      ])
    })

    it('keeps the first provider-owned model definition when later references reuse the same model id', async () => {
      const ctx = createMockContext({
        llm: {
          providers: [
            {
              ...makeProvider('openai'),
              models: [{ id: 'gpt-4o', name: 'Canonical' }]
            }
          ]
        },
        assistants: {
          assistants: [
            {
              id: 'assistant-1',
              model: { id: 'gpt-4o', provider: 'openai', name: 'Override' }
            }
          ],
          presets: []
        }
      })
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      const inserted = (ctx as unknown as { _insertValues: unknown[][] })._insertValues
      const modelInsert = inserted[1] as Array<Record<string, unknown>>
      expect(modelInsert).toHaveLength(1)
      expect(modelInsert[0]).toMatchObject({
        id: 'openai::gpt-4o',
        name: 'Canonical'
      })
    })

    it('skips chat model collection when the topics table is absent', async () => {
      const ctx = createMockContext({
        llm: {
          providers: [makeProvider('openai', [{ id: 'gpt-4o' }])]
        }
      })
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      const inserted = (ctx as unknown as { _insertValues: unknown[][] })._insertValues
      const modelInsert = inserted[1] as Array<Record<string, unknown>>
      expect(modelInsert.map((row) => row.id)).toEqual(['openai::gpt-4o'])
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
