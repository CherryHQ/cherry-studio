/* eslint-disable @eslint-react/naming-convention/context-name */
import { pinTable } from '@data/db/schemas/pin'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
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

function createContext(
  db: MigrationContext['db'],
  reduxState: Record<string, unknown> = {},
  dexieSettings: Record<string, unknown> = {}
): MigrationContext {
  return {
    sources: {
      reduxState: {
        getCategory: vi.fn((cat: string) => reduxState[cat])
      },
      dexieSettings: {
        get: vi.fn((key: string) => dexieSettings[key])
      }
    },
    db
  } as unknown as MigrationContext
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
  const dbh = setupTestDatabase()
  let migrator: ProviderModelMigrator

  beforeEach(() => {
    migrator = new ProviderModelMigrator()
    registryFixtures.models.clear()
    registryFixtures.overrides.clear()
    registryFixtures.providers = []
  })

  describe('prepare', () => {
    it('returns success with provider count', async () => {
      const migrationContext = createContext(dbh.db, {
        llm: {
          providers: [makeProvider('openai'), makeProvider('anthropic')]
        }
      })

      const result = await migrator.prepare(migrationContext)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(2)
    })

    it('handles missing providers gracefully', async () => {
      const migrationContext = createContext(dbh.db, { llm: {} })

      const result = await migrator.prepare(migrationContext)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(0)
    })

    it('deduplicates providers by ID', async () => {
      const migrationContext = createContext(dbh.db, {
        llm: {
          providers: [makeProvider('openai'), makeProvider('openai'), makeProvider('anthropic')]
        }
      })

      const result = await migrator.prepare(migrationContext)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(2) // deduplicated
      expect(result.warnings).toBeDefined()
      expect(result.warnings?.some((w) => w.includes('duplicate'))).toBe(true)
    })

    it('returns an error ID when preparation fails', async () => {
      const cause = new Error('redux state unreadable')
      const migrationContext = {
        sources: {
          reduxState: {
            getCategory: vi.fn(() => {
              throw cause
            })
          },
          dexieSettings: {
            get: vi.fn()
          }
        },
        db: dbh.db
      } as unknown as MigrationContext

      const result = await migrator.prepare(migrationContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('provider_model_prepare_failed')
      expect(result.error).toContain('Provider/model preparation failed')
    })
  })

  describe('execute', () => {
    it('returns success with zero count when no providers', async () => {
      const migrationContext = createContext(dbh.db, { llm: {} })
      await migrator.prepare(migrationContext)

      const result = await migrator.execute(migrationContext)

      expect(result.success).toBe(true)
      expect(result.processedCount).toBe(0)
    })

    it('inserts provider row and model rows', async () => {
      const migrationContext = createContext(dbh.db, {
        llm: {
          providers: [makeProvider('openai', [{ id: 'gpt-4o' }, { id: 'gpt-4' }])]
        }
      })
      await migrator.prepare(migrationContext)

      const result = await migrator.execute(migrationContext)

      expect(result.success).toBe(true)
      expect(result.processedCount).toBe(1)

      const providers = await dbh.db.select().from(userProviderTable)
      const models = await dbh.db.select().from(userModelTable)
      expect(providers).toHaveLength(1)
      expect(models).toHaveLength(2)
      expect(providers[0].providerId).toBe('openai')
    })

    it('deduplicates models within a provider', async () => {
      const migrationContext = createContext(dbh.db, {
        llm: {
          providers: [makeProvider('openai', [{ id: 'gpt-4o' }, { id: 'gpt-4o' }])]
        }
      })
      await migrator.prepare(migrationContext)

      const result = await migrator.execute(migrationContext)

      expect(result.success).toBe(true)

      const models = await dbh.db.select().from(userModelTable)
      expect(models).toHaveLength(1)
    })

    it('migrates pinned models from Dexie settings into pin rows in legacy order', async () => {
      const migrationContext = createContext(
        dbh.db,
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
      await migrator.prepare(migrationContext)

      const result = await migrator.execute(migrationContext)

      expect(result.success).toBe(true)
      const pinRows = await dbh.db.select().from(pinTable).where(eq(pinTable.entityType, 'model'))

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

      const migrationContext = createContext(dbh.db, {
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
      await migrator.prepare(migrationContext)
      const result = await migrator.execute(migrationContext)

      expect(result.success).toBe(true)

      const [providerRow] = await dbh.db
        .select()
        .from(userProviderTable)
        .where(eq(userProviderTable.providerId, 'openai'))
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

      const migrationContext = createContext(dbh.db, {
        llm: {
          providers: [makeProvider('custom-provider')]
        }
      })
      await migrator.prepare(migrationContext)
      const result = await migrator.execute(migrationContext)

      expect(result.success).toBe(true)
      const [providerRow] = await dbh.db
        .select()
        .from(userProviderTable)
        .where(eq(userProviderTable.providerId, 'custom-provider'))
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

      const migrationContext = createContext(dbh.db, {
        llm: {
          providers: [makeProvider('openai', [{ id: 'gpt-4o' }])]
        }
      })
      await migrator.prepare(migrationContext)
      const result = await migrator.execute(migrationContext)

      expect(result.success).toBe(true)

      const [modelRow] = await dbh.db.select().from(userModelTable).where(eq(userModelTable.id, 'openai::gpt-4o'))
      expect(modelRow.presetModelId).toBe('gpt-4o')
      expect(modelRow.contextWindow).toBe(128_000)
      expect(modelRow.maxOutputTokens).toBe(16_384)
      expect(modelRow.inputModalities).toEqual(['text', 'image'])
      expect(modelRow.outputModalities).toEqual(['text'])
      expect(modelRow.capabilities).toEqual(['function-call', 'image-recognition'])
      expect(modelRow.description).toBe('OpenAI flagship model')
    })

    it('leaves rows untouched when no registry preset matches', async () => {
      const migrationContext = createContext(dbh.db, {
        llm: {
          providers: [makeProvider('custom-provider', [{ id: 'unknown-model' }])]
        }
      })
      await migrator.prepare(migrationContext)
      const result = await migrator.execute(migrationContext)

      expect(result.success).toBe(true)

      const [modelRow] = await dbh.db
        .select()
        .from(userModelTable)
        .where(eq(userModelTable.id, 'custom-provider::unknown-model'))
      expect(modelRow.contextWindow).toBeNull()
      expect(modelRow.inputModalities).toBeNull()
      expect(modelRow.outputModalities).toBeNull()
    })

    it('rolls back provider inserts when a later model insert fails', async () => {
      await dbh.db.insert(userProviderTable).values({
        providerId: 'other',
        name: 'Other',
        orderKey: generateOrderKeyBetween(null, null)
      })
      await dbh.db.insert(userModelTable).values({
        id: createUniqueModelId('openai', 'gpt-4o'),
        providerId: 'other',
        modelId: 'conflicting-row',
        name: 'Conflicting row',
        capabilities: [],
        supportsStreaming: true,
        isEnabled: true,
        isHidden: false,
        isDeprecated: false,
        orderKey: generateOrderKeyBetween(null, null)
      })

      const migrationContext = createContext(dbh.db, {
        llm: {
          providers: [makeProvider('openai', [{ id: 'gpt-4o' }])]
        }
      })
      await migrator.prepare(migrationContext)

      const result = await migrator.execute(migrationContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('provider_model_execute_failed')
      expect(result.error).toBeDefined()
      const openaiProviders = await dbh.db
        .select()
        .from(userProviderTable)
        .where(eq(userProviderTable.providerId, 'openai'))
      expect(openaiProviders).toEqual([])
    })
  })

  describe('validate', () => {
    it('returns an error ID when validation throws', async () => {
      const cause = new Error('count query failed')
      const migrationContext = createContext({
        select: vi.fn(() => {
          throw cause
        })
      } as unknown as MigrationContext['db'])

      const result = await migrator.validate(migrationContext)

      expect(result.success).toBe(false)
      expect(result.errors[0].key).toBe('provider_model_validate_failed')
      expect(result.errors[0].message).toContain('provider_model_validate_failed')
      expect(result.errors[0].message).toContain('Provider/model validation failed')
    })
  })

  describe('reset', () => {
    it('clears internal state', async () => {
      const migrationContext = createContext(dbh.db, {
        llm: {
          providers: [makeProvider('openai')]
        }
      })
      await migrator.prepare(migrationContext)

      migrator.reset()

      const result = await migrator.execute(migrationContext)
      expect(result.processedCount).toBe(0)
    })
  })
})
