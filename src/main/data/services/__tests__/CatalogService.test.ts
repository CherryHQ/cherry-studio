import type { ProtoModelConfig, ProtoProviderModelOverride } from '@cherrystudio/provider-catalog'
import { EndpointType, ModelCapability } from '@cherrystudio/provider-catalog'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock catalog reader functions
vi.mock('@cherrystudio/provider-catalog', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    readModelCatalog: vi.fn(),
    readProviderCatalog: vi.fn(),
    readProviderModelCatalog: vi.fn()
  }
})

import { readModelCatalog, readProviderCatalog, readProviderModelCatalog } from '@cherrystudio/provider-catalog'

// Mock sibling services
vi.mock('../ModelService', () => ({
  modelService: { batchUpsert: vi.fn().mockResolvedValue(undefined) }
}))
vi.mock('../ProviderService', () => ({
  providerService: { batchUpsert: vi.fn().mockResolvedValue(undefined) }
}))

// Mock isDev constant
vi.mock('@main/constant', () => ({ isDev: true }))

// Import after mocks are set up
import { modelService } from '../ModelService'
import { CatalogService } from '../ProviderCatalogService'
import { providerService } from '../ProviderService'

// ─── Test Fixtures ───────────────────────────────────────────────────────────

function makeModelConfig(overrides: Partial<ProtoModelConfig> & { id: string }): ProtoModelConfig {
  return {
    capabilities: [],
    inputModalities: [],
    outputModalities: [],
    alias: [],
    ...overrides
  } as unknown as ProtoModelConfig
}

