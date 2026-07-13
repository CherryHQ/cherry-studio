/* eslint-disable @eslint-react/naming-convention/context-name */
import { existsSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { ENDPOINT_TYPE } from '@cherrystudio/provider-registry'
import { assistantTable } from '@data/db/schemas/assistant'
import { fileEntryTable } from '@data/db/schemas/file'
import { providerLogoFileRefTable } from '@data/db/schemas/fileRelations'
import { pinTable } from '@data/db/schemas/pin'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import { CHERRYAI_DEFAULT_UNIQUE_MODEL_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { createUniqueModelId, MODEL_CAPABILITY } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { asc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** A valid 1×1 PNG so `sharp` can transcode it to WebP during migration. */
const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

import type { MigrationContext } from '../../core/MigrationContext'
import { AssistantMigrator } from '../AssistantMigrator'
import { ProviderModelMigrator } from '../ProviderModelMigrator'

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
  dexieSettings: Record<string, unknown> = {},
  filesDataDir = ''
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
    db,
    sharedData: new Map(),
    paths: { filesDataDir }
  } as unknown as MigrationContext
}

function makeProvider(
  id: string,
  models: Array<{
    id: string
    supported_endpoint_types?: string[]
    capabilities?: Array<{ type: 'rerank'; isUserSelected?: boolean }>
  }> = []
) {
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

    it('skips legacy CherryAI provider rows because CherryAI is seeded', async () => {
      const migrationContext = createContext(dbh.db, {
        llm: {
          providers: [makeProvider(CHERRYAI_PROVIDER_ID, [{ id: 'qwen' }]), makeProvider('openai', [{ id: 'gpt-4o' }])]
        }
      })

      const result = await migrator.prepare(migrationContext)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(1)
      expect(result.warnings?.some((w) => w.includes('managed CherryAI'))).toBe(true)
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
      const migratedProviders = providers.filter((provider) => provider.providerId !== CHERRYAI_PROVIDER_ID)
      const migratedModels = models.filter((model) => model.providerId !== CHERRYAI_PROVIDER_ID)
      expect(migratedProviders).toHaveLength(1)
      expect(migratedModels).toHaveLength(2)
      expect(migratedProviders[0].providerId).toBe('openai')
    })

    it('assigns migrated provider order keys after the seeded CherryAI provider', async () => {
      const migrationContext = createContext(dbh.db, {
        llm: {
          providers: [makeProvider('openai'), makeProvider('anthropic')]
        }
      })
      await migrator.prepare(migrationContext)

      const result = await migrator.execute(migrationContext)

      expect(result.success).toBe(true)
      const providers = await dbh.db.select().from(userProviderTable).orderBy(asc(userProviderTable.orderKey))
      expect(providers.map((provider) => provider.providerId)).toEqual([CHERRYAI_PROVIDER_ID, 'openai', 'anthropic'])
      expect(new Set(providers.map((provider) => provider.orderKey)).size).toBe(providers.length)
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
      expect(models.filter((model) => model.providerId !== CHERRYAI_PROVIDER_ID)).toHaveLength(1)
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

    it('keeps legacy CherryAI default model pins pointed at the seeded Qwen model', async () => {
      const migrationContext = createContext(
        dbh.db,
        {
          llm: {
            providers: [
              makeProvider(CHERRYAI_PROVIDER_ID, [{ id: 'qwen' }]),
              makeProvider('openai', [{ id: 'gpt-4o' }])
            ]
          }
        },
        {
          'pinned:models': [
            { id: 'qwen', provider: CHERRYAI_PROVIDER_ID },
            { id: 'gpt-4o', provider: 'openai' }
          ]
        }
      )
      await migrator.prepare(migrationContext)

      const result = await migrator.execute(migrationContext)

      expect(result.success).toBe(true)
      const pinRows = await dbh.db.select().from(pinTable).where(eq(pinTable.entityType, 'model'))
      expect(pinRows.map((row) => row.entityId)).toEqual([CHERRYAI_DEFAULT_UNIQUE_MODEL_ID, 'openai::gpt-4o'])
      const cherryAiProviderRows = await dbh.db
        .select()
        .from(userProviderTable)
        .where(eq(userProviderTable.providerId, CHERRYAI_PROVIDER_ID))
      expect(cherryAiProviderRows).toHaveLength(1)
      const cherryAiModelRows = await dbh.db
        .select()
        .from(userModelTable)
        .where(eq(userModelTable.id, CHERRYAI_DEFAULT_UNIQUE_MODEL_ID))
      expect(cherryAiModelRows).toHaveLength(1)
    })

    it('migrates legacy CherryAI pins even when all providers are managed', async () => {
      const migrationContext = createContext(
        dbh.db,
        {
          llm: {
            providers: [makeProvider(CHERRYAI_PROVIDER_ID, [{ id: 'qwen' }])]
          }
        },
        {
          'pinned:models': [{ id: 'qwen', provider: CHERRYAI_PROVIDER_ID }]
        }
      )
      await migrator.prepare(migrationContext)

      const result = await migrator.execute(migrationContext)

      expect(result.success).toBe(true)
      expect(result.processedCount).toBe(0)
      const pinRows = await dbh.db.select().from(pinTable).where(eq(pinTable.entityType, 'model'))
      expect(pinRows.map((row) => row.entityId)).toEqual([CHERRYAI_DEFAULT_UNIQUE_MODEL_ID])
      const cherryAiModelRows = await dbh.db
        .select()
        .from(userModelTable)
        .where(eq(userModelTable.id, CHERRYAI_DEFAULT_UNIQUE_MODEL_ID))
      expect(cherryAiModelRows).toHaveLength(1)
    })

    it('keeps migrated assistants pointed at the managed CherryAI default model', async () => {
      const migrationContext = createContext(dbh.db, {
        llm: {
          providers: [makeProvider(CHERRYAI_PROVIDER_ID, [{ id: 'qwen' }])]
        },
        assistants: {
          assistants: [
            {
              id: 'ast-cherryai',
              name: 'CherryAI Assistant',
              model: { id: 'qwen', provider: CHERRYAI_PROVIDER_ID }
            }
          ],
          presets: []
        }
      })
      const providerMigrator = new ProviderModelMigrator()
      const assistantMigrator = new AssistantMigrator()

      await providerMigrator.prepare(migrationContext)
      const providerResult = await providerMigrator.execute(migrationContext)
      await assistantMigrator.prepare(migrationContext)
      const assistantResult = await assistantMigrator.execute(migrationContext)

      expect(providerResult.success).toBe(true)
      expect(assistantResult.success).toBe(true)
      const [assistant] = await dbh.db
        .select({ modelId: assistantTable.modelId })
        .from(assistantTable)
        .where(eq(assistantTable.id, 'ast-cherryai'))
        .limit(1)
      expect(assistant?.modelId).toBe(CHERRYAI_DEFAULT_UNIQUE_MODEL_ID)
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

    it('promotes a v1 custom provider logo from dexie settings into a WebP file_entry', async () => {
      const filesDataDir = mkdtempSync(path.join(os.tmpdir(), 'provider-logo-mig-'))
      const migrationContext = createContext(
        dbh.db,
        { llm: { providers: [makeProvider('with-logo'), makeProvider('no-logo')] } },
        { 'image://provider-with-logo': PNG_1X1 },
        filesDataDir
      )
      await migrator.prepare(migrationContext)
      const result = await migrator.execute(migrationContext)

      expect(result.success).toBe(true)

      const [withLogo] = await dbh.db
        .select()
        .from(userProviderTable)
        .where(eq(userProviderTable.providerId, 'with-logo'))
      // Base64 upload becomes an on-disk WebP file_entry; logoKey stays null.
      expect(withLogo.logoKey).toBeNull()

      // The uploaded logo's file id lives ONLY in the ref row (single source of truth).
      const refs = await dbh.db
        .select()
        .from(providerLogoFileRefTable)
        .where(eq(providerLogoFileRefTable.sourceId, 'with-logo'))
      expect(refs).toHaveLength(1)
      const logoFileId = refs[0].fileEntryId

      const [entry] = await dbh.db.select().from(fileEntryTable).where(eq(fileEntryTable.id, logoFileId))
      expect(entry?.origin).toBe('internal')
      expect(entry?.ext).toBe('webp')
      expect(existsSync(path.join(filesDataDir, `${logoFileId}.webp`))).toBe(true)

      const [withoutLogo] = await dbh.db
        .select()
        .from(userProviderTable)
        .where(eq(userProviderTable.providerId, 'no-logo'))
      expect(withoutLogo.logoKey).toBeNull()
      const noLogoRefs = await dbh.db
        .select()
        .from(providerLogoFileRefTable)
        .where(eq(providerLogoFileRefTable.sourceId, 'no-logo'))
      expect(noLogoRefs).toHaveLength(0)
    })

    it('recovers a v1 built-in provider logo (non-data asset value) as an icon: ref, dropping unknowns', async () => {
      // Released v1 stores a picked built-in logo as `PROVIDER_LOGO_MAP[id]` — a hashed
      // build-asset URL (or the literal `'poe'`), NOT an `icon:<id>` ref. That value no
      // longer resolves in v2. For a *custom* provider (random UUID id that doesn't
      // resolve in the icon catalog) logoKey is the only logo it has, so the picked brand
      // is recovered from the asset name and re-expressed as `icon:<catalogKey>`. An
      // unrecognized value drops to null (no broken image). Never a file_entry / ref row.
      const migrationContext = createContext(
        dbh.db,
        {
          llm: {
            providers: [
              // Custom (UUID) providers — id won't resolve, so logoKey drives the avatar.
              makeProvider('018f-uuid-openai'), // hashed bundled URL
              makeProvider('018f-uuid-azure'), // asset named after a different brand (microsoft.png → azureai)
              makeProvider('018f-uuid-poe'), // v1 literal 'poe'
              makeProvider('018f-uuid-renamed') // unknown/renamed key → drops
            ]
          }
        },
        {
          'image://provider-018f-uuid-openai': '/assets/openai-a1b2c3d4.png',
          'image://provider-018f-uuid-azure': '/assets/microsoft-deadbeef.png',
          'image://provider-018f-uuid-poe': 'poe',
          'image://provider-018f-uuid-renamed': 'icon:aiStudio'
        },
        ''
      )
      await migrator.prepare(migrationContext)
      const result = await migrator.execute(migrationContext)

      expect(result.success).toBe(true)

      const expected: Record<string, string | null> = {
        '018f-uuid-openai': 'icon:openai',
        '018f-uuid-azure': 'icon:azureai',
        '018f-uuid-poe': 'icon:poe',
        '018f-uuid-renamed': null
      }
      for (const [providerId, logoKey] of Object.entries(expected)) {
        const [provider] = await dbh.db
          .select()
          .from(userProviderTable)
          .where(eq(userProviderTable.providerId, providerId))
        expect(provider.logoKey).toBe(logoKey)

        // A recovered icon ref lives on logoKey only — never a file_entry / ref row.
        const refs = await dbh.db
          .select()
          .from(providerLogoFileRefTable)
          .where(eq(providerLogoFileRefTable.sourceId, providerId))
        expect(refs).toHaveLength(0)
      }
    })

    it('keeps the catalog adapterFamily over the migrator fallback for relay system providers', async () => {
      // aihubmix's anthropic-messages endpoint routes through adapterFamily
      // 'aihubmix' (vendor-specific multi-provider relay), which is strictly
      // more accurate than the migrator's generic 'anthropic' fallback. The
      // enrichment merge must not let the fallback clobber it.
      registryFixtures.providers = [
        {
          id: 'aihubmix',
          name: 'AiHubMix',
          endpointConfigs: {
            'anthropic-messages': { baseUrl: 'https://aihubmix.com', adapterFamily: 'aihubmix' }
          },
          defaultChatEndpoint: 'anthropic-messages'
        }
      ]

      const migrationContext = createContext(dbh.db, {
        llm: {
          providers: [
            {
              id: 'aihubmix',
              name: 'AiHubMix',
              type: 'openai',
              enabled: true,
              apiHost: '',
              anthropicApiHost: 'https://aihubmix.com',
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
        .where(eq(userProviderTable.providerId, 'aihubmix'))
      const endpointConfigs = providerRow.endpointConfigs as Record<string, { adapterFamily?: string }>
      expect(endpointConfigs['anthropic-messages'].adapterFamily).toBe('aihubmix')
    })

    it('backfills the anthropic adapterFamily for a custom relay with no catalog match', async () => {
      // End-to-end regression for the Xiaomi MIMO token-plan provider: a v1
      // custom relay (UUID id, type='openai', anthropicApiHost) with no
      // registry preset. Without this backfill the resolver fell back to
      // openai-compatible and POSTed `/anthropic/v1/chat/completions` → 404.
      registryFixtures.providers = []

      const migrationContext = createContext(dbh.db, {
        llm: {
          providers: [
            {
              id: '7c3dfc0b-985d-440b-b18b-e639fcf9218e',
              name: 'XIAOMI MIMO TOKEN PLAN',
              type: 'openai',
              enabled: true,
              apiHost: '',
              anthropicApiHost: 'https://token-plan-cn.xiaomimimo.com/anthropic',
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
        .where(eq(userProviderTable.providerId, '7c3dfc0b-985d-440b-b18b-e639fcf9218e'))
      const endpointConfigs = providerRow.endpointConfigs as Record<string, { adapterFamily?: string }>
      expect(endpointConfigs['anthropic-messages'].adapterFamily).toBe('anthropic')
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

    it('preserves an explicit rerank disable for matching model ids and registry presets', async () => {
      registryFixtures.models.set('rerank-2', {
        id: 'rerank-2',
        name: 'Rerank 2',
        capabilities: [MODEL_CAPABILITY.RERANK]
      })
      const migrationContext = createContext(dbh.db, {
        llm: {
          providers: [
            makeProvider('voyageai', [{ id: 'rerank-2', capabilities: [{ type: 'rerank', isUserSelected: false }] }])
          ]
        }
      })
      await migrator.prepare(migrationContext)

      const result = await migrator.execute(migrationContext)

      expect(result.success).toBe(true)
      const [modelRow] = await dbh.db.select().from(userModelTable).where(eq(userModelTable.id, 'voyageai::rerank-2'))
      expect(modelRow.capabilities).toEqual([])
      expect(modelRow.userOverrides).toEqual(['capabilities'])
    })

    it('normalizes Jina rerank endpoint metadata for opaque NewAPI model ids', async () => {
      const migrationContext = createContext(dbh.db, {
        llm: {
          providers: [
            {
              ...makeProvider('new-api', [{ id: 'opaque-model-id', supported_endpoint_types: [' JINA-RERANK '] }])
            }
          ]
        }
      })
      await migrator.prepare(migrationContext)

      const result = await migrator.execute(migrationContext)

      expect(result.success).toBe(true)

      const [modelRow] = await dbh.db
        .select()
        .from(userModelTable)
        .where(eq(userModelTable.id, 'new-api::opaque-model-id'))
      expect(modelRow.endpointTypes).toEqual([ENDPOINT_TYPE.JINA_RERANK])
      expect(modelRow.capabilities).toEqual([MODEL_CAPABILITY.RERANK])
    })

    it('preserves an explicit rerank disable for opaque models with a primary Jina endpoint', async () => {
      const migrationContext = createContext(dbh.db, {
        llm: {
          providers: [
            makeProvider('new-api', [
              {
                id: 'opaque-model-id',
                supported_endpoint_types: ['jina-rerank'],
                capabilities: [{ type: 'rerank', isUserSelected: false }]
              }
            ])
          ]
        }
      })
      await migrator.prepare(migrationContext)

      const result = await migrator.execute(migrationContext)

      expect(result.success).toBe(true)
      const [modelRow] = await dbh.db
        .select()
        .from(userModelTable)
        .where(eq(userModelTable.id, 'new-api::opaque-model-id'))
      expect(modelRow.endpointTypes).toEqual([ENDPOINT_TYPE.JINA_RERANK])
      expect(modelRow.capabilities).toEqual([])
      expect(modelRow.userOverrides).toEqual(['capabilities'])
    })

    it('does not infer rerank from a secondary Jina endpoint', async () => {
      const migrationContext = createContext(dbh.db, {
        llm: {
          providers: [
            makeProvider('new-api', [
              { id: 'multi-endpoint-chat-model', supported_endpoint_types: ['openai', 'jina-rerank'] }
            ])
          ]
        }
      })
      await migrator.prepare(migrationContext)

      const result = await migrator.execute(migrationContext)

      expect(result.success).toBe(true)
      const [modelRow] = await dbh.db
        .select()
        .from(userModelTable)
        .where(eq(userModelTable.id, 'new-api::multi-endpoint-chat-model'))
      expect(modelRow.endpointTypes).toEqual([ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.JINA_RERANK])
      expect(modelRow.capabilities).toEqual([])
    })

    it('tolerates a provider whose models field is null or undefined', async () => {
      const migrationContext = createContext(dbh.db, {
        llm: {
          providers: [
            { id: 'no-models-null', name: 'No Models Null', type: 'openai', enabled: true, models: null },
            { id: 'no-models-undef', name: 'No Models Undef', type: 'openai', enabled: true }
          ]
        }
      })
      await migrator.prepare(migrationContext)

      const result = await migrator.execute(migrationContext)

      expect(result.success).toBe(true)
      const providers = await dbh.db.select().from(userProviderTable)
      expect(
        providers
          .map((p) => p.providerId)
          .filter((providerId) => providerId !== CHERRYAI_PROVIDER_ID)
          .sort()
      ).toEqual(['no-models-null', 'no-models-undef'])
      const models = await dbh.db.select().from(userModelTable)
      expect(models.filter((model) => model.providerId !== CHERRYAI_PROVIDER_ID)).toEqual([])
    })

    it('filters providers with missing or empty id and reports a warning', async () => {
      // SQLite's text PK accepts '' so an unfiltered empty-id row would land
      // in userProvider and shadow lookups across the v2 data layer.
      // prepare() must drop these and surface a warning; execute() then
      // processes only the remaining valid rows.
      const migrationContext = createContext(dbh.db, {
        llm: {
          providers: [
            { id: '', name: 'Empty ID', type: 'openai', enabled: true, models: [] },
            makeProvider('openai', [{ id: 'gpt-4o' }])
          ]
        }
      })

      const prepareResult = await migrator.prepare(migrationContext)
      expect(prepareResult.success).toBe(true)
      expect(prepareResult.itemCount).toBe(1)
      expect(prepareResult.warnings?.some((w) => w.includes('missing or empty id'))).toBe(true)

      const result = await migrator.execute(migrationContext)
      expect(result.success).toBe(true)

      const providers = await dbh.db.select().from(userProviderTable)
      expect(providers.map((p) => p.providerId).filter((providerId) => providerId !== CHERRYAI_PROVIDER_ID)).toEqual([
        'openai'
      ])
      const emptyIdRows = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, ''))
      expect(emptyIdRows).toEqual([])
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
