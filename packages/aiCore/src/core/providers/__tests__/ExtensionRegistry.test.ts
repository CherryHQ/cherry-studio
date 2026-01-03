/**
 * ExtensionRegistry 单元测试
 */

import { createMockProviderV3 } from '@test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ExtensionRegistry } from '../core/ExtensionRegistry'
import { ProviderExtension } from '../core/ProviderExtension'
import { ProviderCreationError } from '../core/utils'

// Mock RegistryManagement
vi.mock('../RegistryManagement', () => ({
  globalRegistryManagement: {
    registerProvider: vi.fn()
  }
}))

describe('ExtensionRegistry', () => {
  let registry: ExtensionRegistry

  beforeEach(() => {
    registry = new ExtensionRegistry()
  })

  describe('register', () => {
    it('should register an extension', () => {
      const extension = new ProviderExtension({
        name: 'test-provider',
        create: createMockProviderV3
      })

      registry.register(extension)

      expect(registry.has('test-provider')).toBe(true)
      expect(registry.get('test-provider')).toBe(extension)
    })

    it('should register aliases', () => {
      const extension = new ProviderExtension({
        name: 'openrouter',
        aliases: ['or', 'open-router'],
        create: createMockProviderV3
      })

      registry.register(extension)

      expect(registry.has('openrouter')).toBe(true)
      expect(registry.has('or')).toBe(true)
      expect(registry.has('open-router')).toBe(true)

      // 别名应该指向同一个 extension
      expect(registry.get('or')).toBe(extension)
      expect(registry.get('open-router')).toBe(extension)
    })

    it('should throw error if name already registered', () => {
      const ext1 = new ProviderExtension({
        name: 'test-provider',
        create: createMockProviderV3
      })

      const ext2 = new ProviderExtension({
        name: 'test-provider',
        create: createMockProviderV3
      })

      registry.register(ext1)

      expect(() => registry.register(ext2)).toThrow('already registered')
    })

    it('should throw error if alias already registered', () => {
      const ext1 = new ProviderExtension({
        name: 'provider1',
        aliases: ['shared-alias'],
        create: createMockProviderV3
      })

      const ext2 = new ProviderExtension({
        name: 'provider2',
        aliases: ['shared-alias'],
        create: createMockProviderV3
      })

      registry.register(ext1)

      expect(() => registry.register(ext2)).toThrow('already registered')
    })

    it('should support method chaining', () => {
      const ext1 = new ProviderExtension({
        name: 'provider1',
        create: createMockProviderV3
      })

      const ext2 = new ProviderExtension({
        name: 'provider2',
        create: createMockProviderV3
      })

      const result = registry.register(ext1).register(ext2)

      expect(result).toBe(registry)
      expect(registry.has('provider1')).toBe(true)
      expect(registry.has('provider2')).toBe(true)
    })
  })

  describe('registerAll', () => {
    it('should register multiple extensions', () => {
      const extensions = [
        new ProviderExtension({ name: 'provider1', create: createMockProviderV3 }),
        new ProviderExtension({ name: 'provider2', create: createMockProviderV3 }),
        new ProviderExtension({ name: 'provider3', create: createMockProviderV3 })
      ]

      registry.registerAll(extensions)

      expect(registry.has('provider1')).toBe(true)
      expect(registry.has('provider2')).toBe(true)
      expect(registry.has('provider3')).toBe(true)
    })

    it('should support method chaining', () => {
      const extensions = [new ProviderExtension({ name: 'test', create: createMockProviderV3 })]

      const result = registry.registerAll(extensions)

      expect(result).toBe(registry)
    })
  })

  describe('unregister', () => {
    it('should remove extension', () => {
      const extension = new ProviderExtension({
        name: 'test-provider',
        create: createMockProviderV3
      })

      registry.register(extension)
      expect(registry.has('test-provider')).toBe(true)

      const result = registry.unregister('test-provider')

      expect(result).toBe(true)
      expect(registry.has('test-provider')).toBe(false)
    })

    it('should remove aliases', () => {
      const extension = new ProviderExtension({
        name: 'test-provider',
        aliases: ['alias1', 'alias2'],
        create: createMockProviderV3
      })

      registry.register(extension)
      registry.unregister('test-provider')

      expect(registry.has('alias1')).toBe(false)
      expect(registry.has('alias2')).toBe(false)
    })

    it('should return false if extension not found', () => {
      const result = registry.unregister('non-existent')

      expect(result).toBe(false)
    })
  })

  describe('get', () => {
    it('should get extension by name', () => {
      const extension = new ProviderExtension({
        name: 'test-provider',
        create: createMockProviderV3
      })

      registry.register(extension)

      expect(registry.get('test-provider')).toBe(extension)
    })

    it('should get extension by alias', () => {
      const extension = new ProviderExtension({
        name: 'test-provider',
        aliases: ['test-alias'],
        create: createMockProviderV3
      })

      registry.register(extension)

      expect(registry.get('test-alias')).toBe(extension)
    })

    it('should return undefined for non-existent ID', () => {
      expect(registry.get('non-existent')).toBeUndefined()
    })
  })

  describe('getAll', () => {
    it('should return all registered extensions', () => {
      const ext1 = new ProviderExtension({ name: 'provider1', create: createMockProviderV3 })
      const ext2 = new ProviderExtension({ name: 'provider2', create: createMockProviderV3 })

      registry.register(ext1).register(ext2)

      const all = registry.getAll()

      expect(all).toHaveLength(2)
      expect(all).toContain(ext1)
      expect(all).toContain(ext2)
    })

    it('should return empty array when no extensions registered', () => {
      expect(registry.getAll()).toEqual([])
    })
  })

  describe('getAllProviderIds', () => {
    it('should return all provider IDs including variants', () => {
      const ext1 = new ProviderExtension({
        name: 'openai',
        aliases: ['oai'],
        create: createMockProviderV3,
        variants: [
          {
            suffix: 'chat',
            name: 'Chat',
            transform: (provider) => provider
          }
        ]
      })

      const ext2 = new ProviderExtension({
        name: 'azure',
        create: createMockProviderV3
      })

      registry.register(ext1).register(ext2)

      const ids = registry.getAllProviderIds()

      expect(ids).toContain('openai')
      expect(ids).toContain('oai')
      expect(ids).toContain('openai-chat')
      expect(ids).toContain('azure')
    })
  })

  describe('clear', () => {
    it('should remove all extensions', () => {
      registry.register(new ProviderExtension({ name: 'provider1', create: createMockProviderV3 }))
      registry.register(new ProviderExtension({ name: 'provider2', create: createMockProviderV3 }))

      registry.clear()

      expect(registry.getAll()).toEqual([])
      expect(registry.getAllProviderIds()).toEqual([])
    })
  })

  describe('createProvider', () => {
    it('should create provider using create function', async () => {
      const mockProvider = createMockProviderV3()
      const extension = new ProviderExtension({
        name: 'test-provider',
        create: () => mockProvider
      })

      registry.register(extension)

      const provider = await registry.createProvider('test-provider')

      expect(provider).toBe(mockProvider)
    })

    it('should merge default options with user settings', async () => {
      let receivedSettings: any

      const extension = new ProviderExtension<any>({
        name: 'test-provider',
        defaultOptions: { apiKey: 'default-key', timeout: 5000 },
        create: ((settings: any) => {
          receivedSettings = settings
          return createMockProviderV3()
        }) as any
      })

      registry.register(extension)

      await registry.createProvider('test-provider', { baseURL: 'https://api.test.com' })

      expect(receivedSettings).toEqual({
        apiKey: 'default-key',
        timeout: 5000,
        baseURL: 'https://api.test.com'
      })
    })

    it('should create provider using dynamic import', async () => {
      const mockProvider = createMockProviderV3()

      const extension = new ProviderExtension({
        name: 'lazy-provider',
        import: async () => ({
          createLazyProvider: () => mockProvider
        }),
        creatorFunctionName: 'createLazyProvider'
      })

      registry.register(extension)

      const provider = await registry.createProvider('lazy-provider')

      expect(provider).toBe(mockProvider)
    })

    it('should throw error if extension not found', async () => {
      await expect(registry.createProvider('non-existent')).rejects.toThrow('not found')
    })

    it('should throw error if creator function not found in imported module', async () => {
      const extension = new ProviderExtension({
        name: 'bad-import',
        import: async () => ({}),
        creatorFunctionName: 'nonExistentFunction'
      })

      registry.register(extension)

      try {
        await registry.createProvider('bad-import')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderCreationError)
        expect((error as ProviderCreationError).cause.message).toContain('not found in imported module')
      }
    })
  })

  describe('Provider Caching', () => {
    it('should cache provider instances based on settings', async () => {
      const createSpy = vi.fn(createMockProviderV3)

      registry.register(
        new ProviderExtension({
          name: 'test-provider',
          create: createSpy
        })
      )

      // First call - should create
      const provider1 = await registry.createProvider('test-provider', { apiKey: 'same-key' })
      expect(createSpy).toHaveBeenCalledTimes(1)

      // Second call with same settings - should use cache
      const provider2 = await registry.createProvider('test-provider', { apiKey: 'same-key' })
      expect(createSpy).toHaveBeenCalledTimes(1) // Still 1
      expect(provider2).toBe(provider1) // Same instance

      // Third call with different settings - should create new
      const provider3 = await registry.createProvider('test-provider', { apiKey: 'different-key' })
      expect(createSpy).toHaveBeenCalledTimes(2)
      expect(provider3).not.toBe(provider1)
    })

    it('should deep merge settings before generating cache key', async () => {
      let firstSettings: any
      let secondSettings: any

      const extension = new ProviderExtension({
        name: 'test-provider',
        defaultOptions: {
          apiKey: 'default-key',
          headers: { 'X-Default': 'value' }
        },
        create: (settings) => {
          if (!firstSettings) {
            firstSettings = settings
          } else {
            secondSettings = settings
          }
          return createMockProviderV3()
        }
      })

      registry.register(extension)

      await registry.createProvider('test-provider', { headers: { 'X-Custom': 'custom' } })
      await registry.createProvider('test-provider', { headers: { 'X-Custom': 'custom' } })

      // Should use cache - only created once
      expect(secondSettings).toBeUndefined()

      // Verify deep merge happened
      expect(firstSettings).toEqual({
        apiKey: 'default-key',
        headers: {
          'X-Default': 'value',
          'X-Custom': 'custom'
        }
      })
    })
  })

  describe('Hook Execution in createProvider', () => {
    it('should execute onBeforeCreate hook before creating provider', async () => {
      const createSpy = vi.fn(createMockProviderV3)
      const beforeCreateSpy = vi.fn(function (this: any) {
        this.storage.set('hooksCalled', ['onBeforeCreate'])
      })

      registry.register(
        new ProviderExtension<any>({
          name: 'test-provider',
          create: createSpy as any,
          hooks: {
            onBeforeCreate: beforeCreateSpy
          }
        }) as any
      )

      await registry.createProvider('test-provider', { apiKey: 'key' })

      expect(beforeCreateSpy).toHaveBeenCalledWith({ apiKey: 'key' })
      expect(createSpy).toHaveBeenCalled()
    })

    it('should execute onAfterCreate hook after creating provider', async () => {
      const mockProvider = createMockProviderV3()
      const afterCreateSpy = vi.fn()

      registry.register(
        new ProviderExtension({
          name: 'test-provider',
          create: () => mockProvider,
          hooks: {
            onAfterCreate: afterCreateSpy
          }
        })
      )

      await registry.createProvider('test-provider', { apiKey: 'key' })

      expect(afterCreateSpy).toHaveBeenCalledWith({ apiKey: 'key' }, mockProvider)
    })

    it('should execute hooks in correct order', async () => {
      const executionOrder: string[] = []

      registry.register(
        new ProviderExtension({
          name: 'test-provider',
          create: () => {
            executionOrder.push('create')
            return createMockProviderV3()
          },
          hooks: {
            onBeforeCreate: () => {
              executionOrder.push('before')
            },
            onAfterCreate: () => {
              executionOrder.push('after')
            }
          }
        })
      )

      await registry.createProvider('test-provider', { apiKey: 'key' })

      expect(executionOrder).toEqual(['before', 'create', 'after'])
    })

    it('should throw ProviderCreationError if onBeforeCreate fails', async () => {
      registry.register(
        new ProviderExtension({
          name: 'test-provider',
          create: createMockProviderV3,
          hooks: {
            onBeforeCreate: () => {
              throw new Error('Pre-creation check failed')
            }
          }
        })
      )

      await expect(registry.createProvider('test-provider', { apiKey: 'key' })).rejects.toThrow(ProviderCreationError)
    })
  })

  describe('ProviderCreationError', () => {
    it('should wrap errors in ProviderCreationError', async () => {
      registry.register(
        new ProviderExtension({
          name: 'test-provider',
          create: () => {
            throw new Error('Creation failed')
          }
        })
      )

      try {
        await registry.createProvider('test-provider', { apiKey: 'key' })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderCreationError)
        expect((error as ProviderCreationError).providerId).toBe('test-provider')
        expect((error as ProviderCreationError).cause.message).toBe('Creation failed')
      }
    })
  })

  describe('resolveProviderIdWithMode', () => {
    beforeEach(() => {
      // 注册带变体的 extension
      registry.register(
        new ProviderExtension({
          name: 'openai',
          aliases: ['oai'],
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

      registry.register(
        new ProviderExtension({
          name: 'azure',
          aliases: ['azure-openai'],
          create: createMockProviderV3,
          variants: [
            {
              suffix: 'responses',
              name: 'Azure Responses',
              transform: (provider) => provider
            }
          ]
        })
      )

      registry.register(
        new ProviderExtension({
          name: 'google',
          aliases: ['gemini'],
          create: createMockProviderV3
          // 没有 variants
        })
      )
    })

    it('should resolve base ID + mode to variant ID', () => {
      expect(registry.resolveProviderIdWithMode('openai', 'chat')).toBe('openai-chat')
      expect(registry.resolveProviderIdWithMode('azure', 'responses')).toBe('azure-responses')
    })

    it('should support aliases in base ID', () => {
      expect(registry.resolveProviderIdWithMode('oai', 'chat')).toBe('openai-chat')
      expect(registry.resolveProviderIdWithMode('azure-openai', 'responses')).toBe('azure-responses')
    })

    it('should return null if extension has no matching variant', () => {
      expect(registry.resolveProviderIdWithMode('openai', 'responses')).toBeNull()
      expect(registry.resolveProviderIdWithMode('azure', 'chat')).toBeNull()
    })

    it('should return null if extension has no variants at all', () => {
      expect(registry.resolveProviderIdWithMode('google', 'chat')).toBeNull()
    })

    it('should return null if extension not found', () => {
      expect(registry.resolveProviderIdWithMode('non-existent', 'chat')).toBeNull()
    })

    it('should return resolved base ID when mode is not provided', () => {
      expect(registry.resolveProviderIdWithMode('openai')).toBe('openai')
      expect(registry.resolveProviderIdWithMode('oai')).toBe('openai')
      expect(registry.resolveProviderIdWithMode('gemini')).toBe('google')
    })

    it('should return null when mode is not provided and extension not found', () => {
      expect(registry.resolveProviderIdWithMode('non-existent')).toBeNull()
    })
  })

  describe('parseProviderId', () => {
    beforeEach(() => {
      registry.register(
        new ProviderExtension({
          name: 'openai',
          aliases: ['oai'],
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

      registry.register(
        new ProviderExtension({
          name: 'azure',
          create: createMockProviderV3,
          variants: [
            {
              suffix: 'responses',
              name: 'Azure Responses',
              transform: (provider) => provider
            }
          ]
        })
      )

      registry.register(
        new ProviderExtension({
          name: 'google',
          aliases: ['gemini'],
          create: createMockProviderV3
        })
      )
    })

    it('should parse variant ID to base ID + mode', () => {
      expect(registry.parseProviderId('openai-chat')).toEqual({
        baseId: 'openai',
        mode: 'chat',
        isVariant: true
      })

      expect(registry.parseProviderId('azure-responses')).toEqual({
        baseId: 'azure',
        mode: 'responses',
        isVariant: true
      })
    })

    it('should parse base ID without mode', () => {
      expect(registry.parseProviderId('openai')).toEqual({
        baseId: 'openai',
        isVariant: false
      })

      expect(registry.parseProviderId('azure')).toEqual({
        baseId: 'azure',
        isVariant: false
      })

      expect(registry.parseProviderId('google')).toEqual({
        baseId: 'google',
        isVariant: false
      })
    })

    it('should resolve aliases to base ID', () => {
      expect(registry.parseProviderId('oai')).toEqual({
        baseId: 'openai',
        isVariant: false
      })

      expect(registry.parseProviderId('gemini')).toEqual({
        baseId: 'google',
        isVariant: false
      })
    })

    it('should return null for unknown provider ID', () => {
      expect(registry.parseProviderId('non-existent')).toBeNull()
      expect(registry.parseProviderId('unknown-variant')).toBeNull()
    })

    it('should handle multiple variants of same extension', () => {
      registry.register(
        new ProviderExtension({
          name: 'multi-variant',
          create: createMockProviderV3,
          variants: [
            {
              suffix: 'chat',
              name: 'Chat',
              transform: (provider) => provider
            },
            {
              suffix: 'responses',
              name: 'Responses',
              transform: (provider) => provider
            },
            {
              suffix: 'completions',
              name: 'Completions',
              transform: (provider) => provider
            }
          ]
        })
      )

      expect(registry.parseProviderId('multi-variant-chat')).toEqual({
        baseId: 'multi-variant',
        mode: 'chat',
        isVariant: true
      })

      expect(registry.parseProviderId('multi-variant-responses')).toEqual({
        baseId: 'multi-variant',
        mode: 'responses',
        isVariant: true
      })

      expect(registry.parseProviderId('multi-variant-completions')).toEqual({
        baseId: 'multi-variant',
        mode: 'completions',
        isVariant: true
      })
    })
  })

  describe('Variant Query Methods', () => {
    beforeEach(() => {
      // 注册带变体的 extensions
      registry.register(
        new ProviderExtension({
          name: 'openai',
          aliases: ['oai'],
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

      registry.register(
        new ProviderExtension({
          name: 'azure',
          aliases: ['azure-openai'],
          create: createMockProviderV3,
          variants: [
            {
              suffix: 'responses',
              name: 'Azure Responses',
              transform: (provider) => provider
            }
          ]
        })
      )

      registry.register(
        new ProviderExtension({
          name: 'google',
          aliases: ['gemini'],
          create: createMockProviderV3,
          variants: [
            {
              suffix: 'chat',
              name: 'Google Chat',
              transform: (provider) => provider
            }
          ]
        })
      )

      registry.register(
        new ProviderExtension({
          name: 'xai',
          create: createMockProviderV3
          // 没有 variants
        })
      )
    })

    describe('isVariant', () => {
      it('should return true for variant IDs', () => {
        expect(registry.isVariant('openai-chat')).toBe(true)
        expect(registry.isVariant('azure-responses')).toBe(true)
        expect(registry.isVariant('google-chat')).toBe(true)
      })

      it('should return false for base provider IDs', () => {
        expect(registry.isVariant('openai')).toBe(false)
        expect(registry.isVariant('azure')).toBe(false)
        expect(registry.isVariant('google')).toBe(false)
        expect(registry.isVariant('xai')).toBe(false)
      })

      it('should return false for aliases', () => {
        expect(registry.isVariant('oai')).toBe(false)
        expect(registry.isVariant('gemini')).toBe(false)
        expect(registry.isVariant('azure-openai')).toBe(false)
      })

      it('should return false for unknown IDs', () => {
        expect(registry.isVariant('unknown')).toBe(false)
        expect(registry.isVariant('non-existent-variant')).toBe(false)
      })
    })

    describe('getBaseProviderId', () => {
      it('should return base ID for variant IDs', () => {
        expect(registry.getBaseProviderId('openai-chat')).toBe('openai')
        expect(registry.getBaseProviderId('azure-responses')).toBe('azure')
        expect(registry.getBaseProviderId('google-chat')).toBe('google')
      })

      it('should return base ID for base provider IDs (identity)', () => {
        expect(registry.getBaseProviderId('openai')).toBe('openai')
        expect(registry.getBaseProviderId('azure')).toBe('azure')
        expect(registry.getBaseProviderId('google')).toBe('google')
        expect(registry.getBaseProviderId('xai')).toBe('xai')
      })

      it('should return base ID for aliases', () => {
        expect(registry.getBaseProviderId('oai')).toBe('openai')
        expect(registry.getBaseProviderId('gemini')).toBe('google')
        expect(registry.getBaseProviderId('azure-openai')).toBe('azure')
      })

      it('should return null for unknown IDs', () => {
        expect(registry.getBaseProviderId('unknown')).toBeNull()
        expect(registry.getBaseProviderId('non-existent')).toBeNull()
      })
    })

    describe('getVariantMode', () => {
      it('should return mode/suffix for variant IDs', () => {
        expect(registry.getVariantMode('openai-chat')).toBe('chat')
        expect(registry.getVariantMode('azure-responses')).toBe('responses')
        expect(registry.getVariantMode('google-chat')).toBe('chat')
      })

      it('should return null for base provider IDs', () => {
        expect(registry.getVariantMode('openai')).toBeNull()
        expect(registry.getVariantMode('azure')).toBeNull()
        expect(registry.getVariantMode('google')).toBeNull()
        expect(registry.getVariantMode('xai')).toBeNull()
      })

      it('should return null for aliases', () => {
        expect(registry.getVariantMode('oai')).toBeNull()
        expect(registry.getVariantMode('gemini')).toBeNull()
        expect(registry.getVariantMode('azure-openai')).toBeNull()
      })

      it('should return null for unknown IDs', () => {
        expect(registry.getVariantMode('unknown')).toBeNull()
        expect(registry.getVariantMode('non-existent-variant')).toBeNull()
      })
    })

    describe('getVariants', () => {
      it('should return variant IDs for providers with variants', () => {
        expect(registry.getVariants('openai')).toEqual(['openai-chat'])
        expect(registry.getVariants('azure')).toEqual(['azure-responses'])
        expect(registry.getVariants('google')).toEqual(['google-chat'])
      })

      it('should return empty array for providers without variants', () => {
        expect(registry.getVariants('xai')).toEqual([])
      })

      it('should support aliases in base ID', () => {
        expect(registry.getVariants('oai')).toEqual(['openai-chat'])
        expect(registry.getVariants('gemini')).toEqual(['google-chat'])
        expect(registry.getVariants('azure-openai')).toEqual(['azure-responses'])
      })

      it('should return empty array for unknown IDs', () => {
        expect(registry.getVariants('unknown')).toEqual([])
        expect(registry.getVariants('non-existent')).toEqual([])
      })

      it('should return all variants for providers with multiple variants', () => {
        registry.register(
          new ProviderExtension({
            name: 'multi-variant',
            create: createMockProviderV3,
            variants: [
              {
                suffix: 'chat',
                name: 'Chat',
                transform: (provider) => provider
              },
              {
                suffix: 'responses',
                name: 'Responses',
                transform: (provider) => provider
              },
              {
                suffix: 'completions',
                name: 'Completions',
                transform: (provider) => provider
              }
            ]
          })
        )

        const variants = registry.getVariants('multi-variant')
        expect(variants).toHaveLength(3)
        expect(variants).toContain('multi-variant-chat')
        expect(variants).toContain('multi-variant-responses')
        expect(variants).toContain('multi-variant-completions')
      })
    })

    describe('Integration: All methods working together', () => {
      it('should provide consistent information about a variant', () => {
        const variantId = 'openai-chat'
        // isVariant should confirm it's a variant
        expect(registry.isVariant(variantId)).toBe(true)

        // getBaseProviderId should extract base ID
        expect(registry.getBaseProviderId(variantId)).toBe('openai')

        // getVariantMode should extract mode
        expect(registry.getVariantMode(variantId)).toBe('chat')
        // getVariants should include this variant when querying base ID
        const baseId = registry.getBaseProviderId(variantId)!
        expect(registry.getVariants(baseId)).toContain(variantId)
      })

      it('should provide consistent information about a base provider', () => {
        const baseId = 'openai'

        // isVariant should return false
        expect(registry.isVariant(baseId)).toBe(false)

        // getBaseProviderId should return itself
        expect(registry.getBaseProviderId(baseId)).toBe(baseId)

        // getVariantMode should return null
        expect(registry.getVariantMode(baseId)).toBeNull()

        // getVariants should return its variants
        expect(registry.getVariants(baseId)).toEqual(['openai-chat'])
      })

      it('should provide consistent information about an alias', () => {
        const aliasId = 'oai'

        // isVariant should return false
        expect(registry.isVariant(aliasId)).toBe(false)

        // getBaseProviderId should resolve to base ID
        expect(registry.getBaseProviderId(aliasId)).toBe('openai')

        // getVariantMode should return null
        expect(registry.getVariantMode(aliasId)).toBeNull()

        // getVariants should work with alias
        expect(registry.getVariants(aliasId)).toEqual(['openai-chat'])
      })
    })
  })

  describe('getTyped()', () => {
    it('should return typed extension for registered providers', () => {
      // Register extensions
      registry.register(
        new ProviderExtension({
          name: 'openai',
          create: createMockProviderV3
        })
      )

      const ext = registry.getTyped('openai')
      expect(ext).toBeDefined()
      expect(ext?.config.name).toBe('openai')
    })

    it('should return undefined for unregistered providers', () => {
      const ext = registry.getTyped('unknown' as any)
      expect(ext).toBeUndefined()
    })

    it('should preserve type information (compile-time check)', () => {
      registry.register(
        new ProviderExtension({
          name: 'openai',
          create: createMockProviderV3
        })
      )

      // This test primarily validates compile-time type inference
      // Runtime behavior is the same as get()
      const ext = registry.getTyped('openai')
      expect(ext).toBeDefined()

      // Type should be inferred as ProviderExtension<OpenAIProviderSettings, any, any>
      // but we can't test types at runtime, only compile-time
    })

    it('should work with aliases', () => {
      registry.register(
        new ProviderExtension({
          name: 'openai',
          aliases: ['oai'],
          create: createMockProviderV3
        })
      )

      const ext = registry.getTyped('oai' as any)
      expect(ext).toBeDefined()
      expect(ext?.config.name).toBe('openai')
    })
  })
})
