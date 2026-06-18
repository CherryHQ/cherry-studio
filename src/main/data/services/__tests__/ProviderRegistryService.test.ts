/**
 * Tests for ProviderRegistryService.
 * Uses setupTestDatabase() per CLAUDE.md testing guidelines.
 */

import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
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
const { providerRegistryService } = await import('../ProviderRegistryService')

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

  describe('registry load failure', () => {
    it('should throw when models.json cannot be read', async () => {
      setupRegistryData()
      mockReadModels.mockImplementation(() => {
        throw new Error('ENOENT: no such file')
      })

      await expect(providerRegistryService.lookupModel('openai', 'gpt-4o')).rejects.toThrow('ENOENT')
    })

    it('should throw when providers.json cannot be read', async () => {
      setupRegistryData()
      mockReadProviders.mockImplementation(() => {
        throw new Error('ENOENT: no such file')
      })

      await expect(providerRegistryService.lookupModel('openai', 'gpt-4o')).rejects.toThrow('ENOENT')
    })
  })

  describe('cache reuse', () => {
    it('should only read models.json once across multiple calls', async () => {
      setupRegistryData()

      await providerRegistryService.resolveModels('openai', ['gpt-4o'])
      await providerRegistryService.resolveModels('openai', ['gpt-4o'])

      expect(mockReadModels).toHaveBeenCalledTimes(1)
    })
  })

  describe('resolveModels', () => {
    it('should merge raw models with registry data including capabilities and limits', async () => {
      setupRegistryData()

      const models = await providerRegistryService.resolveModels('openai', ['gpt-4o'])

      expect(models).toHaveLength(1)
      expect(models[0].name).toBe('GPT-4o')
      expect(models[0].capabilities).toContain('image-recognition')
      expect(models[0].capabilities).toContain('function-call')
      expect(models[0].contextWindow).toBe(128_000)
      expect(models[0].maxOutputTokens).toBe(4096)
    })

    it('should handle models not in registry', async () => {
      setupRegistryData()

      const models = await providerRegistryService.resolveModels('openai', ['custom-model'])

      expect(models).toHaveLength(1)
      expect(models[0].name).toBe('custom-model')
    })

    it('should deduplicate by modelId', async () => {
      setupRegistryData()

      const models = await providerRegistryService.resolveModels('openai', ['gpt-4o', 'gpt-4o'])

      expect(models).toHaveLength(1)
    })

    it('should fall back to registry defaults when provider is not found in the DB', async () => {
      setupRegistryData()

      const result = await providerRegistryService.lookupModel('openai', 'gpt-4o')

      expect(result.defaultChatEndpoint).toBe('openai-chat-completions')
      expect(result.presetModel?.id).toBe('gpt-4o')
    })

    it('should rethrow provider lookup errors instead of silently using registry defaults', async () => {
      setupRegistryData()
      const error = new Error('database offline')
      const loggerSpy = vi.spyOn(mockMainLoggerService, 'error').mockImplementation(() => {})
      const providerSpy = vi.spyOn(providerService, 'getByProviderId').mockRejectedValueOnce(error)

      await expect(providerRegistryService.resolveModels('openai', ['gpt-4o'])).rejects.toThrow('database offline')

      expect(loggerSpy).toHaveBeenCalledWith('Failed to fetch provider for reasoning config', error)
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
              'openai-chat-completions': { reasoningFormatType: 'openai-chat' }
            },
            defaultChatEndpoint: 'openai-chat-completions'
          }
        ]
      } as unknown as ReturnType<typeof readProviderRegistry>)

      await expect(providerRegistryService.resolveModels('openai', ['broken-model'])).rejects.toThrow()
    })

    // ── Regression: normalize fallback ────────────────────────────────────────
    // These two cases previously returned a bare custom model (name === modelId)
    // because lookupRegistryModel only did an exact-match lookup. The normalize
    // fallback was added to handle aggregator prefixes and colon-variant suffixes.

    it('should resolve model with variant suffix via normalize fallback (gpt-4o:free → gpt-4o)', async () => {
      setupRegistryData()

      // 'gpt-4o:free' is not in the registry verbatim, but normalizeModelId strips
      // the ':free' colon-variant suffix, leaving 'gpt-4o' which IS in the registry.
      const models = await providerRegistryService.resolveModels('openai', ['gpt-4o:free'])

      expect(models).toHaveLength(1)
      // Must carry the registry display name, not the raw model ID
      expect(models[0].name).toBe('GPT-4o')
    })

    it('should resolve model with aggregator prefix via normalize fallback (aihubmix-gpt-4o → gpt-4o)', async () => {
      setupRegistryData()

      // 'aihubmix-gpt-4o' has the 'aihubmix-' aggregator prefix. normalizeModelId
      // strips it, leaving 'gpt-4o' which matches the registry entry.
      const models = await providerRegistryService.resolveModels('openai', ['aihubmix-gpt-4o'])

      expect(models).toHaveLength(1)
      expect(models[0].name).toBe('GPT-4o')
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
      const result = await providerRegistryService.getImageGenerationSupport('ovms', 'sd-1-5')
      expect(result).toEqual(block)
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
      const result = await providerRegistryService.getImageGenerationSupport('ovms', 'user-custom-sd')
      expect(result).toBeNull()
    })

    it('getImageGenerationSupport returns null when neither model nor provider has the block', async () => {
      setupRegistryData()
      const result = await providerRegistryService.getImageGenerationSupport('openai', 'gpt-4o')
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

      const active = await providerRegistryService.listProviderRegistryModels({ providerId: 'silicon' })
      const disabled = await providerRegistryService.listProviderRegistryModels({ disabled: true })

      expect(active.map((item) => `${item.providerId}:${item.presetModelId}:${item.apiModelId}`)).toEqual([
        'silicon:qwen-image:Qwen/Qwen-Image',
        'silicon:text-model:text-model'
      ])
      expect(disabled.map((item) => `${item.providerId}:${item.presetModelId}:${item.apiModelId}`)).toEqual([
        'cherryin:qwen-image:qwen-image'
      ])
    })

    it('lists provider-declared registry models without reading provider rows from DB', async () => {
      setupRegistryData()
      const providerSpy = vi
        .spyOn(providerService, 'getByProviderId')
        .mockRejectedValueOnce(new Error('DB unavailable'))

      const models = await providerRegistryService.listProviderRegistryModels({ providerId: 'openai' })

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

      const result = await providerRegistryService.lookupModel('silicon', 'Qwen/Qwen-Image')

      expect(result.presetModel?.id).toBe('qwen-image')
      expect(result.registryOverride?.modelId).toBe('qwen-image')
      expect(result.registryOverride?.apiModelId).toBe('Qwen/Qwen-Image')
    })

    it('should prefer persisted provider endpoint config over registry reasoning defaults', async () => {
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
        },
        orderKey: generateOrderKeyBetween(null, null)
      })

      const result = await providerRegistryService.lookupModel('openai', 'gpt-4o')

      expect(result.defaultChatEndpoint).toBe('openai-chat-completions')
      expect(result.reasoningFormatTypes).toMatchObject({
        'openai-chat-completions': 'openai-responses'
      })
    })
  })
})
