import { pinTable } from '@data/db/schemas/pin'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MigrationContext } from '../../core/MigrationContext'
import { ProviderModelMigrator } from '../ProviderModelMigrator'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const registryFixtures = {
  models: new Map<string, unknown>(),
  overrides: new Map<string, unknown>(),
  providers: [] as unknown[]
}

vi.mock('@cherrystudio/provider-registry/node', () => {
  class RegistryLoader {
    findModel(modelId: string) {
      return registryFixtures.models.get(modelId) ?? null
    }
    findOverride(providerId: string, modelId: string) {
      return registryFixtures.overrides.get(`${providerId}::${modelId}`) ?? null
    }
    loadModels() {
      return []
    }
    loadProviders() {
      return registryFixtures.providers
    }
    loadProviderModels() {
      return []
    }
  }
  return { RegistryLoader }
})

interface MockContextOptions {
  failOnPinInsert?: boolean
}

function createMockContext(
  reduxState: Record<string, unknown> = {},
  dexieSettings: Record<string, unknown> = {},
  options: MockContextOptions = {}
): MigrationContext {
  const insertValues: unknown[][] = []
  let stagedInsertValues: unknown[][] = []

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
        get: vi.fn((key: string) => dexieSettings[key])
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
        from: vi.fn(() => ({
          get: vi.fn(() => Promise.resolve({ count: 0 }))
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
    registryFixtures.models.clear()
    registryFixtures.overrides.clear()
    registryFixtures.providers = []
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

    it('enriches provider rows with registry baseline (endpointConfigs/apiFeatures/defaultChatEndpoint)', async () => {
      registryFixtures.providers = [
        {
          id: 'openai',
          name: 'OpenAI',
          endpointConfigs: {
            'openai-chat-completions': {
              baseUrl: 'https://api.openai.com/v1',
              reasoningFormat: { type: 'openai-chat' }
            },
            'openai-responses': {
              baseUrl: 'https://api.openai.com/v1',
              reasoningFormat: { type: 'openai-responses' }
            }
          },
          defaultChatEndpoint: 'openai-chat-completions',
          apiFeatures: { serviceTier: false }
        }
      ]

      const ctx = createMockContext({
        llm: {
          providers: [
            {
              id: 'openai',
              name: 'OpenAI',
              type: 'openai',
              enabled: true,
              apiHost: 'https://my-proxy.com/v1',
              models: []
            }
          ]
        }
      })
      await migrator.prepare(ctx)
      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)

      const inserted = (ctx as unknown as { _insertValues: unknown[][] })._insertValues
      const providerRow = inserted[0][0] as Record<string, unknown>
      const endpointConfigs = providerRow.endpointConfigs as Record<
        string,
        { baseUrl?: string; reasoningFormatType?: string }
      >

      // Legacy apiHost wins on the chat endpoint, registry reasoningFormat is preserved
      expect(endpointConfigs['openai-chat-completions'].baseUrl).toBe('https://my-proxy.com/v1')
      expect(endpointConfigs['openai-chat-completions'].reasoningFormatType).toBe('openai-chat')
      // Registry-only endpoint survives migration
      expect(endpointConfigs['openai-responses'].baseUrl).toBe('https://api.openai.com/v1')
      expect(endpointConfigs['openai-responses'].reasoningFormatType).toBe('openai-responses')
      // apiFeatures baseline filled from registry
      expect(providerRow.apiFeatures).toEqual({ serviceTier: false })
    })

    it('leaves custom provider rows untouched when registry has no matching preset', async () => {
      registryFixtures.providers = [{ id: 'openai', name: 'OpenAI', endpointConfigs: {} }]

      const ctx = createMockContext({
        llm: {
          providers: [makeProvider('custom-provider')]
        }
      })
      await migrator.prepare(ctx)
      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      const inserted = (ctx as unknown as { _insertValues: unknown[][] })._insertValues
      const providerRow = inserted[0][0] as Record<string, unknown>
      // No registry baseline applied — apiFeatures stays null (transformProvider default)
      expect(providerRow.apiFeatures).toBeNull()
    })

    it('enriches model rows with registry preset metadata when a preset is found', async () => {
      registryFixtures.models.set('gpt-4o', {
        id: 'gpt-4o',
        name: 'GPT-4o',
        description: 'OpenAI flagship model',
        capabilities: ['function-call', 'image-recognition'],
        inputModalities: ['text', 'image'],
        outputModalities: ['text'],
        contextWindow: 128_000,
        maxOutputTokens: 16_384
      })

      const ctx = createMockContext({
        llm: {
          providers: [makeProvider('openai', [{ id: 'gpt-4o' }])]
        }
      })
      await migrator.prepare(ctx)
      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)

      const inserted = (ctx as unknown as { _insertValues: unknown[][] })._insertValues
      const modelRow = inserted[1][0] as Record<string, unknown>
      expect(modelRow.presetModelId).toBe('gpt-4o')
      expect(modelRow.contextWindow).toBe(128_000)
      expect(modelRow.maxOutputTokens).toBe(16_384)
      expect(modelRow.inputModalities).toEqual(['text', 'image'])
      expect(modelRow.outputModalities).toEqual(['text'])
      expect(modelRow.capabilities).toEqual(['function-call', 'image-recognition'])
      expect(modelRow.description).toBe('OpenAI flagship model')
    })

    it('leaves rows untouched when no registry preset matches', async () => {
      const ctx = createMockContext({
        llm: {
          providers: [makeProvider('custom-provider', [{ id: 'unknown-model' }])]
        }
      })
      await migrator.prepare(ctx)
      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)

      const inserted = (ctx as unknown as { _insertValues: unknown[][] })._insertValues
      const modelRow = inserted[1][0] as Record<string, unknown>
      expect(modelRow.contextWindow).toBeNull()
      expect(modelRow.inputModalities).toBeNull()
      expect(modelRow.outputModalities).toBeNull()
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
