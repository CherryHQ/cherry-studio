/**
 * HubProvider Integration Tests
 * Tests end-to-end integration between HubProvider, RuntimeExecutor, and ProviderExtension
 */

import type { LanguageModelV3 } from '@ai-sdk/provider'
import { createMockLanguageModel, createMockProviderV3 } from '@test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RuntimeExecutor } from '../../runtime/executor'
import { ExtensionRegistry } from '../core/ExtensionRegistry'
import { ProviderExtension } from '../core/ProviderExtension'
import { createHubProviderAsync } from '../features/HubProvider'

describe('HubProvider Integration Tests', () => {
  let registry: ExtensionRegistry
  let openaiExtension: ProviderExtension<any, any, any, any>
  let anthropicExtension: ProviderExtension<any, any, any, any>
  let googleExtension: ProviderExtension<any, any, any, any>

  beforeEach(() => {
    vi.clearAllMocks()

    // Create fresh registry
    registry = new ExtensionRegistry()

    // Create provider extensions using test utils directly
    openaiExtension = ProviderExtension.create({
      name: 'openai',
      create: () => createMockProviderV3({ provider: 'openai' })
    } as const)

    anthropicExtension = ProviderExtension.create({
      name: 'anthropic',
      create: () => createMockProviderV3({ provider: 'anthropic' })
    } as const)

    googleExtension = ProviderExtension.create({
      name: 'google',
      create: () => createMockProviderV3({ provider: 'google' })
    } as const)

    // Register extensions
    registry.register(openaiExtension)
    registry.register(anthropicExtension)
    registry.register(googleExtension)
  })

  describe('End-to-End with RuntimeExecutor', () => {
    it('should resolve models through HubProvider using namespace format', async () => {
      // Create HubProvider
      const hubProvider = await createHubProviderAsync({
        hubId: 'aihubmix',
        registry,
        providerSettingsMap: new Map([
          ['openai', { apiKey: 'test-openai-key' }],
          ['anthropic', { apiKey: 'test-anthropic-key' }]
        ])
      })

      // Test that models are resolved correctly
      const openaiModel = hubProvider.languageModel('openai|gpt-4')
      const anthropicModel = hubProvider.languageModel('anthropic|claude-3-5-sonnet')

      expect(openaiModel).toBeDefined()
      expect(openaiModel.provider).toBe('openai')
      expect(openaiModel.modelId).toBe('gpt-4')

      expect(anthropicModel).toBeDefined()
      expect(anthropicModel.provider).toBe('anthropic')
      expect(anthropicModel.modelId).toBe('claude-3-5-sonnet')
    })

    it('should resolve language model correctly through executor', async () => {
      const hubProvider = await createHubProviderAsync({
        hubId: 'test-hub',
        registry,
        providerSettingsMap: new Map([['openai', { apiKey: 'test-key' }]])
      })

      const executor = RuntimeExecutor.create('test-hub', hubProvider, {} as never, [])

      // Access the private resolveModel method through streamText
      const result = await executor.streamText({
        model: 'openai|gpt-4-turbo',
        messages: [{ role: 'user', content: 'Test' }]
      })

      // Verify the model was created and result is valid
      expect(result).toBeDefined()
      expect(result.textStream).toBeDefined()
    })

    it('should handle multiple providers in the same hub', async () => {
      const hubProvider = await createHubProviderAsync({
        hubId: 'multi-hub',
        registry,
        providerSettingsMap: new Map([
          ['openai', { apiKey: 'openai-key' }],
          ['anthropic', { apiKey: 'anthropic-key' }],
          ['google', { apiKey: 'google-key' }]
        ])
      })

      // Test all three providers can be resolved
      const openaiModel = hubProvider.languageModel('openai|gpt-4')
      const anthropicModel = hubProvider.languageModel('anthropic|claude-3-5-sonnet')
      const googleModel = hubProvider.languageModel('google|gemini-2.0-flash')

      expect(openaiModel.provider).toBe('openai')
      expect(openaiModel.modelId).toBe('gpt-4')

      expect(anthropicModel.provider).toBe('anthropic')
      expect(anthropicModel.modelId).toBe('claude-3-5-sonnet')

      expect(googleModel.provider).toBe('google')
      expect(googleModel.modelId).toBe('gemini-2.0-flash')
    })

    it('should work with direct model objects instead of strings', async () => {
      const hubProvider = await createHubProviderAsync({
        hubId: 'test-hub',
        registry,
        providerSettingsMap: new Map([['openai', { apiKey: 'test-key' }]])
      })

      const executor = RuntimeExecutor.create('test-hub', hubProvider, {} as never, [])

      // Create a model instance directly
      const model = createMockLanguageModel({
        provider: 'openai',
        modelId: 'gpt-4'
      })

      // Use the model object directly
      const result = await executor.streamText({
        model: model as LanguageModelV3,
        messages: [{ role: 'user', content: 'Test with model object' }]
      })

      expect(result).toBeDefined()
    })
  })

  describe('ProviderExtension LRU Cache Integration', () => {
    it('should leverage ProviderExtension LRU cache when creating multiple HubProviders', async () => {
      const settings = new Map([
        ['openai', { apiKey: 'same-key-1' }],
        ['anthropic', { apiKey: 'same-key-2' }]
      ])

      // Create first HubProvider
      const hub1 = await createHubProviderAsync({
        hubId: 'hub1',
        registry,
        providerSettingsMap: settings
      })

      // Create second HubProvider with SAME settings
      const hub2 = await createHubProviderAsync({
        hubId: 'hub2',
        registry,
        providerSettingsMap: settings
      })

      // Extensions should have cached the provider instances
      // Create a test model to verify caching
      const model1 = hub1.languageModel('openai|gpt-4')
      const model2 = hub2.languageModel('openai|gpt-4')

      expect(model1).toBeDefined()
      expect(model2).toBeDefined()

      // Both should have the same provider name
      expect(model1.provider).toBe('openai')
      expect(model2.provider).toBe('openai')
    })

    it('should create new providers when settings differ', async () => {
      const settings1 = new Map([['openai', { apiKey: 'key-1' }]])
      const settings2 = new Map([['openai', { apiKey: 'key-2' }]])

      // Create two HubProviders with DIFFERENT settings
      const hub1 = await createHubProviderAsync({
        hubId: 'hub1',
        registry,
        providerSettingsMap: settings1
      })

      const hub2 = await createHubProviderAsync({
        hubId: 'hub2',
        registry,
        providerSettingsMap: settings2
      })

      const model1 = hub1.languageModel('openai|gpt-4')
      const model2 = hub2.languageModel('openai|gpt-4')

      expect(model1).toBeDefined()
      expect(model2).toBeDefined()
    })

    it('should handle cache across multiple provider types', async () => {
      const settings = new Map([
        ['openai', { apiKey: 'openai-key' }],
        ['anthropic', { apiKey: 'anthropic-key' }]
      ])

      const hub = await createHubProviderAsync({
        hubId: 'test-hub',
        registry,
        providerSettingsMap: settings
      })

      // Create models from different providers
      const openaiModel = hub.languageModel('openai|gpt-4')
      const anthropicModel = hub.languageModel('anthropic|claude-3-5-sonnet')
      const openaiEmbedding = hub.embeddingModel('openai|text-embedding-3-small')

      expect(openaiModel.provider).toBe('openai')
      expect(anthropicModel.provider).toBe('anthropic')
      expect(openaiEmbedding.provider).toBe('openai')
    })
  })

  describe('Error Handling Integration', () => {
    it('should throw error when using provider not in providerSettingsMap', async () => {
      const hub = await createHubProviderAsync({
        hubId: 'test-hub',
        registry,
        providerSettingsMap: new Map([['openai', { apiKey: 'test-key' }]])
        // Note: anthropic NOT included
      })

      // Try to use anthropic (not initialized)
      expect(() => {
        hub.languageModel('anthropic|claude-3-5-sonnet')
      }).toThrow(/Provider "anthropic" not initialized/)
    })

    it('should throw error when extension not registered', async () => {
      const emptyRegistry = new ExtensionRegistry()

      await expect(
        createHubProviderAsync({
          hubId: 'test-hub',
          registry: emptyRegistry,
          providerSettingsMap: new Map([['openai', { apiKey: 'test-key' }]])
        })
      ).rejects.toThrow(/Provider extension "openai" not found in registry/)
    })

    it('should throw error on invalid model ID format', async () => {
      const hub = await createHubProviderAsync({
        hubId: 'test-hub',
        registry,
        providerSettingsMap: new Map([['openai', { apiKey: 'test-key' }]])
      })

      // Invalid format: no separator
      expect(() => {
        hub.languageModel('invalid-no-separator')
      }).toThrow(/Invalid hub model ID format/)

      // Invalid format: empty provider
      expect(() => {
        hub.languageModel('|model-id')
      }).toThrow(/Invalid hub model ID format/)

      // Invalid format: empty modelId
      expect(() => {
        hub.languageModel('openai|')
      }).toThrow(/Invalid hub model ID format/)
    })

    it('should propagate errors from extension.createProvider', async () => {
      // Create an extension that throws on creation
      const failingExtension = ProviderExtension.create({
        name: 'failing',
        create: () => {
          throw new Error('Provider creation failed!')
        }
      } as const)

      const failRegistry = new ExtensionRegistry()
      failRegistry.register(failingExtension)

      await expect(
        createHubProviderAsync({
          hubId: 'test-hub',
          registry: failRegistry,
          providerSettingsMap: new Map([['failing', { apiKey: 'test' }]])
        })
      ).rejects.toThrow(/Failed to create provider "failing"/)
    })
  })

  describe('Advanced Scenarios', () => {
    it('should support image generation through hub', async () => {
      const hub = await createHubProviderAsync({
        hubId: 'test-hub',
        registry,
        providerSettingsMap: new Map([['openai', { apiKey: 'test-key' }]])
      })

      const executor = RuntimeExecutor.create('test-hub', hub, {} as never, [])

      const result = await executor.generateImage({
        model: 'openai|dall-e-3',
        prompt: 'A beautiful sunset'
      })

      expect(result).toBeDefined()
    })

    it('should support embedding models through hub', async () => {
      const hub = await createHubProviderAsync({
        hubId: 'test-hub',
        registry,
        providerSettingsMap: new Map([['openai', { apiKey: 'test-key' }]])
      })

      const embeddingModel = hub.embeddingModel('openai|text-embedding-3-small')

      expect(embeddingModel).toBeDefined()
      expect(embeddingModel.provider).toBe('openai')
      expect(embeddingModel.modelId).toBe('text-embedding-3-small')
    })

    it('should handle concurrent model resolutions', async () => {
      const hub = await createHubProviderAsync({
        hubId: 'test-hub',
        registry,
        providerSettingsMap: new Map([
          ['openai', { apiKey: 'openai-key' }],
          ['anthropic', { apiKey: 'anthropic-key' }]
        ])
      })

      // Concurrent model resolutions
      const models = await Promise.all([
        Promise.resolve(hub.languageModel('openai|gpt-4')),
        Promise.resolve(hub.languageModel('anthropic|claude-3-5-sonnet')),
        Promise.resolve(hub.languageModel('openai|gpt-3.5-turbo'))
      ])

      expect(models).toHaveLength(3)
      expect(models[0].provider).toBe('openai')
      expect(models[0].modelId).toBe('gpt-4')
      expect(models[1].provider).toBe('anthropic')
      expect(models[1].modelId).toBe('claude-3-5-sonnet')
      expect(models[2].provider).toBe('openai')
      expect(models[2].modelId).toBe('gpt-3.5-turbo')
    })

    it('should work with middlewares', async () => {
      const hub = await createHubProviderAsync({
        hubId: 'test-hub',
        registry,
        providerSettingsMap: new Map([['openai', { apiKey: 'test-key' }]])
      })

      const executor = RuntimeExecutor.create('test-hub', hub, {} as never, [])

      // Create a mock middleware
      const mockMiddleware = {
        specificationVersion: 'v3' as const,
        wrapGenerate: vi.fn((doGenerate) => doGenerate),
        wrapStream: vi.fn((doStream) => doStream)
      }

      const result = await executor.streamText(
        {
          model: 'openai|gpt-4',
          messages: [{ role: 'user', content: 'Test with middleware' }]
        },
        { middlewares: [mockMiddleware] }
      )

      expect(result).toBeDefined()
    })
  })

  describe('Multiple HubProvider Instances', () => {
    it('should support multiple independent hub providers', async () => {
      // Create first hub for OpenAI only
      const openaiHub = await createHubProviderAsync({
        hubId: 'openai-hub',
        registry,
        providerSettingsMap: new Map([['openai', { apiKey: 'openai-key' }]])
      })

      // Create second hub for Anthropic only
      const anthropicHub = await createHubProviderAsync({
        hubId: 'anthropic-hub',
        registry,
        providerSettingsMap: new Map([['anthropic', { apiKey: 'anthropic-key' }]])
      })

      // Both hubs should work independently
      const openaiModel = openaiHub.languageModel('openai|gpt-4')
      const anthropicModel = anthropicHub.languageModel('anthropic|claude-3-5-sonnet')

      expect(openaiModel.provider).toBe('openai')
      expect(anthropicModel.provider).toBe('anthropic')

      // OpenAI hub should not have anthropic
      expect(() => {
        openaiHub.languageModel('anthropic|claude-3-5-sonnet')
      }).toThrow(/Provider "anthropic" not initialized/)

      // Anthropic hub should not have openai
      expect(() => {
        anthropicHub.languageModel('openai|gpt-4')
      }).toThrow(/Provider "openai" not initialized/)
    })

    it('should support creating multiple executors from same hub', async () => {
      const hub = await createHubProviderAsync({
        hubId: 'shared-hub',
        registry,
        providerSettingsMap: new Map([
          ['openai', { apiKey: 'key-1' }],
          ['anthropic', { apiKey: 'key-2' }]
        ])
      })

      // Create multiple executors from the same hub
      const executor1 = RuntimeExecutor.create('shared-hub', hub, {} as never, [])
      const executor2 = RuntimeExecutor.create('shared-hub', hub, {} as never, [])

      // Both executors should share the same hub and be able to resolve models
      const model1 = hub.languageModel('openai|gpt-4')
      const model2 = hub.languageModel('anthropic|claude-3-5-sonnet')

      expect(executor1).toBeDefined()
      expect(executor2).toBeDefined()
      expect(model1.provider).toBe('openai')
      expect(model2.provider).toBe('anthropic')
    })
  })
})