function makeProviderModelOverride(
  overrides: Partial<ProtoProviderModelOverride> & { providerId: string; modelId: string }
): ProtoProviderModelOverride {
  return {
    priority: 0,
    endpointTypes: [],
    inputModalities: [],
    outputModalities: [],
    ...overrides
  } as unknown as ProtoProviderModelOverride
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('CatalogService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset singleton and cache
    ;(CatalogService as any).instance = undefined
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Helper to set up catalog reader mock responses
  function mockCatalogData(opts: {
    models?: ProtoModelConfig[]
    overrides?: ProtoProviderModelOverride[]
    providers?: Array<{ id: string; name: string; metadata?: Record<string, unknown>; [k: string]: unknown }>
  }) {
    if (opts.models !== undefined) {
      vi.mocked(readModelCatalog).mockReturnValue({ version: '1.0', models: opts.models })
    }
    if (opts.overrides !== undefined) {
      vi.mocked(readProviderModelCatalog).mockReturnValue({ version: '1.0', overrides: opts.overrides })
    }
    if (opts.providers !== undefined) {
      vi.mocked(readProviderCatalog).mockReturnValue({
        version: '1.0',
        providers: opts.providers.map((p) => ({
          baseUrls: {},
          ...p
        })) as any
      })
    }
  }

  // ─── Singleton ─────────────────────────────────────────────────────────────

  describe('getInstance', () => {
    it('returns the same instance on repeated calls', () => {
      const a = CatalogService.getInstance()
      const b = CatalogService.getInstance()
      expect(a).toBe(b)
    })
  })

  // ─── clearCache ────────────────────────────────────────────────────────────

  describe('clearCache', () => {
    it('clears cached catalog data so next access re-reads files', () => {
      const models = [makeModelConfig({ id: 'model-a', name: 'Model A' })]
      const overrides = [makeProviderModelOverride({ providerId: 'p1', modelId: 'model-a' })]

      mockCatalogData({ models, overrides })

      const svc = CatalogService.getInstance()

      // First call loads from file
      svc.lookupModel('p1', 'model-a')
      expect(readModelCatalog).toHaveBeenCalledTimes(1)
      expect(readProviderModelCatalog).toHaveBeenCalledTimes(1)

      // Second call uses cache
      svc.lookupModel('p1', 'model-a')
      expect(readModelCatalog).toHaveBeenCalledTimes(1)
      expect(readProviderModelCatalog).toHaveBeenCalledTimes(1)

      // After clearCache, next call reads files again
      svc.clearCache()
      svc.lookupModel('p1', 'model-a')
      expect(readModelCatalog).toHaveBeenCalledTimes(2)
      expect(readProviderModelCatalog).toHaveBeenCalledTimes(2)
    })
  })

  // ─── lookupModel ───────────────────────────────────────────────────────────

  describe('lookupModel', () => {
    it('returns preset model and catalog override when both exist', () => {
      const preset = makeModelConfig({ id: 'gpt-4o', name: 'GPT-4o' })
      const override = makeProviderModelOverride({ providerId: 'openai', modelId: 'gpt-4o' })

      mockCatalogData({ models: [preset], overrides: [override] })

      const result = CatalogService.getInstance().lookupModel('openai', 'gpt-4o')
      expect(result.presetModel).toEqual(preset)
      expect(result.catalogOverride).toEqual(override)
    })

    it('returns null for both when model is not in catalog', () => {
      mockCatalogData({ models: [], overrides: [] })

      const result = CatalogService.getInstance().lookupModel('openai', 'nonexistent')
      expect(result.presetModel).toBeNull()
      expect(result.catalogOverride).toBeNull()
    })

    it('returns preset model but null override when model exists but not for provider', () => {
      const preset = makeModelConfig({ id: 'gpt-4o', name: 'GPT-4o' })
      const override = makeProviderModelOverride({ providerId: 'azure', modelId: 'gpt-4o' })

      mockCatalogData({ models: [preset], overrides: [override] })

      const result = CatalogService.getInstance().lookupModel('openai', 'gpt-4o')
      expect(result.presetModel).toEqual(preset)
      expect(result.catalogOverride).toBeNull()
    })
  })

  // ─── initializeProvider ────────────────────────────────────────────────────

  describe('initializeProvider', () => {
    it('merges overrides with base models and batch upserts to DB', async () => {
      const preset = makeModelConfig({
        id: 'gpt-4o',
        name: 'GPT-4o',
        capabilities: [ModelCapability.FUNCTION_CALL],
        contextWindow: 128000
      })
      const override = makeProviderModelOverride({
        providerId: 'openai',
        modelId: 'gpt-4o'
      })

      mockCatalogData({ models: [preset], overrides: [override] })

      const result = await CatalogService.getInstance().initializeProvider('openai')

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('openai::gpt-4o')
      expect(result[0].providerId).toBe('openai')
      expect(result[0].name).toBe('GPT-4o')

      expect(modelService.batchUpsert).toHaveBeenCalledTimes(1)
      const rows = vi.mocked(modelService.batchUpsert).mock.calls[0][0]
      expect(rows).toHaveLength(1)
      expect(rows[0].providerId).toBe('openai')
      expect(rows[0].modelId).toBe('gpt-4o')
    })

    it('returns empty array when no overrides exist for the provider', async () => {
      mockCatalogData({
        models: [makeModelConfig({ id: 'gpt-4o' })],
        overrides: []
      })

      const result = await CatalogService.getInstance().initializeProvider('openai')

      expect(result).toEqual([])
      expect(modelService.batchUpsert).not.toHaveBeenCalled()
    })

    it('skips overrides whose base model is not found', async () => {
      const override = makeProviderModelOverride({
        providerId: 'openai',
        modelId: 'missing-model'
      })

      mockCatalogData({ models: [], overrides: [override] })

      const result = await CatalogService.getInstance().initializeProvider('openai')

      expect(result).toEqual([])
      // batchUpsert is still called with empty array
      expect(modelService.batchUpsert).toHaveBeenCalledWith([])
    })

    it('handles multiple overrides for same provider', async () => {
      const presets = [
        makeModelConfig({ id: 'gpt-4o', name: 'GPT-4o' }),
        makeModelConfig({ id: 'gpt-4o-mini', name: 'GPT-4o Mini' })
      ]
      const overrides = [
        makeProviderModelOverride({ providerId: 'openai', modelId: 'gpt-4o' }),
        makeProviderModelOverride({ providerId: 'openai', modelId: 'gpt-4o-mini' })
      ]

      mockCatalogData({ models: presets, overrides })

      const result = await CatalogService.getInstance().initializeProvider('openai')

      expect(result).toHaveLength(2)
      expect(result.map((m) => m.id)).toEqual(['openai::gpt-4o', 'openai::gpt-4o-mini'])
    })
  })

  // ─── initializePresetProviders ─────────────────────────────────────────────

  describe('initializePresetProviders', () => {
    it('reads providers.pb and batch upserts provider rows including cherryai', async () => {
      mockCatalogData({
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            baseUrls: { [EndpointType.OPENAI_CHAT_COMPLETIONS]: 'https://api.openai.com/v1' },
            defaultChatEndpoint: EndpointType.OPENAI_CHAT_COMPLETIONS
          }
        ]
      })

      await CatalogService.getInstance().initializePresetProviders()

      expect(providerService.batchUpsert).toHaveBeenCalledTimes(1)
      const rows = vi.mocked(providerService.batchUpsert).mock.calls[0][0]

      // Should include openai + cherryai
      expect(rows).toHaveLength(2)
      expect(rows.map((r) => r.providerId)).toContain('openai')
      expect(rows.map((r) => r.providerId)).toContain('cherryai')

      // Verify cherryai row
      const cherryai = rows.find((r) => r.providerId === 'cherryai')!
      expect(cherryai.name).toBe('CherryAI')
      expect(cherryai.baseUrls).toEqual({
        [EndpointType.OPENAI_CHAT_COMPLETIONS]: 'https://api.cherry-ai.com'
      })
    })

    it('maps provider website metadata correctly', async () => {
      mockCatalogData({
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            metadata: {
              website: {
                official: 'https://openai.com',
                docs: 'https://platform.openai.com/docs',
                apiKey: 'https://platform.openai.com/api-keys',
                models: null
              }
            }
          }
        ]
      })

      await CatalogService.getInstance().initializePresetProviders()

      const rows = vi.mocked(providerService.batchUpsert).mock.calls[0][0]
      const openai = rows.find((r) => r.providerId === 'openai')!
      expect(openai.websites).toEqual({
        official: 'https://openai.com',
        docs: 'https://platform.openai.com/docs',
        apiKey: 'https://platform.openai.com/api-keys',
        models: undefined
      })
    })

    it('sets websites to null when no website metadata', async () => {
      mockCatalogData({
        providers: [{ id: 'custom', name: 'Custom' }]
      })

      await CatalogService.getInstance().initializePresetProviders()

      const rows = vi.mocked(providerService.batchUpsert).mock.calls[0][0]
      const custom = rows.find((r) => r.providerId === 'custom')!
      expect(custom.websites).toBeNull()
    })

    it('returns early when providers.pb cannot be read', async () => {
      vi.mocked(readProviderCatalog).mockImplementation(() => {
        throw new Error('ENOENT')
      })

      await CatalogService.getInstance().initializePresetProviders()

      expect(providerService.batchUpsert).not.toHaveBeenCalled()
    })
  })

  // ─── initializeAllPresetProviders ──────────────────────────────────────────

  describe('initializeAllPresetProviders', () => {
    it('delegates to initializePresetProviders', async () => {
      mockCatalogData({
        providers: [{ id: 'openai', name: 'OpenAI' }]
      })

      const svc = CatalogService.getInstance()
      const spy = vi.spyOn(svc, 'initializePresetProviders').mockResolvedValue(undefined)

      await svc.initializeAllPresetProviders()

      expect(spy).toHaveBeenCalledTimes(1)
    })
  })

  // ─── resolveModels ─────────────────────────────────────────────────────────

  describe('resolveModels', () => {
    it('enriches raw models with catalog data', () => {
      const preset = makeModelConfig({
        id: 'gpt-4o',
        name: 'GPT-4o',
        capabilities: [ModelCapability.FUNCTION_CALL],
        contextWindow: 128000
      })
      const override = makeProviderModelOverride({
        providerId: 'openai',
        modelId: 'gpt-4o'
      })

      mockCatalogData({ models: [preset], overrides: [override] })

      const result = CatalogService.getInstance().resolveModels('openai', [{ modelId: 'gpt-4o', name: 'GPT-4o' }])

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('openai::gpt-4o')
      expect(result[0].capabilities).toContain(ModelCapability.FUNCTION_CALL)
      expect(result[0].contextWindow).toBe(128000)
    })

    it('returns custom models for entries not in catalog', () => {
      mockCatalogData({ models: [], overrides: [] })

      const result = CatalogService.getInstance().resolveModels('custom-provider', [
        { modelId: 'my-custom-model', name: 'My Model' }
      ])

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('custom-provider::my-custom-model')
      expect(result[0].name).toBe('My Model')
    })

    it('deduplicates models by modelId', () => {
      mockCatalogData({ models: [], overrides: [] })

      const result = CatalogService.getInstance().resolveModels('p1', [
        { modelId: 'model-a', name: 'First' },
        { modelId: 'model-a', name: 'Duplicate' },
        { modelId: 'model-b', name: 'Second' }
      ])

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('First')
      expect(result[1].name).toBe('Second')
    })

    it('skips entries with empty modelId', () => {
      mockCatalogData({ models: [], overrides: [] })

      const result = CatalogService.getInstance().resolveModels('p1', [
        { modelId: '', name: 'Empty' },
        { modelId: 'valid', name: 'Valid' }
      ])

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Valid')
    })

    it('uses modelId as name when raw name is not provided', () => {
      mockCatalogData({ models: [], overrides: [] })

      const result = CatalogService.getInstance().resolveModels('p1', [{ modelId: 'my-model' }])

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('my-model')
    })

    it('passes raw endpointTypes through userRow', () => {
      mockCatalogData({ models: [], overrides: [] })

      const result = CatalogService.getInstance().resolveModels('p1', [
        { modelId: 'my-model', endpointTypes: [EndpointType.ANTHROPIC_MESSAGES] }
      ])

      expect(result).toHaveLength(1)
      expect(result[0].endpointTypes).toEqual([EndpointType.ANTHROPIC_MESSAGES])
    })
  })

  // ─── Error handling in catalog loading ─────────────────────────────────────

  describe('error handling', () => {
    it('returns empty models when models.pb cannot be read', () => {
      vi.mocked(readModelCatalog).mockImplementation(() => {
        throw new Error('ENOENT')
      })
      vi.mocked(readProviderModelCatalog).mockImplementation(() => {
        throw new Error('ENOENT')
      })

      const result = CatalogService.getInstance().lookupModel('openai', 'gpt-4o')
      expect(result.presetModel).toBeNull()
    })

    it('returns empty overrides when provider-models.pb cannot be read', () => {
      vi.mocked(readModelCatalog).mockReturnValue({
        version: '1.0',
        models: [makeModelConfig({ id: 'gpt-4o' })]
      })
      vi.mocked(readProviderModelCatalog).mockImplementation(() => {
        throw new Error('ENOENT')
      })

      const result = CatalogService.getInstance().lookupModel('openai', 'gpt-4o')
      expect(result.presetModel).not.toBeNull()
      expect(result.catalogOverride).toBeNull()
    })
  })
})
