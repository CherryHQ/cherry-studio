/**
 * Tests for ProviderRegistryService.
 * Uses setupTestDatabase() per CLAUDE.md testing guidelines.
 */

import { readFileSync } from 'node:fs'

import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockMainLoggerService } from '../../../../../tests/__mocks__/MainLoggerService'

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

// Mock provider-registry/node — include RegistryLoader that delegates to mocked readers
vi.mock('@cherrystudio/provider-registry/node', async () => {
  const { normalizeModelId } = await vi.importActual<Record<string, unknown>>('@cherrystudio/provider-registry')
  const normalize = normalizeModelId as (id: string) => string

  const readModelRegistry = vi.fn()
  const readProviderModelRegistry = vi.fn()
  const readProviderRegistry = vi.fn()

  class RegistryLoader {
    private paths: { models: string; providers: string; providerModels: string }
    private cachedModels: any[] | null = null
    private cachedProviders: any[] | null = null
    private cachedProviderModels: any[] | null = null
    private ver: string | null = null
    private modelById: Map<string, any> | null = null
    private modelByNormId: Map<string, any> | null = null
    private overrideByKey: Map<string, any> | null = null
    private overrideByNormKey: Map<string, any> | null = null
    private overrideByApiKey: Map<string, any> | null = null
    private overrideByNormApiKey: Map<string, any> | null = null

    constructor(paths: { models: string; providers: string; providerModels: string }) {
      this.paths = paths
    }
    loadModels() {
      if (this.cachedModels) return this.cachedModels
      const d = readModelRegistry(this.paths.models)
      this.cachedModels = d.models ?? []
      this.ver = d.version
      this.modelById = new Map()
      this.modelByNormId = new Map()
      for (const m of this.cachedModels!) {
        this.modelById.set(m.id, m)
        const nid = normalize(m.id)
        if (!this.modelByNormId.has(nid)) this.modelByNormId.set(nid, m)
      }
      return this.cachedModels
    }
    loadProviders() {
      if (this.cachedProviders) return this.cachedProviders
      const d = readProviderRegistry(this.paths.providers)
      this.cachedProviders = d.providers ?? []
      return this.cachedProviders
    }
    loadProviderModels() {
      if (this.cachedProviderModels) return this.cachedProviderModels
      const d = readProviderModelRegistry(this.paths.providerModels)
      this.cachedProviderModels = d.overrides ?? []
      this.overrideByKey = new Map()
      this.overrideByNormKey = new Map()
      this.overrideByApiKey = new Map()
      this.overrideByNormApiKey = new Map()
      for (const pm of this.cachedProviderModels!) {
        this.overrideByKey.set(`${pm.providerId}::${pm.modelId}`, pm)
        const nk = `${pm.providerId}::${normalize(pm.modelId)}`
        if (!this.overrideByNormKey.has(nk)) this.overrideByNormKey.set(nk, pm)
        if (pm.apiModelId) {
          this.overrideByApiKey.set(`${pm.providerId}::${pm.apiModelId}`, pm)
          const ank = `${pm.providerId}::${normalize(pm.apiModelId)}`
          if (!this.overrideByNormApiKey.has(ank)) this.overrideByNormApiKey.set(ank, pm)
        }
      }
      return this.cachedProviderModels
    }
    findModel(modelId: string) {
      this.loadModels()
      return this.modelById!.get(modelId) ?? this.modelByNormId!.get(normalize(modelId)) ?? null
    }
    findOverride(providerId: string, modelId: string) {
      this.loadProviderModels()
      return (
        this.overrideByKey!.get(`${providerId}::${modelId}`) ??
        this.overrideByNormKey!.get(`${providerId}::${normalize(modelId)}`) ??
        this.overrideByApiKey!.get(`${providerId}::${modelId}`) ??
        this.overrideByNormApiKey!.get(`${providerId}::${normalize(modelId)}`) ??
        null
      )
    }
    getOverridesForProvider(providerId: string) {
      this.loadProviderModels()
      return this.cachedProviderModels!.filter((pm: any) => pm.providerId === providerId)
    }
    getModelsVersion() {
      this.loadModels()
      return this.ver!
    }
    getProviderModelsVersion() {
      this.loadProviderModels()
      return '1.0'
    }
  }

  return { readModelRegistry, readProviderModelRegistry, readProviderRegistry, RegistryLoader }
})

vi.mock('../ModelService', () => ({
  modelService: { batchUpsert: vi.fn() }
}))

import {
  readModelRegistry,
  readProviderModelRegistry,
  readProviderRegistry
} from '@cherrystudio/provider-registry/node'

