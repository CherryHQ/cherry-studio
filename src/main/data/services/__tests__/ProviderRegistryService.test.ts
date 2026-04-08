import { beforeEach, describe, expect, it, vi } from 'vitest'

// Create a chainable mock DB that resolves to an empty array
// when awaited (Drizzle queries are thenable).
function createChainableMockDb() {
  const emptyResult: unknown[] = []

  const makeChainable = (): unknown => {
    const obj: Record<string, unknown> = {}
    // Every method returns another chainable
    for (const method of ['select', 'from', 'where', 'limit', 'insert', 'values', 'onConflictDoUpdate', 'all', 'get']) {
      obj[method] = vi.fn(() => makeChainable())
    }
    obj.transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeChainable()))
    // Make thenable so `await db.select().from(...)` resolves to []
    obj.then = (resolve: (v: unknown) => void) => resolve(emptyResult)
    return obj
  }

  return makeChainable()
}

const mockDb = createChainableMockDb()

// Mock application before importing the service
vi.mock('@main/core/application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'DbService') return { getDb: () => mockDb }
      throw new Error(`Unknown service: ${name}`)
    }),
    getPath: vi.fn((_key: string, filename?: string) => {
      const base = '/mock/registry/data'
      return filename ? `${base}/${filename}` : base
    })
  }
}))

// Mock provider-registry/node readers
vi.mock('@cherrystudio/provider-registry/node', () => ({
  readModelRegistry: vi.fn(),
  readProviderModelRegistry: vi.fn(),
  readProviderRegistry: vi.fn()
}))

// Mock downstream services
vi.mock('../ModelService', () => ({
  modelService: { batchUpsert: vi.fn() }
}))

vi.mock('../ProviderService', () => ({
  providerService: { batchUpsert: vi.fn() }
}))

import {
  readModelRegistry,
  readProviderModelRegistry,
  readProviderRegistry
} from '@cherrystudio/provider-registry/node'

import { providerService } from '../ProviderService'

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
  svc['registryModels'] = null
  svc['registryProviderModels'] = null
  svc['registryProviders'] = null
}

describe('ProviderRegistryService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearServiceCache()
  })

  describe('initialize', () => {
    it('should seed preset providers with correct structure', async () => {
      setupRegistryData()

      await providerRegistryService.initialize()

      expect(mockReadProviders).toHaveBeenCalled()
      const batchUpsertMock = vi.mocked(providerService.batchUpsert)
      expect(batchUpsertMock).toHaveBeenCalledTimes(1)

      const upsertedProviders = batchUpsertMock.mock.calls[0][0]
      const openaiProvider = upsertedProviders.find((p) => p.providerId === 'openai')
      expect(openaiProvider).toBeDefined()
      expect(openaiProvider!.name).toBe('OpenAI')
      expect(openaiProvider!.presetProviderId).toBe('openai')
      expect(openaiProvider!.defaultChatEndpoint).toBe('openai-chat-completions')
    })
  })

  describe('registry load failure', () => {
    it('should throw when models.json cannot be read', () => {
      mockReadModels.mockImplementation(() => {
        throw new Error('ENOENT: no such file')
      })

      expect(() => providerRegistryService.getRegistryModelsByProvider('openai')).toThrow('ENOENT')
    })

    it('should throw when providers.json cannot be read', async () => {
      mockReadProviders.mockImplementation(() => {
        throw new Error('ENOENT: no such file')
      })

      await expect(providerRegistryService.initialize()).rejects.toThrow('ENOENT')
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

      const models = await providerRegistryService.resolveModels('openai', [{ modelId: 'gpt-4o' }])

      expect(models).toHaveLength(1)
      expect(models[0].name).toBe('GPT-4o')
      expect(models[0].capabilities).toContain('image-recognition')
      expect(models[0].capabilities).toContain('function-call')
      expect(models[0].contextWindow).toBe(128_000)
      expect(models[0].maxOutputTokens).toBe(4096)
    })

    it('should handle models not in registry', async () => {
      setupRegistryData()

      const models = await providerRegistryService.resolveModels('openai', [
        { modelId: 'custom-model', name: 'Custom' }
      ])

      expect(models).toHaveLength(1)
      expect(models[0].name).toBe('Custom')
    })

    it('should deduplicate by modelId', async () => {
      setupRegistryData()

      const models = await providerRegistryService.resolveModels('openai', [
        { modelId: 'gpt-4o' },
        { modelId: 'gpt-4o' }
      ])

      expect(models).toHaveLength(1)
    })
  })
})
