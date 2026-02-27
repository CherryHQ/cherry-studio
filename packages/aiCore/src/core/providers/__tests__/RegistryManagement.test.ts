/**
 * RegistryManagement Comprehensive Tests
 * Tests provider registry management, model resolution, and alias handling
 * Covers registration, retrieval, and cleanup operations
 */

import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3, ProviderV3 } from '@ai-sdk/provider'
import { createProviderRegistry } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockEmbeddingModel, createMockImageModel, createMockLanguageModel } from '../../../__tests__'
import { DEFAULT_SEPARATOR, RegistryManagement } from '../RegistryManagement'

// Mock AI SDK
vi.mock('ai', () => ({
  createProviderRegistry: vi.fn(),
  jsonSchema: vi.fn((schema) => schema)
}))

describe('RegistryManagement', () => {
  let registry: RegistryManagement
  let mockProvider: ProviderV3
  let mockLanguageModel: LanguageModelV3
  let mockEmbeddingModel: EmbeddingModelV3
  let mockImageModel: ImageModelV3

  beforeEach(() => {
    vi.clearAllMocks()

    // Create mock models using global utilities
    mockLanguageModel = createMockLanguageModel({
      provider: 'test',
      modelId: 'test-model'
    })

    mockEmbeddingModel = createMockEmbeddingModel({
      provider: 'test',
      modelId: 'test-embedding'
    })

    mockImageModel = createMockImageModel({
      provider: 'test',
      modelId: 'test-image'
    })

    // Create mock provider
    mockProvider = {
      specificationVersion: 'v3',
      languageModel: vi.fn().mockReturnValue(mockLanguageModel),
      embeddingModel: vi.fn().mockReturnValue(mockEmbeddingModel),
      imageModel: vi.fn().mockReturnValue(mockImageModel),
      transcriptionModel: vi.fn(),
      speechModel: vi.fn()
    } as ProviderV3

    // Setup mock registry
    const mockRegistry = {
      languageModel: vi.fn().mockReturnValue(mockLanguageModel),
      embeddingModel: vi.fn().mockReturnValue(mockEmbeddingModel),
      imageModel: vi.fn().mockReturnValue(mockImageModel),
      transcriptionModel: vi.fn(),
      speechModel: vi.fn()
    }

    vi.mocked(createProviderRegistry).mockReturnValue(mockRegistry as any)

    registry = new RegistryManagement()
  })

  describe('Constructor and Initialization', () => {
    it('should create registry with default separator', () => {
      const reg = new RegistryManagement()

      expect(reg).toBeInstanceOf(RegistryManagement)
      expect(reg.hasProviders()).toBe(false)
    })

    it('should create registry with custom separator', () => {
      const customSeparator = ':'
      const reg = new RegistryManagement({ separator: customSeparator })

      expect(reg).toBeInstanceOf(RegistryManagement)
    })

    it('should start with empty provider list', () => {
      expect(registry.getRegisteredProviders()).toEqual([])
    })
  })

  describe('Provider Registration', () => {
    it('should register a provider', () => {
      registry.registerProvider('openai', mockProvider)

      expect(registry.getProvider('openai')).toBe(mockProvider)
      expect(registry.hasProviders()).toBe(true)
    })

    it('should register multiple providers', () => {
      const provider2 = { ...mockProvider }

      registry.registerProvider('openai', mockProvider)
      registry.registerProvider('anthropic', provider2)

      expect(registry.getProvider('openai')).toBe(mockProvider)
      expect(registry.getProvider('anthropic')).toBe(provider2)
    })

    it('should return this for chaining', () => {
      const result = registry.registerProvider('openai', mockProvider)

      expect(result).toBe(registry)
    })

    it('should rebuild registry after registration', () => {
      registry.registerProvider('openai', mockProvider)

      expect(createProviderRegistry).toHaveBeenCalledWith(
        expect.objectContaining({
          openai: mockProvider
        }),
        { separator: DEFAULT_SEPARATOR }
      )
    })

    it('should register provider with aliases', () => {
      registry.registerProvider('openai', mockProvider, ['gpt', 'chatgpt'])

      expect(registry.getProvider('openai')).toBe(mockProvider)
      expect(registry.getProvider('gpt')).toBe(mockProvider)
      expect(registry.getProvider('chatgpt')).toBe(mockProvider)
    })

    it('should track aliases separately', () => {
      registry.registerProvider('openai', mockProvider, ['gpt'])

      expect(registry.isAlias('gpt')).toBe(true)
      expect(registry.isAlias('openai')).toBe(false)
    })

    it('should handle multiple aliases for same provider', () => {
      const aliases = ['alias1', 'alias2', 'alias3']
      registry.registerProvider('provider', mockProvider, aliases)

      aliases.forEach((alias) => {
        expect(registry.getProvider(alias)).toBe(mockProvider)
        expect(registry.isAlias(alias)).toBe(true)
      })
    })
  })

  describe('Bulk Registration', () => {
    it('should register multiple providers at once', () => {
      const providers = {
        openai: mockProvider,
        anthropic: { ...mockProvider },
        google: { ...mockProvider }
      }

      registry.registerProviders(providers)

      expect(registry.getProvider('openai')).toBe(providers.openai)
      expect(registry.getProvider('anthropic')).toBe(providers.anthropic)
      expect(registry.getProvider('google')).toBe(providers.google)
    })

    it('should return this for chaining', () => {
      const result = registry.registerProviders({ openai: mockProvider })

      expect(result).toBe(registry)
    })
  })

  describe('Provider Retrieval', () => {
    beforeEach(() => {
      registry.registerProvider('openai', mockProvider)
    })

    it('should retrieve registered provider', () => {
      const provider = registry.getProvider('openai')

      expect(provider).toBe(mockProvider)
    })

    it('should return undefined for unregistered provider', () => {
      const provider = registry.getProvider('nonexistent')

      expect(provider).toBeUndefined()
    })

    it('should retrieve provider by alias', () => {
      registry.registerProvider('anthropic', mockProvider, ['claude'])

      const provider = registry.getProvider('claude')

      expect(provider).toBe(mockProvider)
    })

    it('should get list of all registered providers', () => {
      registry.registerProvider('anthropic', mockProvider)
      registry.registerProvider('google', mockProvider, ['gemini'])

      const providers = registry.getRegisteredProviders()

      expect(providers).toContain('openai')
      expect(providers).toContain('anthropic')
      expect(providers).toContain('google')
      expect(providers).toContain('gemini') // Aliases included
    })
  })

  describe('Provider Unregistration', () => {
    it('should unregister provider', () => {
      registry.registerProvider('openai', mockProvider)

      registry.unregisterProvider('openai')

      expect(registry.getProvider('openai')).toBeUndefined()
    })

    it('should unregister provider with all its aliases', () => {
      registry.registerProvider('openai', mockProvider, ['gpt', 'chatgpt'])

      registry.unregisterProvider('openai')

      expect(registry.getProvider('openai')).toBeUndefined()
      expect(registry.getProvider('gpt')).toBeUndefined()
      expect(registry.getProvider('chatgpt')).toBeUndefined()
    })

    it('should unregister only alias when alias is removed', () => {
      registry.registerProvider('openai', mockProvider, ['gpt', 'chatgpt'])

      registry.unregisterProvider('gpt')

      expect(registry.getProvider('openai')).toBe(mockProvider)
      expect(registry.getProvider('gpt')).toBeUndefined()
      expect(registry.getProvider('chatgpt')).toBe(mockProvider)
    })

    it('should handle unregistering non-existent provider', () => {
      expect(() => registry.unregisterProvider('nonexistent')).not.toThrow()
    })

    it('should return this for chaining', () => {
      registry.registerProvider('openai', mockProvider)

      const result = registry.unregisterProvider('openai')

      expect(result).toBe(registry)
    })

    it('should rebuild registry after unregistration', () => {
      registry.registerProvider('openai', mockProvider)
      vi.clearAllMocks()

      registry.unregisterProvider('openai')

      // Should rebuild with empty providers
      expect(createProviderRegistry).not.toHaveBeenCalled() // No rebuild when empty
    })
  })

  describe('Model Resolution', () => {
    beforeEach(() => {
      registry.registerProvider('openai', mockProvider)
    })

    it('should resolve language model', () => {
      const modelId = `openai${DEFAULT_SEPARATOR}gpt-4` as any

      const result = registry.languageModel(modelId)

      expect(result).toBe(mockLanguageModel)
    })

    it('should resolve embedding model', () => {
      const modelId = `openai${DEFAULT_SEPARATOR}text-embedding-3-small` as any

      const result = registry.embeddingModel(modelId)

      expect(result).toBe(mockEmbeddingModel)
    })

    it('should resolve image model', () => {
      const modelId = `openai${DEFAULT_SEPARATOR}dall-e-3` as any

      const result = registry.imageModel(modelId)

      expect(result).toBe(mockImageModel)
    })

    it('should resolve transcription model', () => {
      const modelId = `openai${DEFAULT_SEPARATOR}whisper-1` as any

      registry.transcriptionModel(modelId)

      // Verify it calls through to the mock registry
      expect(createProviderRegistry).toHaveBeenCalled()
    })

    it('should resolve speech model', () => {
      const modelId = `openai${DEFAULT_SEPARATOR}tts-1` as any

      registry.speechModel(modelId)

      expect(createProviderRegistry).toHaveBeenCalled()
    })

    it('should throw error when no providers registered', () => {
      const emptyRegistry = new RegistryManagement()

      expect(() => emptyRegistry.languageModel('openai|gpt-4' as any)).toThrow('No providers registered')
    })
  })

  describe('Alias Management', () => {
    it('should resolve provider ID from alias', () => {
      registry.registerProvider('openai', mockProvider, ['gpt'])

      const realId = registry.resolveProviderId('gpt')

      expect(realId).toBe('openai')
    })

    it('should return same ID if not an alias', () => {
      registry.registerProvider('openai', mockProvider)

      const realId = registry.resolveProviderId('openai')

      expect(realId).toBe('openai')
    })

    it('should check if ID is alias', () => {
      registry.registerProvider('openai', mockProvider, ['gpt'])

      expect(registry.isAlias('gpt')).toBe(true)
      expect(registry.isAlias('openai')).toBe(false)
    })

    it('should get all alias mappings', () => {
      const provider2 = { ...mockProvider }

      registry.registerProvider('openai', mockProvider, ['gpt', 'chatgpt'])
      registry.registerProvider('anthropic', provider2, ['claude'])

      const aliases = registry.getAllAliases()

      // Check that all aliases are present
      expect(aliases['gpt']).toBe('openai')
      expect(aliases['chatgpt']).toBe('openai')
      expect(aliases['claude']).toBe('anthropic')
    })

    it('should return empty object when no aliases', () => {
      registry.registerProvider('openai', mockProvider)

      const aliases = registry.getAllAliases()

      expect(aliases).toEqual({})
    })
  })

  describe('Registry State', () => {
    it('should check if has providers', () => {
      expect(registry.hasProviders()).toBe(false)

      registry.registerProvider('openai', mockProvider)

      expect(registry.hasProviders()).toBe(true)
    })

    it('should clear all providers', () => {
      registry.registerProvider('openai', mockProvider, ['gpt'])
      registry.registerProvider('anthropic', mockProvider)

      registry.clear()

      expect(registry.hasProviders()).toBe(false)
      expect(registry.getRegisteredProviders()).toEqual([])
      expect(registry.getAllAliases()).toEqual({})
    })

    it('should return this after clear for chaining', () => {
      const result = registry.clear()

      expect(result).toBe(registry)
    })
  })

  describe('Registry Rebuilding', () => {
    it('should rebuild registry when provider added', () => {
      registry.registerProvider('openai', mockProvider)

      expect(createProviderRegistry).toHaveBeenCalledTimes(1)
    })

    it('should rebuild registry when provider removed', () => {
      registry.registerProvider('openai', mockProvider)
      registry.registerProvider('anthropic', mockProvider)

      vi.clearAllMocks()

      registry.unregisterProvider('openai')

      expect(createProviderRegistry).toHaveBeenCalledTimes(1)
    })

    it('should set registry to null when all providers removed', () => {
      registry.registerProvider('openai', mockProvider)
      registry.unregisterProvider('openai')

      expect(() => registry.languageModel('any|model' as any)).toThrow('No providers registered')
    })

    it('should rebuild with correct separator', () => {
      const customRegistry = new RegistryManagement({ separator: ':' })
      customRegistry.registerProvider('openai', mockProvider)

      expect(createProviderRegistry).toHaveBeenCalledWith(expect.any(Object), { separator: ':' })
    })
  })

  describe('Global Registry Instance', () => {
    it('should have a global instance with default separator', async () => {
      const module = await import('../RegistryManagement')

      expect(module.globalRegistryManagement).toBeInstanceOf(RegistryManagement)
    })

    it('should have DEFAULT_SEPARATOR exported', () => {
      expect(DEFAULT_SEPARATOR).toBe('|')
    })
  })

  describe('Edge Cases', () => {
    it('should handle registering same provider twice', () => {
      registry.registerProvider('openai', mockProvider)

      const provider2 = { ...mockProvider }
      registry.registerProvider('openai', provider2)

      expect(registry.getProvider('openai')).toBe(provider2)
    })

    it('should handle alias conflicts (first wins)', () => {
      registry.registerProvider('provider1', mockProvider, ['shared-alias'])
      registry.registerProvider('provider2', mockProvider, ['shared-alias'])

      // First registered alias wins (the implementation doesn't override)
      expect(registry.resolveProviderId('shared-alias')).toBe('provider1')
    })

    it('should handle empty alias array', () => {
      registry.registerProvider('openai', mockProvider, [])

      expect(registry.getAllAliases()).toEqual({})
    })

    it('should handle null registry operations gracefully', () => {
      const emptyRegistry = new RegistryManagement()

      expect(() => emptyRegistry.languageModel('test|model' as any)).toThrow('No providers registered')
      expect(() => emptyRegistry.embeddingModel('test|embed' as any)).toThrow('No providers registered')
      expect(() => emptyRegistry.imageModel('test|image' as any)).toThrow('No providers registered')
    })

    it('should handle special characters in provider IDs', () => {
      const specialIds = ['provider-1', 'provider_2', 'provider.3', 'provider:4']

      specialIds.forEach((id) => {
        registry.registerProvider(id, mockProvider)
        expect(registry.getProvider(id)).toBe(mockProvider)
      })
    })
  })

  describe('Concurrent Operations', () => {
    it('should handle concurrent registrations', () => {
      const promises = [
        Promise.resolve(registry.registerProvider('provider1', mockProvider)),
        Promise.resolve(registry.registerProvider('provider2', mockProvider)),
        Promise.resolve(registry.registerProvider('provider3', mockProvider))
      ]

      return Promise.all(promises).then(() => {
        expect(registry.getRegisteredProviders()).toHaveLength(3)
      })
    })

    it('should handle mixed operations', () => {
      registry.registerProvider('openai', mockProvider)
      registry.registerProvider('anthropic', mockProvider)

      const provider1 = registry.getProvider('openai')
      registry.unregisterProvider('anthropic')
      const provider2 = registry.getProvider('openai')

      expect(provider1).toBe(provider2)
    })
  })

  describe('Type Safety', () => {
    it('should enforce model ID format with template literal types', () => {
      registry.registerProvider('openai', mockProvider)

      // These should be type-safe
      const validId = 'openai|gpt-4' as `${string}${typeof DEFAULT_SEPARATOR}${string}`

      expect(() => registry.languageModel(validId)).not.toThrow()
    })

    it('should return properly typed LanguageModelV3', () => {
      registry.registerProvider('openai', mockProvider)

      const model = registry.languageModel('openai|gpt-4' as any)

      expect(model.specificationVersion).toBe('v3')
      expect(model).toHaveProperty('doGenerate')
      expect(model).toHaveProperty('doStream')
    })

    it('should return properly typed EmbeddingModelV3', () => {
      registry.registerProvider('openai', mockProvider)

      const model = registry.embeddingModel('openai|ada-002' as any)

      expect(model.specificationVersion).toBe('v3')
      expect(model).toHaveProperty('doEmbed')
    })

    it('should return properly typed ImageModelV3', () => {
      registry.registerProvider('openai', mockProvider)

      const model = registry.imageModel('openai|dall-e-3' as any)

      expect(model.specificationVersion).toBe('v3')
      expect(model).toHaveProperty('doGenerate')
    })
  })

  describe('Memory Management', () => {
    it('should properly clean up on clear', () => {
      registry.registerProvider('p1', mockProvider, ['a1'])
      registry.registerProvider('p2', mockProvider, ['a2'])

      registry.clear()

      expect(registry.getRegisteredProviders()).toHaveLength(0)
      expect(Object.keys(registry.getAllAliases())).toHaveLength(0)
    })

    it('should properly clean up on unregister', () => {
      registry.registerProvider('openai', mockProvider, ['gpt', 'chatgpt'])

      registry.unregisterProvider('openai')

      expect(registry.getProvider('openai')).toBeUndefined()
      expect(registry.isAlias('gpt')).toBe(false)
      expect(registry.isAlias('chatgpt')).toBe(false)
    })
  })
})