// Must import after mocks are set up
const { mergePresetModel, providerRegistryService } = await import('../ProviderRegistryService')

const mockReadModels = vi.mocked(readModelRegistry)
const mockReadProviderModels = vi.mocked(readProviderModelRegistry)
const mockReadProviders = vi.mocked(readProviderRegistry)

function setupRegistryData() {
  mockReadModels.mockReturnValue({
    version: '1.0',
    models: [
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        capabilities: ['image-recognition', 'function-call'],
        inputModalities: ['text', 'image'],
        outputModalities: ['text'],
        contextWindow: 128_000,
        maxOutputTokens: 4096
      }
    ]
  } as ReturnType<typeof readModelRegistry>)

  mockReadProviderModels.mockReturnValue({
    version: '1.0',
    overrides: [
      {
        providerId: 'openai',
        modelId: 'gpt-4o'
      }
    ]
  } as ReturnType<typeof readProviderModelRegistry>)

  mockReadProviders.mockReturnValue({
    version: '1.0',
    providers: [
      {
        id: 'openai',
        name: 'OpenAI',
        endpointConfigs: {
          'openai-chat-completions': {
            baseUrl: 'https://api.openai.com/v1'
          }
        },
        defaultChatEndpoint: 'openai-chat-completions',
        metadata: { website: { official: 'https://openai.com' } }
      }
    ]
  } as ReturnType<typeof readProviderRegistry>)
}

function clearServiceCache() {
  providerRegistryService.clearCache()
}

