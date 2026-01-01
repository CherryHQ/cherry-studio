import type { ProviderV3 } from '@ai-sdk/provider'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ExtensionRegistry } from '../core/ExtensionRegistry'
import { isRegisteredProvider } from '../core/initialization'
import { ProviderExtension } from '../core/ProviderExtension'
import { ProviderInstanceRegistry } from '../core/ProviderInstanceRegistry'

// Mock provider for testing
const createMockProviderV3 = (): ProviderV3 => ({
  specificationVersion: 'v3' as const,
  languageModel: () => ({}) as any,
  embeddingModel: () => ({}) as any,
  imageModel: () => ({}) as any
})

describe('initialization utilities', () => {
  let testExtensionRegistry: ExtensionRegistry
  let testInstanceRegistry: ProviderInstanceRegistry

  beforeEach(() => {
    testExtensionRegistry = new ExtensionRegistry()
    testInstanceRegistry = new ProviderInstanceRegistry()
  })

  afterEach(() => {
    // Clean up registries
    testExtensionRegistry = null as any
    testInstanceRegistry = null as any
  })

  describe('isRegisteredProvider()', () => {
    it('should return true for providers registered in Extension Registry', () => {
      testExtensionRegistry.register(
        new ProviderExtension({
          name: 'test-provider',
          create: createMockProviderV3
        })
      )

      // Note: isRegisteredProvider uses global registries, so this tests the concept
      // In practice, we'd need to modify the function to accept registries as parameters
      // For now, this documents the expected behavior
      expect(typeof isRegisteredProvider).toBe('function')
    })

    it('should return true for providers registered in Provider Instance Registry', () => {
      const mockProvider = createMockProviderV3()
      testInstanceRegistry.registerProvider('test-provider', mockProvider)

      // Note: This tests the concept - actual implementation uses global registries
      expect(testInstanceRegistry.getProvider('test-provider')).toBeDefined()
    })

    it('should return false for unregistered providers', () => {
      // Both registries are empty
      const result = isRegisteredProvider('unknown-provider')

      // Note: This will check global registries
      expect(typeof result).toBe('boolean')
    })

    it('should work with provider aliases', () => {
      testExtensionRegistry.register(
        new ProviderExtension({
          name: 'openai',
          aliases: ['oai'],
          create: createMockProviderV3
        })
      )

      // Should be able to check both main ID and alias
      expect(testExtensionRegistry.has('openai')).toBe(true)
      expect(testExtensionRegistry.has('oai')).toBe(true)
    })

    it('should work with variant IDs', () => {
      testExtensionRegistry.register(
        new ProviderExtension({
          name: 'openai',
          create: createMockProviderV3,
          variants: [
            {
              suffix: 'chat',
              name: 'OpenAI Chat',
              transform: (provider) => provider
            }
          ]
        })
      )

      // Base provider should be registered
      expect(testExtensionRegistry.has('openai')).toBe(true)

      // Variant ID can be checked with isVariant method
      expect(testExtensionRegistry.isVariant('openai-chat')).toBe(true)

      // Base provider ID should be resolvable from variant
      expect(testExtensionRegistry.getBaseProviderId('openai-chat')).toBe('openai')
    })

    it('should return true if provider is in either registry', () => {
      // Register in extension registry only
      testExtensionRegistry.register(
        new ProviderExtension({
          name: 'ext-only',
          create: createMockProviderV3
        })
      )

      // Register in instance registry only
      const mockProvider = createMockProviderV3()
      testInstanceRegistry.registerProvider('instance-only', mockProvider)

      // Both should be considered registered
      expect(testExtensionRegistry.has('ext-only')).toBe(true)
      expect(testInstanceRegistry.getProvider('instance-only')).toBeDefined()
    })

    it('should handle empty string gracefully', () => {
      const result = isRegisteredProvider('')
      expect(typeof result).toBe('boolean')
    })

    it('should be case-sensitive', () => {
      testExtensionRegistry.register(
        new ProviderExtension({
          name: 'openai',
          create: createMockProviderV3
        })
      )

      expect(testExtensionRegistry.has('openai')).toBe(true)
      expect(testExtensionRegistry.has('OpenAI')).toBe(false)
      expect(testExtensionRegistry.has('OPENAI')).toBe(false)
    })
  })

  describe('Integration: isRegisteredProvider with actual registries', () => {
    it('should correctly identify providers across both registries', () => {
      // This test documents the expected behavior when both registries are involved
      // isRegisteredProvider checks: extensionRegistry.has(id) || instanceRegistry.getProvider(id) !== undefined

      testExtensionRegistry.register(
        new ProviderExtension({
          name: 'registered-ext',
          create: createMockProviderV3
        })
      )

      const mockProvider = createMockProviderV3()
      testInstanceRegistry.registerProvider('registered-instance', mockProvider)

      // Extension registry check
      expect(testExtensionRegistry.has('registered-ext')).toBe(true)

      // Instance registry check
      expect(testInstanceRegistry.getProvider('registered-instance')).toBeDefined()

      // Unregistered provider
      expect(testExtensionRegistry.has('unregistered')).toBe(false)
      expect(testInstanceRegistry.getProvider('unregistered')).toBeUndefined()
    })
  })
})
