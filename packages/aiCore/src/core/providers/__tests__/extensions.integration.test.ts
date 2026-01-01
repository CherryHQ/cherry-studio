/**
 * Provider Extensions Integration Tests
 * 测试真实 extensions 的完整功能
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { extensionRegistry } from '../core/ExtensionRegistry'
import { AnthropicExtension } from '../extensions/anthropic'
import { AzureExtension } from '../extensions/azure'
import { OpenAIExtension } from '../extensions/openai'

// Mock fetch for health checks
global.fetch = vi.fn()

describe('Provider Extensions Integration', () => {
  beforeEach(() => {
    // Clear registry before each test
    extensionRegistry.clear()
    extensionRegistry.clearCache()
    vi.clearAllMocks()
  })

  afterEach(() => {
    extensionRegistry.clear()
    extensionRegistry.clearCache()
  })

  describe('OpenAI Extension', () => {
    it('should register and create provider successfully', async () => {
      // Register extension
      extensionRegistry.register(OpenAIExtension)

      // Verify registration
      expect(extensionRegistry.has('openai')).toBe(true)
      expect(extensionRegistry.has('oai')).toBe(true) // alias

      // Create provider
      const provider = await extensionRegistry.createProvider('openai', {
        apiKey: 'sk-test-key-123',
        baseURL: 'https://api.openai.com/v1'
      })

      expect(provider).toBeDefined()
    })

    it('should execute onBeforeCreate hook for validation', async () => {
      extensionRegistry.register(OpenAIExtension)

      // Invalid API key (doesn't start with "sk-")
      await expect(
        extensionRegistry.createProvider('openai', {
          apiKey: 'invalid-key'
        })
      ).rejects.toThrow('Invalid OpenAI API key format')

      // Missing API key
      await expect(extensionRegistry.createProvider('openai', {})).rejects.toThrow('OpenAI API key is required')
    })

    it('should execute onAfterCreate hook for caching', async () => {
      extensionRegistry.register(OpenAIExtension)

      const settings = {
        apiKey: 'sk-test-key-123',
        baseURL: 'https://api.openai.com/v1'
      }

      // Create provider
      const provider = await extensionRegistry.createProvider('openai', settings)

      // Check extension's internal storage (custom cache)
      const ext = extensionRegistry.get('openai')
      const cache = ext?.storage.get('providerCache')
      expect(cache).toBeDefined()
      expect(cache?.has('sk-test-key-123')).toBe(true)
      expect(cache?.get('sk-test-key-123')).toBe(provider)
    })

    it('should cache providers based on settings', async () => {
      extensionRegistry.register(OpenAIExtension)

      const settings = {
        apiKey: 'sk-test-key-123',
        baseURL: 'https://api.openai.com/v1'
      }

      // First call - creates provider
      const provider1 = await extensionRegistry.createProvider('openai', settings)

      // Second call with same settings - returns cached
      const provider2 = await extensionRegistry.createProvider('openai', settings)

      expect(provider1).toBe(provider2) // Same instance

      // Different settings - creates new provider
      const provider3 = await extensionRegistry.createProvider('openai', {
        apiKey: 'sk-different-key-456',
        baseURL: 'https://api.openai.com/v1'
      })

      expect(provider3).not.toBe(provider1) // Different instance
    })

    it('should support openai-chat variant', async () => {
      extensionRegistry.register(OpenAIExtension)

      // Verify variant ID exists
      const providerIds = OpenAIExtension.getProviderIds()
      expect(providerIds).toContain('openai')
      expect(providerIds).toContain('openai-chat')

      // Create variant provider
      await extensionRegistry.createAndRegisterProvider('openai', {
        apiKey: 'sk-test-key-123'
      })

      // Both base and variant should be available
      const stats = extensionRegistry.getStats()
      expect(stats.totalExtensions).toBe(1)
      expect(stats.extensionsWithVariants).toBe(1)
    })

    it('should skip cache when requested', async () => {
      extensionRegistry.register(OpenAIExtension)

      const settings = {
        apiKey: 'sk-test-key-123'
      }

      // First creation
      const provider1 = await extensionRegistry.createProvider('openai', settings)

      // Skip cache - creates new instance
      const provider2 = await extensionRegistry.createProvider('openai', settings, {
        skipCache: true
      })

      expect(provider2).not.toBe(provider1) // Different instances
    })

    it('should track health status in storage', async () => {
      extensionRegistry.register(OpenAIExtension)

      await extensionRegistry.createProvider('openai', {
        apiKey: 'sk-test-key-123'
      })

      const ext = extensionRegistry.get('openai')
      const health = ext?.storage.get('healthStatus')

      expect(health).toBeDefined()
      expect(health?.isHealthy).toBe(true)
      expect(health?.consecutiveFailures).toBe(0)
      expect(health?.lastCheckTime).toBeGreaterThan(0)
    })
  })

  describe('Anthropic Extension', () => {
    it('should validate Anthropic API key format', async () => {
      extensionRegistry.register(AnthropicExtension)

      // Invalid format (doesn't start with "sk-ant-")
      await expect(
        extensionRegistry.createProvider('anthropic', {
          apiKey: 'sk-test-key'
        })
      ).rejects.toThrow('Invalid Anthropic API key format')

      // Missing API key
      await expect(extensionRegistry.createProvider('anthropic', {})).rejects.toThrow('Anthropic API key is required')

      // Valid format
      const provider = await extensionRegistry.createProvider('anthropic', {
        apiKey: 'sk-ant-test-key-123'
      })

      expect(provider).toBeDefined()
    })

    it('should validate baseURL format', async () => {
      extensionRegistry.register(AnthropicExtension)

      // Invalid baseURL (no http/https)
      await expect(
        extensionRegistry.createProvider('anthropic', {
          apiKey: 'sk-ant-test-key',
          baseURL: 'api.anthropic.com' // Missing protocol
        })
      ).rejects.toThrow('Invalid baseURL format')

      // Valid baseURL
      const provider = await extensionRegistry.createProvider('anthropic', {
        apiKey: 'sk-ant-test-key',
        baseURL: 'https://api.anthropic.com'
      })

      expect(provider).toBeDefined()
    })

    it('should track creation statistics', async () => {
      extensionRegistry.register(AnthropicExtension)

      // First successful creation
      await extensionRegistry.createProvider('anthropic', {
        apiKey: 'sk-ant-test-key-1'
      })

      const ext = extensionRegistry.get('anthropic')
      let stats = ext?.storage.get('stats')
      expect(stats?.totalCreations).toBe(1)
      expect(stats?.failedCreations).toBe(0)

      // Failed creation
      try {
        await extensionRegistry.createProvider('anthropic', {
          apiKey: 'invalid-key'
        })
      } catch {
        // Expected error
      }

      stats = ext?.storage.get('stats')
      expect(stats?.totalCreations).toBe(2)
      expect(stats?.failedCreations).toBe(1)

      // Second successful creation
      await extensionRegistry.createProvider('anthropic', {
        apiKey: 'sk-ant-test-key-2'
      })

      stats = ext?.storage.get('stats')
      expect(stats?.totalCreations).toBe(3)
      expect(stats?.failedCreations).toBe(1)
    })

    it('should record lastSuccessfulCreation timestamp', async () => {
      extensionRegistry.register(AnthropicExtension)

      const before = Date.now()

      await extensionRegistry.createProvider('anthropic', {
        apiKey: 'sk-ant-test-key'
      })

      const after = Date.now()

      const ext = extensionRegistry.get('anthropic')
      const timestamp = ext?.storage.get('lastSuccessfulCreation')

      expect(timestamp).toBeDefined()
      expect(timestamp).toBeGreaterThanOrEqual(before)
      expect(timestamp).toBeLessThanOrEqual(after)
    })

    it('should support claude alias', async () => {
      extensionRegistry.register(AnthropicExtension)

      // Access via alias
      expect(extensionRegistry.has('claude')).toBe(true)

      const provider = await extensionRegistry.createProvider('claude', {
        apiKey: 'sk-ant-test-key'
      })

      expect(provider).toBeDefined()
    })
  })

  describe('Azure Extension', () => {
    it('should validate Azure configuration', async () => {
      extensionRegistry.register(AzureExtension)

      // Missing both resourceName and baseURL
      await expect(
        extensionRegistry.createProvider('azure', {
          apiKey: 'test-key'
        })
      ).rejects.toThrow('Azure OpenAI requires either resourceName or baseURL')

      // Missing API key
      await expect(
        extensionRegistry.createProvider('azure', {
          resourceName: 'my-resource'
        })
      ).rejects.toThrow('Azure OpenAI API key is required')
    })

    it('should validate resourceName format', async () => {
      extensionRegistry.register(AzureExtension)

      // Invalid format (uppercase)
      await expect(
        extensionRegistry.createProvider('azure', {
          resourceName: 'MyResource',
          apiKey: 'test-key'
        })
      ).rejects.toThrow('Invalid Azure resource name format')

      // Invalid format (special chars)
      await expect(
        extensionRegistry.createProvider('azure', {
          resourceName: 'my_resource',
          apiKey: 'test-key'
        })
      ).rejects.toThrow('Invalid Azure resource name format')

      // Valid format
      const provider = await extensionRegistry.createProvider('azure', {
        resourceName: 'my-resource-123',
        apiKey: 'test-key'
      })

      expect(provider).toBeDefined()
    })

    it('should cache resource endpoints', async () => {
      extensionRegistry.register(AzureExtension)

      await extensionRegistry.createProvider('azure', {
        resourceName: 'my-resource',
        apiKey: 'test-key'
      })

      const ext = extensionRegistry.get('azure')
      const endpoints = ext?.storage.get('resourceEndpoints')

      expect(endpoints).toBeDefined()
      expect(endpoints?.has('my-resource')).toBe(true)
      expect(endpoints?.get('my-resource')).toBe('https://my-resource.openai.azure.com')
    })

    it('should track validated deployments', async () => {
      extensionRegistry.register(AzureExtension)

      // First deployment
      await extensionRegistry.createProvider('azure', {
        resourceName: 'resource-1',
        apiKey: 'test-key-1'
      })

      const ext = extensionRegistry.get('azure')
      let deployments = ext?.storage.get('validatedDeployments')
      expect(deployments?.size).toBe(1)
      expect(deployments?.has('resource-1')).toBe(true)

      // Second deployment
      await extensionRegistry.createProvider('azure', {
        resourceName: 'resource-2',
        apiKey: 'test-key-2'
      })

      deployments = ext?.storage.get('validatedDeployments')
      expect(deployments?.size).toBe(2)
      expect(deployments?.has('resource-2')).toBe(true)
    })

    it('should support azure-responses variant', async () => {
      extensionRegistry.register(AzureExtension)

      const providerIds = AzureExtension.getProviderIds()
      expect(providerIds).toContain('azure')
      expect(providerIds).toContain('azure-responses')
    })

    it('should support azure-openai alias', async () => {
      extensionRegistry.register(AzureExtension)

      expect(extensionRegistry.has('azure-openai')).toBe(true)

      const provider = await extensionRegistry.createProvider('azure-openai', {
        resourceName: 'my-resource',
        apiKey: 'test-key'
      })

      expect(provider).toBeDefined()
    })
  })

  describe('Multiple Extensions', () => {
    it('should register multiple extensions simultaneously', () => {
      extensionRegistry.registerAll([OpenAIExtension, AnthropicExtension, AzureExtension])

      const stats = extensionRegistry.getStats()
      expect(stats.totalExtensions).toBe(3)
      expect(stats.extensionsWithVariants).toBe(2) // OpenAI and Azure
    })

    it('should maintain separate storage for each extension', async () => {
      extensionRegistry.registerAll([OpenAIExtension, AnthropicExtension])

      // Create providers
      await extensionRegistry.createProvider('openai', {
        apiKey: 'sk-test-key'
      })

      await extensionRegistry.createProvider('anthropic', {
        apiKey: 'sk-ant-test-key'
      })

      // Check OpenAI storage
      const openaiExt = extensionRegistry.get('openai')
      const openaiCache = openaiExt?.storage.get('providerCache')
      expect(openaiCache?.size).toBe(1)

      // Check Anthropic storage
      const anthropicExt = extensionRegistry.get('anthropic')
      const anthropicStats = anthropicExt?.storage.get('stats')
      expect(anthropicStats?.totalCreations).toBe(1)

      // Storages are independent
      expect(openaiExt?.storage.get('stats')).toBeUndefined()
      expect(anthropicExt?.storage.get('providerCache')).toBeUndefined()
    })

    it('should clear cache per extension', async () => {
      extensionRegistry.registerAll([OpenAIExtension, AnthropicExtension])

      // Create providers
      await extensionRegistry.createProvider('openai', {
        apiKey: 'sk-test-key'
      })

      await extensionRegistry.createProvider('anthropic', {
        apiKey: 'sk-ant-test-key'
      })

      // Verify both are cached
      const stats1 = extensionRegistry.getStats()
      expect(stats1.cachedProviders).toBe(2)

      // Clear only OpenAI cache
      extensionRegistry.clearCache('openai')

      const stats2 = extensionRegistry.getStats()
      expect(stats2.cachedProviders).toBe(1) // Only Anthropic remains

      // Clear all caches
      extensionRegistry.clearCache()

      const stats3 = extensionRegistry.getStats()
      expect(stats3.cachedProviders).toBe(0)
    })
  })
})
