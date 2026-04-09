/**
 * Tests for enrichExistingModels — verifies field completeness
 * during the preset→user_model enrichment pipeline.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Sequential DB mock: returns resultSets in order for each awaited query
function createSequentialMockDb(...resultSets: unknown[][]) {
  let callIndex = 0
  const makeChainable = (): unknown => {
    const obj: Record<string, unknown> = {}
    for (const method of ['select', 'from', 'where', 'limit', 'insert', 'values', 'onConflictDoUpdate', 'all', 'get']) {
      obj[method] = vi.fn(() => makeChainable())
    }
    obj.transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeChainable()))
    obj.then = (resolve: (v: unknown) => void) => {
      const result = resultSets[callIndex] ?? []
      callIndex++
      resolve(result)
    }
    return obj
  }
  return makeChainable()
}

let mockDbFactory: (() => unknown) | null = null

vi.mock('@main/core/application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'DbService') return { getDb: () => (mockDbFactory ? mockDbFactory() : createSequentialMockDb()) }
      throw new Error(`Unknown service: ${name}`)
    }),
    getPath: vi.fn((_key: string, filename?: string) => {
      const base = '/mock/registry/data'
      return filename ? `${base}/${filename}` : base
    })
  }
}))

vi.mock('@cherrystudio/provider-registry/node', () => {
  const readModelRegistry = vi.fn()
  const readProviderModelRegistry = vi.fn()
  const readProviderRegistry = vi.fn()

  class RegistryLoader {
    private paths: { models: string; providers: string; providerModels: string }
    private cachedModels: unknown[] | null = null
    private cachedProviders: unknown[] | null = null
    private cachedProviderModels: unknown[] | null = null
    private ver: string | null = null

    constructor(paths: { models: string; providers: string; providerModels: string }) {
      this.paths = paths
    }
    loadModels() {
      if (this.cachedModels) return this.cachedModels
      const d = readModelRegistry(this.paths.models)
      this.cachedModels = d.models ?? []
      this.ver = d.version
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
      return this.cachedProviderModels
    }
    getModelsVersion() {
      this.loadModels()
      return this.ver!
    }
    clearCache() {
      this.cachedModels = null
      this.cachedProviders = null
      this.cachedProviderModels = null
      this.ver = null
    }
  }

  return { readModelRegistry, readProviderModelRegistry, readProviderRegistry, RegistryLoader }
})

const batchUpsertMock = vi.fn()
vi.mock('../ModelService', () => ({
  modelService: { batchUpsert: batchUpsertMock }
}))

import {
  readModelRegistry,
  readProviderModelRegistry,
  readProviderRegistry
} from '@cherrystudio/provider-registry/node'

const { providerRegistryService } = await import('../ProviderRegistryService')

const mockReadModels = vi.mocked(readModelRegistry)
const mockReadProviderModels = vi.mocked(readProviderModelRegistry)
const mockReadProviders = vi.mocked(readProviderRegistry)

function clearServiceCache() {
  const svc = providerRegistryService as unknown as Record<string, unknown>
  svc['loader'] = null
}

function setupRegistry(models: unknown[], providerModels: unknown[] = [], providers: unknown[] = []) {
  mockReadModels.mockReturnValue({ version: '1.0', models } as any)
  mockReadProviderModels.mockReturnValue({ version: '1.0', overrides: providerModels } as any)
  mockReadProviders.mockReturnValue({ version: '1.0', providers } as any)
}

describe('enrichExistingModels — field completeness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearServiceCache()
    mockDbFactory = null
  })

  it('preset fields flow to batchUpsert when user fields are null', async () => {
    setupRegistry([
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        capabilities: ['image-recognition', 'function-call'],
        inputModalities: ['text', 'image'],
        outputModalities: ['text'],
        contextWindow: 128_000,
        maxOutputTokens: 4096
      }
    ])

    const userModels = [
      {
        providerId: 'openai',
        modelId: 'gpt-4o',
        presetModelId: 'gpt-4o',
        name: null,
        description: null,
        group: null,
        capabilities: null,
        inputModalities: null,
        outputModalities: null,
        endpointTypes: null,
        contextWindow: null,
        maxOutputTokens: null,
        supportsStreaming: null,
        reasoning: null,
        isEnabled: true,
        isHidden: false
      }
    ]
    const providerRows = [{ providerId: 'openai', defaultChatEndpoint: null, endpointConfigs: null }]

    // enrichExistingModels makes 2 DB queries: userModels, then providerRows
    mockDbFactory = () => createSequentialMockDb(userModels, providerRows)

    await providerRegistryService.enrichExistingModels()

    expect(batchUpsertMock).toHaveBeenCalledTimes(1)
    const rows = batchUpsertMock.mock.calls[0][0]
    expect(rows).toHaveLength(1)

    const row = rows[0]
    expect(row.name).toBe('GPT-4o')
    expect(row.capabilities).toEqual(['image-recognition', 'function-call'])
    expect(row.inputModalities).toEqual(['text', 'image'])
    expect(row.outputModalities).toEqual(['text'])
    expect(row.contextWindow).toBe(128_000)
    expect(row.maxOutputTokens).toBe(4096)
    expect(row.presetModelId).toBe('gpt-4o')
  })

  it('normalized ID fallback matches aihubmix-gpt-4o → gpt-4o', async () => {
    setupRegistry([{ id: 'gpt-4o', name: 'GPT-4o', capabilities: [], contextWindow: 128_000 }])

    const userModels = [
      {
        providerId: 'aihubmix',
        modelId: 'aihubmix-gpt-4o',
        presetModelId: 'aihubmix-gpt-4o',
        name: null,
        capabilities: null,
        inputModalities: null,
        outputModalities: null,
        endpointTypes: null,
        contextWindow: null,
        maxOutputTokens: null,
        supportsStreaming: null,
        reasoning: null,
        isEnabled: true,
        isHidden: false
      }
    ]
    const providerRows: unknown[] = []

    mockDbFactory = () => createSequentialMockDb(userModels, providerRows)

    await providerRegistryService.enrichExistingModels()

    expect(batchUpsertMock).toHaveBeenCalledTimes(1)
    const rows = batchUpsertMock.mock.calls[0][0]
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('GPT-4o')
    expect(rows[0].contextWindow).toBe(128_000)
  })

  it('provider override capabilities.add applied during enrichment', async () => {
    setupRegistry(
      [{ id: 'gpt-4o', name: 'GPT-4o', capabilities: ['image-recognition', 'function-call'] }],
      [{ providerId: 'openai', modelId: 'gpt-4o', capabilities: { add: ['reasoning'] } }]
    )

    const userModels = [
      {
        providerId: 'openai',
        modelId: 'gpt-4o',
        presetModelId: 'gpt-4o',
        name: null,
        capabilities: null,
        inputModalities: null,
        outputModalities: null,
        endpointTypes: null,
        contextWindow: null,
        maxOutputTokens: null,
        supportsStreaming: null,
        reasoning: null,
        isEnabled: true,
        isHidden: false
      }
    ]
    const providerRows = [{ providerId: 'openai', defaultChatEndpoint: null, endpointConfigs: null }]

    mockDbFactory = () => createSequentialMockDb(userModels, providerRows)

    await providerRegistryService.enrichExistingModels()

    const rows = batchUpsertMock.mock.calls[0][0]
    expect(rows[0].capabilities).toContain('reasoning')
    expect(rows[0].capabilities).toContain('image-recognition')
    expect(rows[0].capabilities).toContain('function-call')
  })

  it('skipped models counted when no registry match', async () => {
    setupRegistry([{ id: 'gpt-4o', name: 'GPT-4o', capabilities: [] }])

    const userModels = [
      {
        providerId: 'openai',
        modelId: 'gpt-4o',
        presetModelId: 'gpt-4o',
        name: null,
        capabilities: null,
        inputModalities: null,
        outputModalities: null,
        endpointTypes: null,
        contextWindow: null,
        maxOutputTokens: null,
        supportsStreaming: null,
        reasoning: null,
        isEnabled: true,
        isHidden: false
      },
      {
        providerId: 'openai',
        modelId: 'unknown-1',
        presetModelId: 'unknown-1',
        name: null,
        capabilities: null,
        inputModalities: null,
        outputModalities: null,
        endpointTypes: null,
        contextWindow: null,
        maxOutputTokens: null,
        supportsStreaming: null,
        reasoning: null,
        isEnabled: true,
        isHidden: false
      },
      {
        providerId: 'openai',
        modelId: 'unknown-2',
        presetModelId: 'unknown-2',
        name: null,
        capabilities: null,
        inputModalities: null,
        outputModalities: null,
        endpointTypes: null,
        contextWindow: null,
        maxOutputTokens: null,
        supportsStreaming: null,
        reasoning: null,
        isEnabled: true,
        isHidden: false
      }
    ]
    const providerRows = [{ providerId: 'openai', defaultChatEndpoint: null, endpointConfigs: null }]

    mockDbFactory = () => createSequentialMockDb(userModels, providerRows)

    await providerRegistryService.enrichExistingModels()

    expect(batchUpsertMock).toHaveBeenCalledTimes(1)
    const rows = batchUpsertMock.mock.calls[0][0]
    expect(rows).toHaveLength(1) // only gpt-4o matched
  })

  it('empty registry → early return, no batchUpsert', async () => {
    setupRegistry([]) // no models

    await providerRegistryService.enrichExistingModels()

    expect(batchUpsertMock).not.toHaveBeenCalled()
  })

  it('no matching presets → no batchUpsert', async () => {
    setupRegistry([{ id: 'claude-4', name: 'Claude 4', capabilities: [] }])

    const userModels = [
      {
        providerId: 'openai',
        modelId: 'unknown',
        presetModelId: 'unknown',
        name: null,
        capabilities: null,
        inputModalities: null,
        outputModalities: null,
        endpointTypes: null,
        contextWindow: null,
        maxOutputTokens: null,
        supportsStreaming: null,
        reasoning: null,
        isEnabled: true,
        isHidden: false
      }
    ]
    const providerRows: unknown[] = []

    mockDbFactory = () => createSequentialMockDb(userModels, providerRows)

    await providerRegistryService.enrichExistingModels()

    expect(batchUpsertMock).not.toHaveBeenCalled()
  })
})