describe('ProviderRegistryService', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    vi.clearAllMocks()
    clearServiceCache()
    MockMainDbServiceUtils.setDb(dbh.db)
  })

  describe('getProviderPreset', () => {
    it('returns only the requested registry fields', () => {
      setupRegistryData()
      const preset = providerRegistryService.getProviderPreset('openai', ['endpointConfigs'])

      expect(preset.endpointConfigs?.['openai-chat-completions']?.baseUrl).toBe('https://api.openai.com/v1')
      expect(preset).not.toHaveProperty('models')
    })

    it('resolves a custom provider through presetProviderId and preserves its model identities', () => {
      setupRegistryData()
      const preset = providerRegistryService.getProviderPreset(
        'my-openai-clone',
        ['endpointConfigs', 'models'],
        'openai'
      )

      expect(preset.endpointConfigs?.['openai-chat-completions']?.baseUrl).toBe('https://api.openai.com/v1')
      expect(preset.models?.map((model) => model.id)).toEqual(['my-openai-clone::gpt-4o'])
      expect(preset.models?.[0].providerId).toBe('my-openai-clone')
    })

    it('uses explicit empty semantics when the requested preset data is unavailable', () => {
      setupRegistryData()

      expect(
        providerRegistryService.getProviderPreset('does-not-exist', ['endpointConfigs', 'models'], 'also-missing')
      ).toEqual({ endpointConfigs: null, models: [] })
    })

    it('treats an explicit null preset id as authoritative custom provenance', () => {
      setupRegistryData()

      expect(providerRegistryService.getProviderPreset('openai', ['endpointConfigs', 'models'], null)).toEqual({
        endpointConfigs: null,
        models: []
      })
    })
  })

  describe('registry load failure', () => {
    it('should throw when models.json cannot be read', async () => {
      setupRegistryData()
      mockReadModels.mockImplementation(() => {
        throw new Error('ENOENT: no such file')
      })

      expect(() => providerRegistryService.lookupModel('openai', 'gpt-4o')).toThrow('ENOENT')
    })

    it('should throw when providers.json cannot be read', async () => {
      setupRegistryData()
      mockReadProviders.mockImplementation(() => {
        throw new Error('ENOENT: no such file')
      })

      expect(() => providerRegistryService.lookupModel('openai', 'gpt-4o')).toThrow('ENOENT')
    })
  })

  describe('cache reuse', () => {
    it('should only read models.json once across multiple calls', async () => {
      setupRegistryData()

      providerRegistryService.resolveModels('openai', ['gpt-4o'])
      providerRegistryService.resolveModels('openai', ['gpt-4o'])

      expect(mockReadModels).toHaveBeenCalledTimes(1)
    })
  })

  describe('resolveModels', () => {
    it('should merge raw models with registry data including capabilities and limits', async () => {
      setupRegistryData()

      const models = providerRegistryService.resolveModels('openai', ['gpt-4o'])

      expect(models).toHaveLength(1)
      expect(models[0].name).toBe('GPT-4o')
      expect(models[0].capabilities).toContain('image-recognition')
      expect(models[0].capabilities).toContain('function-call')
      expect(models[0].contextWindow).toBe(128_000)
      expect(models[0].maxOutputTokens).toBe(4096)
    })

    it('merges parameter support and provider pricing overrides into the runtime baseline', () => {
      const model = mergePresetModel(
        {
          id: 'gpt-4o',
          name: 'GPT-4o',
          parameterSupport: {
            temperature: { supported: true },
            topP: { supported: true },
            topK: { supported: false },
            frequencyPenalty: true,
            presencePenalty: true,
            maxTokens: true,
            stopSequences: true,
            systemMessage: true
          },
          pricing: {
            input: { perMillionTokens: 5 },
            output: { perMillionTokens: 15 }
          }
        } as any,
        {
          providerId: 'openai',
          modelId: 'gpt-4o',
          parameterSupport: { temperature: { supported: false } },
          pricing: { output: { perMillionTokens: 12 } }
        } as any,
        'openai'
      )

      expect(model.parameterSupport).toMatchObject({
        temperature: { supported: false },
        topP: { supported: true },
        maxTokens: true
      })
      expect(model.pricing).toMatchObject({
        input: { perMillionTokens: 5 },
        output: { perMillionTokens: 12 }
      })
    })

    it('uses a persisted presetProviderId for lookup and catalog models while keeping runtime identities', async () => {
      setupRegistryData()
      await dbh.db.insert(userProviderTable).values({
        providerId: 'custom-openai-models',
        presetProviderId: 'openai',
        name: 'Custom OpenAI',
        orderKey: generateOrderKeyBetween(null, null)
      })

      const resolved = providerRegistryService.resolveModels('custom-openai-models', ['gpt-4o'])
      const catalog = providerRegistryService.listProviderRegistryModels({ providerId: 'custom-openai-models' })

      expect(resolved[0]).toMatchObject({
        id: 'custom-openai-models::gpt-4o',
        providerId: 'custom-openai-models',
        presetModelId: 'gpt-4o'
      })
      expect(catalog[0]).toMatchObject({
        id: 'custom-openai-models::gpt-4o',
        providerId: 'custom-openai-models',
        presetModelId: 'gpt-4o'
      })
    })

    it('does not apply provider-specific registry data when a custom row collides with a registry id', async () => {
      setupRegistryData()
      await dbh.db.insert(userProviderTable).values({
        providerId: 'openai',
        presetProviderId: null,
        name: 'User OpenAI Relay',
        orderKey: generateOrderKeyBetween(null, null)
      })

      const lookup = providerRegistryService.lookupModel('openai', 'gpt-4o')
      const catalog = providerRegistryService.listProviderRegistryModels({
        providerId: 'openai',
        presetProviderId: null
      })

      expect(lookup.presetModel?.id).toBe('gpt-4o')
      expect(lookup.registryOverride).toBeNull()
      expect(catalog).toEqual([])
    })

    it('should handle models not in registry', async () => {
      setupRegistryData()

      const models = providerRegistryService.resolveModels('openai', ['custom-model', 'qwen1.5-1.8b-chat'])

      expect(models).toHaveLength(2)
      // An unmatched id is prettified for display (split on `-`, title-cased) instead of shown raw.
      expect(models[0].name).toBe('Custom Model')
      // …but the raw id is preserved as the wire apiModelId.
      expect(models[0].apiModelId).toBe('custom-model')
      expect(models[1].name).toBe('Qwen1.5 1.8b Chat')
      expect(models[1].apiModelId).toBe('qwen1.5-1.8b-chat')
    })

    it('does not infer controls when a preset model fails the reasoning membership gate', () => {
      mockReadModels.mockReturnValue({
        version: '1.0',
        models: [
          {
            id: 'qwen3-coder',
            name: 'Qwen3 Coder',
            capabilities: ['function-call']
          }
        ]
      } as ReturnType<typeof readModelRegistry>)
      mockReadProviderModels.mockReturnValue({
        version: '1.0',
        overrides: [{ providerId: 'openai', modelId: 'qwen3-coder' }]
      } as ReturnType<typeof readProviderModelRegistry>)
      mockReadProviders.mockReturnValue({
        version: '1.0',
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: {
              'openai-chat-completions': {
                adapterFamily: 'openai-compatible',
                reasoningFormat: { type: 'openai-chat' }
              }
            },
            metadata: {}
          }
        ]
      } as ReturnType<typeof readProviderRegistry>)

      const [model] = providerRegistryService.resolveModels('openai', ['qwen3-coder'])

      expect(model.reasoning).toBeUndefined()
      expect(model.capabilities).not.toContain('reasoning')
    })

    it('should deduplicate by modelId', async () => {
      setupRegistryData()

      const models = providerRegistryService.resolveModels('openai', ['gpt-4o', 'gpt-4o'])

      expect(models).toHaveLength(1)
    })

    it('should fall back to registry defaults when provider is not found in the DB', async () => {
      setupRegistryData()

      const result = providerRegistryService.lookupModel('openai', 'gpt-4o')

      expect(result.reasoningProfile.format).toBe('openai-chat')
      expect(result.presetModel?.id).toBe('gpt-4o')
    })

    it('should rethrow provider lookup errors instead of silently using registry defaults', async () => {
      setupRegistryData()
      const error = new Error('database offline')
      const loggerSpy = vi.spyOn(mockMainLoggerService, 'error').mockImplementation(() => {})
      const providerSpy = vi.spyOn(providerService, 'getByProviderId').mockImplementationOnce(() => {
        throw error
      })

      expect(() => providerRegistryService.resolveModels('openai', ['gpt-4o'])).toThrow('database offline')

      expect(loggerSpy).toHaveBeenCalledWith('Failed to fetch provider for reasoning profile', error)
      providerSpy.mockRestore()
    })

    it('should reject when a single registry model merge fails instead of returning an incomplete array', async () => {
      setupRegistryData()
      mockReadModels.mockReturnValueOnce({
        version: '1.0',
        models: [
          {
            id: 'broken-model',
            name: 'Broken',
            capabilities: ['function-call'],
            reasoning: {}
          }
        ]
      } as ReturnType<typeof readModelRegistry>)
      mockReadProviderModels.mockReturnValueOnce({
        version: '1.0',
        overrides: [
          {
            providerId: 'openai',
            modelId: 'broken-model',
            replaceWith: Symbol('invalid-replacement') as unknown as string
          }
        ]
      } as ReturnType<typeof readProviderModelRegistry>)
      mockReadProviders.mockReturnValueOnce({
        version: '1.0',
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            metadata: {},
            endpointConfigs: {
              'openai-chat-completions': { reasoningFormat: { type: 'openai-chat' } }
            },
            defaultChatEndpoint: 'openai-chat-completions'
          }
        ]
      } as unknown as ReturnType<typeof readProviderRegistry>)

      expect(() => providerRegistryService.resolveModels('openai', ['broken-model'])).toThrow()
    })

    // ── Regression: normalize fallback ────────────────────────────────────────
    // These two cases previously returned a bare custom model (name === modelId)
    // because lookupRegistryModel only did an exact-match lookup. The normalize
    // fallback was added to handle aggregator prefixes and colon-variant suffixes.

    it('should resolve model with variant suffix via normalize fallback (gpt-4o:free → gpt-4o)', async () => {
      setupRegistryData()

      // 'gpt-4o:free' is not in the registry verbatim, but normalizeModelId strips
      // the ':free' colon-variant suffix, leaving 'gpt-4o' which IS in the registry.
      const models = providerRegistryService.resolveModels('openai', ['gpt-4o:free'])

      expect(models).toHaveLength(1)
      // Carries the registry display name, with the `:free` variant appended so it stays distinguishable
      // from the bare `gpt-4o` row; the raw id is preserved as the wire apiModelId.
      expect(models[0].name).toBe('GPT-4o (free)')
      expect(models[0].apiModelId).toBe('gpt-4o:free')
    })

    it('should resolve model with aggregator prefix via normalize fallback (aihubmix-gpt-4o → gpt-4o)', async () => {
      setupRegistryData()

      // 'aihubmix-gpt-4o' has the 'aihubmix-' aggregator prefix. normalizeModelId
      // strips it, leaving 'gpt-4o' which matches the registry entry.
      const models = providerRegistryService.resolveModels('openai', ['aihubmix-gpt-4o'])

      expect(models).toHaveLength(1)
      expect(models[0].name).toBe('GPT-4o')
    })

    it('preserves provider display names and exact apiModelId identities for same-canonical variants', async () => {
      // A provider serving one canonical model under several apiModelIds (tokenhub's dated 原厂直供 variants).
      mockReadModels.mockReturnValue({
        version: '1.0',
        models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', capabilities: ['function-call'] }]
      } as ReturnType<typeof readModelRegistry>)
      mockReadProviderModels.mockReturnValue({
        version: '1.0',
        overrides: [
          { providerId: 'tokenhub', modelId: 'deepseek-v4-flash', apiModelId: 'deepseek-v4-flash' },
          {
            providerId: 'tokenhub',
            modelId: 'deepseek-v4-flash',
            apiModelId: 'deepseek-v4-flash-202605',
            name: 'DeepSeek-V4-Flash 原厂直供'
          }
        ]
      } as ReturnType<typeof readProviderModelRegistry>)
      mockReadProviders.mockReturnValue({
        version: '1.0',
        providers: [
          {
            id: 'tokenhub',
            name: 'TokenHub',
            endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://tokenhub.tencentmaas.com/v1' } },
            defaultChatEndpoint: 'openai-chat-completions',
            metadata: { website: { official: 'https://cloud.tencent.com/product/tokenhub' } }
          }
        ]
      } as ReturnType<typeof readProviderRegistry>)

      const [dated] = providerRegistryService.resolveModels('tokenhub', ['deepseek-v4-flash-202605'])
      const catalog = providerRegistryService.listProviderRegistryModels({ providerId: 'tokenhub' })

      expect(
        catalog.map((model) => ({
          apiModelId: model.apiModelId,
          name: model.name
        }))
      ).toEqual([
        { apiModelId: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
        { apiModelId: 'deepseek-v4-flash-202605', name: 'DeepSeek-V4-Flash 原厂直供' }
      ])
      // unique id rebuilt from the apiModelId (NOT collapsed to the canonical tokenhub::deepseek-v4-flash)
      expect(dated.id).toBe(createUniqueModelId('tokenhub', 'deepseek-v4-flash-202605'))
      expect(dated.apiModelId).toBe('deepseek-v4-flash-202605')
      expect(dated.name).toBe('DeepSeek-V4-Flash 原厂直供')
      expect(dated.presetModelId).toBe('deepseek-v4-flash') // canonical preset preserved for metadata
    })

    it('distinguishes fuzzy-matched siblings by name while keeping each raw id as the wire apiModelId', () => {
      mockReadModels.mockReturnValue({
        version: '1.0',
        models: [
          { id: 'minimax-m2-1', name: 'MiniMax M2.1', capabilities: ['function-call'] },
          { id: 'qwen-plus', name: 'Qwen-Plus', capabilities: ['function-call'] }
        ]
      } as ReturnType<typeof readModelRegistry>)
      mockReadProviderModels.mockReturnValue({
        version: '1.0',
        overrides: [
          { providerId: 'dashscope', modelId: 'minimax-m2-1', apiModelId: 'MiniMax-M2.1' },
          { providerId: 'dashscope', modelId: 'qwen-plus' }
        ]
      } as ReturnType<typeof readProviderModelRegistry>)
      mockReadProviders.mockReturnValue({
        version: '1.0',
        providers: [
          {
            id: 'dashscope',
            name: 'Bailian',
            endpointConfigs: {
              'openai-chat-completions': { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/' }
            },
            defaultChatEndpoint: 'openai-chat-completions',
            metadata: { website: { official: 'https://www.aliyun.com/product/bailian' } }
          }
        ]
      } as ReturnType<typeof readProviderRegistry>)

      const [self, vendor, dotted, dated] = providerRegistryService.resolveModels('dashscope', [
        'MiniMax-M2.1',
        'MiniMax/MiniMax-M2.1',
        'MiniMax.MiniMax-M2.1',
        'qwen-plus-2025-12-01'
      ])

      // exact apiModelId match → curated name verbatim
      expect(self.name).toBe('MiniMax M2.1')
      expect(self.apiModelId).toBe('MiniMax-M2.1')
      // fuzzy match via slash vendor prefix → distinguished, raw id preserved for routing
      expect(vendor.name).toBe('MiniMax: MiniMax M2.1')
      expect(vendor.apiModelId).toBe('MiniMax/MiniMax-M2.1')
      expect(vendor.id).toBe(createUniqueModelId('dashscope', 'MiniMax/MiniMax-M2.1'))
      // a dotted vendor prefix normalizes away just like the slash form, so it must decorate too —
      // otherwise this collapses onto the bare sibling's name despite being a distinct SKU
      expect(dotted.name).toBe('MiniMax: MiniMax M2.1')
      expect(dotted.apiModelId).toBe('MiniMax.MiniMax-M2.1')
      expect(dotted.id).toBe(createUniqueModelId('dashscope', 'MiniMax.MiniMax-M2.1'))
      // fuzzy match via dated snapshot → date appended, raw id preserved
      expect(dated.name).toBe('Qwen-Plus (2025-12-01)')
      expect(dated.apiModelId).toBe('qwen-plus-2025-12-01')
    })

    it('decorates a multi-segment Bedrock ARN prefix and its revision', () => {
      mockReadModels.mockReturnValue({
        version: '1.0',
        models: [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', capabilities: ['function-call'] }]
      } as ReturnType<typeof readModelRegistry>)
      mockReadProviderModels.mockReturnValue({
        version: '1.0',
        overrides: [{ providerId: 'aws-bedrock', modelId: 'claude-sonnet-4-5' }]
      } as ReturnType<typeof readProviderModelRegistry>)
      mockReadProviders.mockReturnValue({
        version: '1.0',
        providers: [
          {
            id: 'aws-bedrock',
            name: 'AWS Bedrock',
            endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://bedrock.example/v1/' } },
            defaultChatEndpoint: 'openai-chat-completions',
            metadata: { website: { official: 'https://aws.amazon.com/bedrock/' } }
          }
        ]
      } as ReturnType<typeof readProviderRegistry>)

      const [regional] = providerRegistryService.resolveModels('aws-bedrock', ['us.anthropic.claude-sonnet-4-5-v1:0'])

      expect(regional.name).toBe('us.anthropic: Claude Sonnet 4.5 (v1:0)')
      expect(regional.apiModelId).toBe('us.anthropic.claude-sonnet-4-5-v1:0')
    })

    it('getImageGenerationSupport returns the model block when present', async () => {
      const block = {
        modes: {
          generate: { supports: { size: { type: 'enum' as const, options: ['1024x1024'], render: 'chips' as const } } }
        }
      }
      mockReadModels.mockReturnValue({
        version: '1.0',
        models: [{ id: 'sd-1-5', name: 'SD 1.5', imageGeneration: block }]
      } as ReturnType<typeof readModelRegistry>)
      mockReadProviderModels.mockReturnValue({ version: '1.0', overrides: [] } as ReturnType<
        typeof readProviderModelRegistry
      >)
      mockReadProviders.mockReturnValue({
        version: '1.0',
        providers: [
          {
            id: 'ovms',
            name: 'OVMS',
            defaultChatEndpoint: null,
            metadata: { website: { official: 'https://openvino.ai' } }
          }
        ]
      } as ReturnType<typeof readProviderRegistry>)
      const result = providerRegistryService.getImageGenerationSupport('ovms', 'sd-1-5')
      expect(result).toEqual(block)
    })

    it('getImageGenerationSupport resolves a custom provider through its persisted presetProviderId', async () => {
      const block = { modes: { generate: { supports: {} } } }
      mockReadModels.mockReturnValue({
        version: '1.0',
        models: [{ id: 'image-model', name: 'Image Model', imageGeneration: block }]
      } as ReturnType<typeof readModelRegistry>)
      mockReadProviderModels.mockReturnValue({
        version: '1.0',
        overrides: [{ providerId: 'openai', modelId: 'image-model' }]
      } as ReturnType<typeof readProviderModelRegistry>)
      mockReadProviders.mockReturnValue({
        version: '1.0',
        providers: [{ id: 'openai', name: 'OpenAI', defaultChatEndpoint: null, metadata: {} }]
      } as ReturnType<typeof readProviderRegistry>)
      await dbh.db.insert(userProviderTable).values({
        providerId: 'custom-openai-image',
        presetProviderId: 'openai',
        name: 'Custom OpenAI Image',
        orderKey: generateOrderKeyBetween(null, null)
      })

      expect(providerRegistryService.getImageGenerationSupport('custom-openai-image', 'image-model')).toEqual(block)
    })

    it('getImageGenerationSupport returns null when the model is unknown', async () => {
      mockReadModels.mockReturnValue({ version: '1.0', models: [] } as ReturnType<typeof readModelRegistry>)
      mockReadProviderModels.mockReturnValue({ version: '1.0', overrides: [] } as ReturnType<
        typeof readProviderModelRegistry
      >)
      mockReadProviders.mockReturnValue({
        version: '1.0',
        providers: [
          {
            id: 'ovms',
            name: 'OVMS',
            defaultChatEndpoint: null,
            metadata: { website: { official: 'https://openvino.ai' } }
          }
        ]
      } as ReturnType<typeof readProviderRegistry>)
      const result = providerRegistryService.getImageGenerationSupport('ovms', 'user-custom-sd')
      expect(result).toBeNull()
    })

    it('getImageGenerationSupport returns null when neither model nor provider has the block', async () => {
      setupRegistryData()
      const result = providerRegistryService.getImageGenerationSupport('openai', 'gpt-4o')
      expect(result).toBeNull()
    })

    it('lists provider-declared registry models by disabled flag', async () => {
      mockReadModels.mockReturnValue({
        version: '1.0',
        models: [
          {
            id: 'qwen-image',
            name: 'Qwen Image',
            capabilities: ['image-generation'],
            imageGeneration: { modes: ['generate'] }
          },
          {
            id: 'text-model',
            name: 'Text Model',
            capabilities: ['function-call']
          }
        ]
      } as ReturnType<typeof readModelRegistry>)
      mockReadProviderModels.mockReturnValue({
        version: '1.0',
        overrides: [
          {
            providerId: 'silicon',
            modelId: 'qwen-image',
            apiModelId: 'Qwen/Qwen-Image'
          },
          {
            providerId: 'silicon',
            modelId: 'text-model'
          },
          {
            providerId: 'cherryin',
            modelId: 'qwen-image',
            disabled: true
          }
        ]
      } as ReturnType<typeof readProviderModelRegistry>)
      mockReadProviders.mockReturnValue({
        version: '1.0',
        providers: [
          {
            id: 'silicon',
            name: 'Silicon',
            defaultChatEndpoint: null,
            metadata: {}
          },
          {
            id: 'cherryin',
            name: 'CherryIN',
            defaultChatEndpoint: null,
            metadata: {}
          }
        ]
      } as ReturnType<typeof readProviderRegistry>)

      const active = providerRegistryService.listProviderRegistryModels({ providerId: 'silicon' })
      const disabled = providerRegistryService.listProviderRegistryModels({ disabled: true })

      expect(active.map((item) => `${item.providerId}:${item.presetModelId}:${item.apiModelId}`)).toEqual([
        'silicon:qwen-image:Qwen/Qwen-Image',
        'silicon:text-model:text-model'
      ])
      expect(disabled.map((item) => `${item.providerId}:${item.presetModelId}:${item.apiModelId}`)).toEqual([
        'cherryin:qwen-image:qwen-image'
      ])
    })

    it('lists the seven Radeon Cloud provider-registry models', () => {
      const readGeneratedRegistry = <T>(filename: string): T =>
        JSON.parse(
          readFileSync(new URL(`../../../../../packages/provider-registry/data/${filename}`, import.meta.url), 'utf8')
        ) as T
      mockReadModels.mockReturnValue(readGeneratedRegistry<ReturnType<typeof readModelRegistry>>('models.json'))
      mockReadProviderModels.mockReturnValue(
        readGeneratedRegistry<ReturnType<typeof readProviderModelRegistry>>('provider-models.json')
      )
      mockReadProviders.mockReturnValue(
        readGeneratedRegistry<ReturnType<typeof readProviderRegistry>>('providers.json')
      )

      const models = providerRegistryService.listProviderRegistryModels({ providerId: 'radeon-cloud' })

      expect(models.map(({ presetModelId, apiModelId }) => [presetModelId, apiModelId])).toEqual([
        ['deepseek-v4-flash', 'DeepSeek-V4-Flash'],
        ['deepseek-v4-pro', 'DeepSeek-V4-Pro'],
        ['glm-5-1', 'GLM-5.1'],
        ['glm-5-2', 'GLM-5.2'],
        ['gpt-oss-120b', 'gpt-oss-120b'],
        ['kimi-k2-6', 'Kimi-K2.6'],
        ['qwen3-6-35b-a3b', 'Qwen3.6-35B-A3B']
      ])
    })

    it('a standalone override (no models.json entry) only carries image-generation capability when it declares capabilities.force', async () => {
      // Regression: a vendor-exclusive override (e.g. Ollama's x/z-image-turbo) that sets
      // imageGeneration but omits `capabilities` synthesizes with capabilities: [] — invisible to
      // the Paintings model filter, which requires the image-generation capability.
      mockReadModels.mockReturnValue({ version: '1.0', models: [] } as ReturnType<typeof readModelRegistry>)
      mockReadProviderModels.mockReturnValue({
        version: '1.0',
        overrides: [
          {
            providerId: 'ollama',
            modelId: 'x/z-image-turbo',
            apiModelId: 'x/z-image-turbo',
            name: 'Z-Image Turbo',
            capabilities: { force: ['image-generation'] },
            outputModalities: ['image'],
            imageGeneration: { modes: { generate: { supports: {} } } }
          },
          {
            providerId: 'ollama',
            modelId: 'x/no-capability',
            apiModelId: 'x/no-capability',
            name: 'No Capability',
            outputModalities: ['image'],
            imageGeneration: { modes: { generate: { supports: {} } } }
          }
        ]
      } as ReturnType<typeof readProviderModelRegistry>)
      mockReadProviders.mockReturnValue({
        version: '1.0',
        providers: [{ id: 'ollama', name: 'Ollama', defaultChatEndpoint: null, metadata: {} }]
      } as ReturnType<typeof readProviderRegistry>)

      const models = providerRegistryService.listProviderRegistryModels({ providerId: 'ollama' })

      expect(models.find((m) => m.apiModelId === 'x/z-image-turbo')?.capabilities).toEqual(['image-generation'])
      expect(models.find((m) => m.apiModelId === 'x/no-capability')?.capabilities).toEqual([])
    })

    it('lists provider-declared registry models without reading provider rows from DB', async () => {
      setupRegistryData()
      const providerSpy = vi.spyOn(providerService, 'getByProviderId').mockImplementationOnce(() => {
        throw new Error('DB unavailable')
      })

      const models = providerRegistryService.listProviderRegistryModels({ providerId: 'openai' })

      expect(models.map((model) => model.id)).toEqual(['openai::gpt-4o'])
      expect(providerSpy).not.toHaveBeenCalled()
      providerSpy.mockRestore()
    })

    it('looks up provider API model ids through provider-models overrides', async () => {
      mockReadModels.mockReturnValue({
        version: '1.0',
        models: [
          {
            id: 'qwen-image',
            name: 'Qwen Image',
            capabilities: ['image-generation']
          }
        ]
      } as ReturnType<typeof readModelRegistry>)
      mockReadProviderModels.mockReturnValue({
        version: '1.0',
        overrides: [
          {
            providerId: 'silicon',
            modelId: 'qwen-image',
            apiModelId: 'Qwen/Qwen-Image'
          }
        ]
      } as ReturnType<typeof readProviderModelRegistry>)
      mockReadProviders.mockReturnValue({
        version: '1.0',
        providers: [
          {
            id: 'silicon',
            name: 'Silicon',
            defaultChatEndpoint: null,
            metadata: {}
          }
        ]
      } as ReturnType<typeof readProviderRegistry>)

      const result = providerRegistryService.lookupModel('silicon', 'Qwen/Qwen-Image')

      expect(result.presetModel?.id).toBe('qwen-image')
      expect(result.registryOverride?.modelId).toBe('qwen-image')
      expect(result.registryOverride?.apiModelId).toBe('Qwen/Qwen-Image')
    })

    it('should ignore a legacy persisted reasoningFormatType field', async () => {
      setupRegistryData()
      await dbh.db.insert(userProviderTable).values({
        providerId: 'openai',
        presetProviderId: 'openai',
        name: 'OpenAI',
        defaultChatEndpoint: 'openai-chat-completions',
        endpointConfigs: {
          'openai-chat-completions': {
            baseUrl: 'https://proxy.example/v1',
            reasoningFormatType: 'openai-responses'
          }
        } as never,
        orderKey: generateOrderKeyBetween(null, null)
      })

      const result = providerRegistryService.lookupModel('openai', 'gpt-4o')

      expect(result.reasoningProfile.format).toBe('openai-chat')
    })

    it('resolves a self-hosted reasoning format from a custom provider endpoint config', async () => {
      setupRegistryData()
      await dbh.db.insert(userProviderTable).values({
        providerId: 'custom-relay',
        presetProviderId: null,
        name: 'Custom Relay',
        defaultChatEndpoint: 'openai-chat-completions',
        endpointConfigs: {
          'openai-chat-completions': {
            baseUrl: 'https://relay.example/v1',
            reasoningFormat: { type: 'self-hosted' }
          }
        } as never,
        orderKey: generateOrderKeyBetween(null, null)
      })

      const result = providerRegistryService.lookupModel('custom-relay', 'qwen3-5')

      expect(result.reasoningProfile.format).toBe('self-hosted')
      expect(result.reasoningProfile.wire.auto?.operations).toEqual([
        { target: 'chat_template_kwargs.enable_thinking', value: { source: 'literal', value: true } },
        { target: 'chat_template_kwargs.thinking_budget', value: { source: 'budget' } }
      ])
      expect(result.reasoningProfile.wire.off?.operations).toEqual([
        { target: 'chat_template_kwargs.enable_thinking', value: { source: 'literal', value: false } }
      ])
    })

    it('keeps the default openai-chat format when a custom provider has no reasoningFormat', async () => {
      setupRegistryData()
      await dbh.db.insert(userProviderTable).values({
        providerId: 'custom-relay',
        presetProviderId: null,
        name: 'Custom Relay',
        defaultChatEndpoint: 'openai-chat-completions',
        endpointConfigs: {
          'openai-chat-completions': {
            baseUrl: 'https://relay.example/v1'
          }
        } as never,
        orderKey: generateOrderKeyBetween(null, null)
      })

      const result = providerRegistryService.lookupModel('custom-relay', 'qwen3-5')

      expect(result.reasoningProfile.format).toBe('openai-chat')
    })
  })
})
