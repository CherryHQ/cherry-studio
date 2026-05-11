/**
 * Tests for ProviderRegistryService.
 * Uses the unified mock system per CLAUDE.md testing guidelines.
 */

import { DataApiErrorFactory } from '@shared/data/api'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockMainLoggerService } from '../../../../../tests/__mocks__/MainLoggerService'

// ─────────────────────────────────────────────────────────────────────────────
// Chainable DB mock (Drizzle queries are thenable)
// ─────────────────────────────────────────────────────────────────────────────

function createChainableMockDb() {
  const emptyResult: unknown[] = []

  const makeChainable = (): unknown => {
    const obj: Record<string, unknown> = {}
    for (const method of ['select', 'from', 'where', 'limit', 'insert', 'values', 'onConflictDoUpdate', 'all', 'get']) {
      obj[method] = vi.fn(() => makeChainable())
    }
    obj.transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeChainable()))
    obj.then = (resolve: (v: unknown) => void) => resolve(emptyResult)
    return obj
  }

  return makeChainable()
}

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
      for (const pm of this.cachedProviderModels!) {
        this.overrideByKey.set(`${pm.providerId}::${pm.modelId}`, pm)
        const nk = `${pm.providerId}::${normalize(pm.modelId)}`
        if (!this.overrideByNormKey.has(nk)) this.overrideByNormKey.set(nk, pm)
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
  }

  return { readModelRegistry, readProviderModelRegistry, readProviderRegistry, RegistryLoader }
})

vi.mock('../ModelService', () => ({
  modelService: { batchUpsert: vi.fn() }
}))

const mockGetByProviderId = vi.fn()

vi.mock('../ProviderService', () => ({
  providerService: {
    getByProviderId: mockGetByProviderId
  }
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
  const svc = providerRegistryService as unknown as Record<string, unknown>
  svc['loader'] = null
}

describe('ProviderRegistryService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearServiceCache()
    MockMainDbServiceUtils.setDb(createChainableMockDb())
    mockGetByProviderId.mockRejectedValue(DataApiErrorFactory.notFound('Provider', 'openai'))
  })

  describe('registry load failure', () => {
    it('should throw when models.json cannot be read', () => {
      setupRegistryData()
      mockReadModels.mockImplementation(() => {
        throw new Error('ENOENT: no such file')
      })

      expect(() => providerRegistryService.getRegistryModelsByProvider('openai')).toThrow('ENOENT')
    })

    it('should throw when providers.json cannot be read', () => {
      setupRegistryData()
      mockReadProviders.mockImplementation(() => {
        throw new Error('ENOENT: no such file')
      })

      expect(() => providerRegistryService.getRegistryModelsByProvider('openai')).toThrow('ENOENT')
    })
  })

  describe('cache reuse', () => {
    it('should only read models.json once across multiple calls', () => {
      setupRegistryData()

      providerRegistryService.getRegistryModelsByProvider('openai')
      providerRegistryService.getRegistryModelsByProvider('openai')

      expect(mockReadModels).toHaveBeenCalledTimes(1)
    })
  })

  describe('getRegistryModelsByProvider', () => {
    it('should return merged models for a known provider', () => {
      setupRegistryData()

      const models = providerRegistryService.getRegistryModelsByProvider('openai')

      expect(models).toHaveLength(1)
      expect(models[0].id).toContain('gpt-4o')
      expect(models[0].name).toBe('GPT-4o')
    })

    it('should return empty array for unknown provider', () => {
      setupRegistryData()

      const models = providerRegistryService.getRegistryModelsByProvider('unknown-provider')

      expect(models).toHaveLength(0)
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
      mockGetByProviderId.mockRejectedValueOnce(DataApiErrorFactory.notFound('Provider', 'openai'))

      const result = await providerRegistryService.lookupModel('openai', 'gpt-4o')

      expect(result.defaultChatEndpoint).toBe('openai-chat-completions')
      expect(result.presetModel?.id).toBe('gpt-4o')
    })

    it('should rethrow provider lookup errors instead of silently using registry defaults', async () => {
      setupRegistryData()
      const error = new Error('database offline')
      const loggerSpy = vi.spyOn(mockMainLoggerService, 'error').mockImplementation(() => {})
      mockGetByProviderId.mockRejectedValueOnce(error)

      await expect(providerRegistryService.resolveModels('openai', ['gpt-4o'])).rejects.toThrow('database offline')

      expect(loggerSpy).toHaveBeenCalledWith('Failed to fetch provider for reasoning config', error)
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
  })
})
