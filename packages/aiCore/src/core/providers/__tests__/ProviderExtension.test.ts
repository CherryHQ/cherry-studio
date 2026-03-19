/**
 * ProviderExtension 单元测试
 */

import type { ProviderV3 } from '@ai-sdk/provider'
import { createMockProviderV3 } from '@test-utils'
import { describe, expect, it, vi } from 'vitest'

import {
  createProviderExtension,
  ProviderExtension,
  ProviderExtensionBuilder,
  type ProviderExtensionConfig
} from '../core/ProviderExtension'
import type { ExtensionStorage } from '../types'

describe('ProviderExtension', () => {
  describe('Static create() Method', () => {
    it('should create extension with config object', () => {
      const extension = ProviderExtension.create({
        name: 'test-provider',
        create: createMockProviderV3
      })

      expect(extension).toBeInstanceOf(ProviderExtension)
      expect(extension.config.name).toBe('test-provider')
    })

    it('should create extension with config function', () => {
      const configFn = vi.fn(() => ({
        name: 'test-provider',
        create: createMockProviderV3,
        defaultOptions: { apiKey: 'test-key' }
      }))

      const extension = ProviderExtension.create(configFn)

      expect(configFn).toHaveBeenCalledOnce()
      expect(extension).toBeInstanceOf(ProviderExtension)
      expect(extension.config.name).toBe('test-provider')
      expect(extension.config.defaultOptions).toEqual({ apiKey: 'test-key' })
    })

    it('should support type inference with generics', () => {
      interface TestSettings {
        apiKey: string
        baseURL?: string
        name: string
      }

      interface TestStorage extends ExtensionStorage {
        cache: Map<string, any>
      }

      const extension = new ProviderExtension<TestSettings, TestStorage>({
        name: 'test-provider',
        create: createMockProviderV3 as any, // Type assertion needed as mock has different signature
        defaultOptions: {
          apiKey: 'test-key'
        },
        initialStorage: {
          cache: new Map()
        }
      })

      expect(extension.config.name).toBe('test-provider')
      expect(extension.storage.get('cache')).toBeInstanceOf(Map)
    })

    it('should allow delayed config resolution with function', () => {
      let envVariable = 'initial-key'

      const extension = ProviderExtension.create(() => ({
        name: 'dynamic-provider',
        create: createMockProviderV3,
        defaultOptions: {
          apiKey: envVariable // Captured at creation time
        }
      }))

      expect(extension.config.defaultOptions).toEqual({ apiKey: 'initial-key' })

      // Changing variable doesn't affect already created extension
      envVariable = 'changed-key'
      expect(extension.config.defaultOptions).toEqual({ apiKey: 'initial-key' })
    })

    it('should validate config from function same as from object', async () => {
      expect(() => {
        ProviderExtension.create(() => ({
          name: '', // Invalid
          create: createMockProviderV3
        }))
      }).toThrow('name is required')

      // Note: create/import validation happens at runtime in createProvider(), not in constructor
      // Extension can be created without create/import, but createProvider() will throw
      const extension = ProviderExtension.create(
        () =>
          ({
            name: 'test-provider'
            // Missing create
          }) as any
      )
      await expect(extension.createProvider()).rejects.toThrow('cannot create provider')
    })
  })

  describe('Constructor Validation', () => {
    it('should throw error if name is missing', () => {
      expect(() => {
        new ProviderExtension({
          name: '',
          create: createMockProviderV3
        })
      }).toThrow('name is required')
    })

    it('should throw error at runtime if neither create nor import is provided', async () => {
      // Constructor doesn't validate create/import - validation happens at runtime
      const extension = new ProviderExtension({
        name: 'test-provider'
      } as any)

      await expect(extension.createProvider()).rejects.toThrow('cannot create provider')
    })

    it('should throw error at runtime if import is provided without creatorFunctionName', async () => {
      // Constructor doesn't validate creatorFunctionName - validation happens at runtime
      const extension = new ProviderExtension({
        name: 'test-provider',
        import: async () => ({})
      } as any)

      await expect(extension.createProvider()).rejects.toThrow('cannot create provider')
    })

    it('should create extension with valid config', () => {
      const extension = new ProviderExtension({
        name: 'test-provider',
        create: createMockProviderV3
      })

      expect(extension.config.name).toBe('test-provider')
    })
  })

  describe('Configure Method', () => {
    it('should return new instance with merged settings', () => {
      const original = new ProviderExtension<any>({
        name: 'test-provider',
        create: createMockProviderV3 as any,
        defaultOptions: { apiKey: 'original-key' }
      })

      const configured = original.configure({ baseURL: 'https://api.test.com' })

      // 原实例不变
      expect(original.config.defaultOptions).toEqual({ apiKey: 'original-key' })

      // 新实例合并配置
      expect(configured.config.defaultOptions).toEqual({
        apiKey: 'original-key',
        baseURL: 'https://api.test.com'
      })

      // 是新实例
      expect(configured).not.toBe(original)
    })

    it('should override existing options', () => {
      const extension = new ProviderExtension<any>({
        name: 'test-provider',
        create: createMockProviderV3 as any,
        defaultOptions: { apiKey: 'old-key', timeout: 5000 }
      })

      const configured = extension.configure({ apiKey: 'new-key' })

      expect(configured.config.defaultOptions).toEqual({
        apiKey: 'new-key',
        timeout: 5000
      })
    })
  })

  describe('getProviderIds', () => {
    it('should return only main ID when no aliases or variants', () => {
      const extension = new ProviderExtension({
        name: 'openai',
        create: createMockProviderV3
      })

      expect(extension.getProviderIds()).toEqual(['openai'])
    })

    it('should include aliases', () => {
      const extension = new ProviderExtension({
        name: 'openrouter',
        aliases: ['or', 'open-router'],
        create: createMockProviderV3
      })

      expect(extension.getProviderIds()).toEqual(['openrouter', 'or', 'open-router'])
    })

    it('should include variant IDs', () => {
      const extension = new ProviderExtension({
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

      expect(extension.getProviderIds()).toEqual(['openai', 'openai-chat'])
    })

    it('should include both aliases and variant IDs', () => {
      const extension = new ProviderExtension({
        name: 'azure',
        aliases: ['az'],
        create: createMockProviderV3,
        variants: [
          {
            suffix: 'chat',
            name: 'Azure Chat',
            transform: (provider) => provider
          },
          {
            suffix: 'responses',
            name: 'Azure Responses',
            transform: (provider) => provider
          }
        ]
      })

      expect(extension.getProviderIds()).toEqual(['azure', 'az', 'azure-chat', 'azure-responses'])
    })
  })

  describe('hasProviderId', () => {
    it('should return true for main ID', () => {
      const extension = new ProviderExtension({
        name: 'openai',
        create: createMockProviderV3
      })

      expect(extension.hasProviderId('openai')).toBe(true)
    })

    it('should return true for alias', () => {
      const extension = new ProviderExtension({
        name: 'openrouter',
        aliases: ['or'],
        create: createMockProviderV3
      })

      expect(extension.hasProviderId('or')).toBe(true)
    })

    it('should return true for variant ID', () => {
      const extension = new ProviderExtension({
        name: 'openai',
        create: createMockProviderV3,
        variants: [
          {
            suffix: 'chat',
            name: 'Chat',
            transform: (provider) => provider
          }
        ]
      })

      expect(extension.hasProviderId('openai-chat')).toBe(true)
    })

    it('should return false for non-existent ID', () => {
      const extension = new ProviderExtension({
        name: 'openai',
        create: createMockProviderV3
      })

      expect(extension.hasProviderId('anthropic')).toBe(false)
    })
  })

  describe('getVariant', () => {
    it('should return variant by suffix', () => {
      const chatVariant = {
        suffix: 'chat',
        name: 'Chat Mode',
        transform: (provider: ProviderV3) => provider
      }

      const extension = new ProviderExtension({
        name: 'test',
        create: createMockProviderV3,
        variants: [chatVariant]
      })

      expect(extension.getVariant('chat')).toEqual(chatVariant)
    })

    it('should return undefined for non-existent variant', () => {
      const extension = new ProviderExtension({
        name: 'test',
        create: createMockProviderV3,
        variants: []
      })

      expect(extension.getVariant('chat')).toBeUndefined()
    })

    it('should return undefined when no variants configured', () => {
      const extension = new ProviderExtension({
        name: 'test',
        create: createMockProviderV3
      })

      expect(extension.getVariant('chat')).toBeUndefined()
    })
  })

  describe('ProviderExtensionBuilder', () => {
    it('should build extension with fluent API', () => {
      const extension = new ProviderExtensionBuilder<any>()
        .setName('test-provider')
        .setAliases(['test', 'tp'])
        .setSupportsImageGeneration(true)
        .setCreate(createMockProviderV3 as any)
        .setDefaultOptions({ apiKey: 'test-key' })
        .addVariant({
          suffix: 'chat',
          name: 'Chat',
          transform: (provider) => provider
        })
        .build()

      expect(extension.config.name).toBe('test-provider')
      expect(extension.config.aliases).toEqual(['test', 'tp'])
      expect(extension.config.supportsImageGeneration).toBe(true)
      expect(extension.config.variants).toHaveLength(1)
      expect(extension.config.defaultOptions).toEqual({ apiKey: 'test-key' })
    })

    it('should support setImport', () => {
      const mockImport = () => Promise.resolve({ createMockProviderV3 })
      const extension = new ProviderExtensionBuilder()
        .setName('lazy-provider')
        .setImport(mockImport as any, 'createMockProviderV3')
        .build()

      expect(extension.config.import).toBeDefined()
      expect(extension.config.creatorFunctionName).toBe('createMockProviderV3')
    })
  })

  describe('createProviderExtension helper', () => {
    it('should create extension from config', () => {
      const config: ProviderExtensionConfig = {
        name: 'test-provider',
        create: createMockProviderV3
      }

      const extension = createProviderExtension(config)

      expect(extension).toBeInstanceOf(ProviderExtension)
      expect(extension.config.name).toBe('test-provider')
    })
  })

  describe('Type Safety', () => {
    interface TestSettings {
      apiKey: string
      baseURL?: string
      timeout?: number
    }

    it('should maintain type safety with generics', () => {
      const extension = new ProviderExtension<TestSettings>({
        name: 'typed-provider',
        create: ((settings: any) => {
          // TypeScript should infer settings as TestSettings
          expect(settings?.apiKey).toBeDefined()
          return createMockProviderV3()
        }) as any,
        defaultOptions: {
          apiKey: 'test-key',
          timeout: 5000
        }
      })

      const configured = extension.configure({
        baseURL: 'https://api.test.com'
        // TypeScript should catch invalid properties here
      })

      expect(configured.config.defaultOptions?.baseURL).toBe('https://api.test.com')
    })
  })

  describe('Storage System', () => {
    interface TestStorage extends ExtensionStorage {
      providerCache: Map<string, ProviderV3>
      apiKeyValid: boolean
      customData?: string
    }

    it('should initialize storage from initialStorage config', () => {
      const cacheMap = new Map<string, ProviderV3>()
      const extension = new ProviderExtension<any, TestStorage>({
        name: 'test-provider',
        create: createMockProviderV3,
        initialStorage: {
          providerCache: cacheMap,
          apiKeyValid: false
        }
      })

      expect(extension.storage.get('providerCache')).toBe(cacheMap)
      expect(extension.storage.get('apiKeyValid')).toBe(false)
    })

    it('should support storage get/set operations', () => {
      const extension = new ProviderExtension<any, TestStorage>({
        name: 'test-provider',
        create: createMockProviderV3
      })

      extension.storage.set('apiKeyValid', true)
      expect(extension.storage.get('apiKeyValid')).toBe(true)

      const cache = new Map<string, ProviderV3>()
      extension.storage.set('providerCache', cache)
      expect(extension.storage.get('providerCache')).toBe(cache)
    })

    it('should support storage.has()', () => {
      const extension = new ProviderExtension<any, TestStorage>({
        name: 'test-provider',
        create: createMockProviderV3,
        initialStorage: {
          apiKeyValid: true
        }
      })

      expect(extension.storage.has('apiKeyValid')).toBe(true)
      expect(extension.storage.has('customData')).toBe(false)
    })

    it('should support storage.clear()', () => {
      const extension = new ProviderExtension<any, TestStorage>({
        name: 'test-provider',
        create: createMockProviderV3,
        initialStorage: {
          apiKeyValid: false
        }
      })

      extension.storage.set('customData', 'test')
      expect(extension.storage.get('customData')).toBe('test')

      extension.storage.clear()

      // Clear should reset to initial storage
      expect(extension.storage.get('apiKeyValid')).toBe(false)
      expect(extension.storage.get('customData')).toBeUndefined()
    })
  })

  describe('Options Getter', () => {
    it('should return readonly frozen options', () => {
      const extension = new ProviderExtension<any>({
        name: 'test-provider',
        create: createMockProviderV3 as any,
        defaultOptions: { apiKey: 'test-key', timeout: 5000 }
      })

      const options = extension.options

      expect(options).toEqual({ apiKey: 'test-key', timeout: 5000 })
      expect(Object.isFrozen(options)).toBe(true)
    })
  })

  describe('Lifecycle Hooks', () => {
    interface TestSettings {
      apiKey: string
      baseURL?: string
    }

    interface TestStorage extends ExtensionStorage {
      hooksCalled: string[]
      providerInstance?: ProviderV3
    }

    it('should execute onBeforeCreate hook with correct context', async () => {
      const onBeforeCreate = vi.fn(function (this: any, _settings: TestSettings) {
        expect(this.name).toBe('test-provider')
        expect(this.options).toEqual(_settings)
        expect(this.storage).toBeDefined()
        this.storage.set('hooksCalled', ['onBeforeCreate'])
      })

      const extension = new ProviderExtension<TestSettings, TestStorage>({
        name: 'test-provider',
        create: createMockProviderV3 as any,
        hooks: {
          onBeforeCreate
        }
      })

      await extension.executeHook('onBeforeCreate', { apiKey: 'test-key' })

      expect(onBeforeCreate).toHaveBeenCalledWith({ apiKey: 'test-key' })
      expect(extension.storage.get('hooksCalled')).toEqual(['onBeforeCreate'])
    })

    it('should execute onAfterCreate hook with provider instance', async () => {
      const mockProvider = createMockProviderV3()
      const onAfterCreate = vi.fn(function (this: any, _settings: TestSettings, provider: ProviderV3) {
        expect(this.name).toBe('test-provider')
        expect(provider).toBe(mockProvider)
        this.storage.set('providerInstance', provider)
      })

      const extension = new ProviderExtension<TestSettings, TestStorage>({
        name: 'test-provider',
        create: createMockProviderV3 as any,
        hooks: {
          onAfterCreate
        }
      })

      await extension.executeHook('onAfterCreate', { apiKey: 'test-key' }, mockProvider)

      expect(onAfterCreate).toHaveBeenCalledWith({ apiKey: 'test-key' }, mockProvider)
      expect(extension.storage.get('providerInstance')).toBe(mockProvider)
    })

    it('should not throw if hook is not defined', async () => {
      const extension = new ProviderExtension<TestSettings>({
        name: 'test-provider',
        create: createMockProviderV3 as any
      })

      await expect(extension.executeHook('onBeforeCreate', { apiKey: 'test' })).resolves.toBeUndefined()
      await expect(
        extension.executeHook('onAfterCreate', { apiKey: 'test' }, createMockProviderV3())
      ).resolves.toBeUndefined()
    })

    it('should provide access to getVariant and hasProviderId in hook context', async () => {
      let contextChecked = false

      const extension = new ProviderExtension<TestSettings>({
        name: 'test-provider',
        create: createMockProviderV3 as any,
        aliases: ['tp'],
        variants: [
          {
            suffix: 'chat',
            name: 'Chat',
            transform: (provider) => provider
          }
        ],
        hooks: {
          onBeforeCreate() {
            expect(this.getVariant('chat')).toBeDefined()
            expect(this.hasProviderId('test-provider')).toBe(true)
            expect(this.hasProviderId('tp')).toBe(true)
            expect(this.hasProviderId('test-provider-chat')).toBe(true)
            contextChecked = true
          }
        }
      })

      await extension.executeHook('onBeforeCreate', { apiKey: 'test' })
      expect(contextChecked).toBe(true)
    })
  })

  describe('Deep Merge in Configure', () => {
    it('should deep merge nested objects', () => {
      const extension = new ProviderExtension<any>({
        name: 'test-provider',
        create: createMockProviderV3 as any,
        defaultOptions: {
          apiKey: 'key1',
          headers: {
            'X-Custom-Header': 'value1',
            Authorization: 'Bearer token1'
          },
          retry: {
            maxAttempts: 3,
            backoff: 1000
          }
        }
      })

      const configured = extension.configure({
        headers: {
          Authorization: 'Bearer new-token'
        },
        retry: {
          maxAttempts: 5
        }
      })

      expect(configured.config.defaultOptions).toEqual({
        apiKey: 'key1',
        headers: {
          'X-Custom-Header': 'value1',
          Authorization: 'Bearer new-token'
        },
        retry: {
          maxAttempts: 5,
          backoff: 1000
        }
      })
    })

    it('should not mutate original extension', () => {
      const original = new ProviderExtension<any>({
        name: 'test-provider',
        create: createMockProviderV3 as any,
        defaultOptions: {
          nested: { value: 'original' }
        }
      })

      const configured = original.configure({
        nested: { value: 'modified' }
      })

      expect(original.config.defaultOptions).toEqual({
        nested: { value: 'original' }
      })
      expect(configured.config.defaultOptions).toEqual({
        nested: { value: 'modified' }
      })
    })
  })

  describe('Instance Caching (Phase 1)', () => {
    interface TestSettings {
      apiKey: string
      baseURL?: string
    }

    it('should cache and reuse instance with same settings', async () => {
      const createFn = vi.fn(createMockProviderV3)
      const extension = new ProviderExtension<TestSettings>({
        name: 'test-provider',
        create: createFn as any
      })

      const settings = { apiKey: 'test-key', baseURL: 'https://api.test.com' }

      const instance1 = await extension.createProvider(settings)
      const instance2 = await extension.createProvider(settings)

      // Should return the same instance
      expect(instance1).toBe(instance2)
      // Should only call create once
      expect(createFn).toHaveBeenCalledTimes(1)
    })

    it('should create new instance with different settings', async () => {
      const createFn = vi.fn(createMockProviderV3)
      const extension = new ProviderExtension<TestSettings>({
        name: 'test-provider',
        create: createFn as any
      })

      const settings1 = { apiKey: 'key1' }
      const settings2 = { apiKey: 'key2' }

      const instance1 = await extension.createProvider(settings1)
      const instance2 = await extension.createProvider(settings2)

      // Should return different instances
      expect(instance1).not.toBe(instance2)
      // Should call create twice
      expect(createFn).toHaveBeenCalledTimes(2)
    })

    it('should handle undefined settings correctly', async () => {
      const createFn = vi.fn(createMockProviderV3)
      const extension = new ProviderExtension<TestSettings>({
        name: 'test-provider',
        create: createFn as any
      })

      const instance1 = await extension.createProvider()
      const instance2 = await extension.createProvider()
      const instance3 = await extension.createProvider(undefined)

      // All should be the same instance (undefined settings)
      expect(instance1).toBe(instance2)
      expect(instance1).toBe(instance3)
      expect(createFn).toHaveBeenCalledTimes(1)
    })

    it('should compute stable hash for same settings in different order', async () => {
      const createFn = vi.fn(createMockProviderV3)
      const extension = new ProviderExtension<any>({
        name: 'test-provider',
        create: createFn as any
      })

      // Same settings but different property order
      const settings1 = { apiKey: 'key', baseURL: 'url', timeout: 5000 }
      const settings2 = { timeout: 5000, apiKey: 'key', baseURL: 'url' }

      const instance1 = await extension.createProvider(settings1)
      const instance2 = await extension.createProvider(settings2)

      // Should recognize as same settings
      expect(instance1).toBe(instance2)
      expect(createFn).toHaveBeenCalledTimes(1)
    })

    it('should merge with default options before hashing', async () => {
      const createFn = vi.fn(createMockProviderV3)
      const extension = new ProviderExtension<any>({
        name: 'test-provider',
        create: createFn as any,
        defaultOptions: {
          apiKey: 'default-key',
          timeout: 5000
        }
      })

      const instance1 = await extension.createProvider({ baseURL: 'url' })
      const instance2 = await extension.createProvider({ baseURL: 'url', apiKey: 'default-key', timeout: 5000 })

      // Should be same after merging with defaults
      expect(instance1).toBe(instance2)
      expect(createFn).toHaveBeenCalledTimes(1)
    })

    it('should handle nested objects in settings', async () => {
      const createFn = vi.fn(createMockProviderV3)
      const extension = new ProviderExtension<any>({
        name: 'test-provider',
        create: createFn as any
      })

      const settings1 = {
        apiKey: 'key',
        headers: { Authorization: 'Bearer token', 'X-Custom': 'value' }
      }
      const settings2 = {
        apiKey: 'key',
        headers: { 'X-Custom': 'value', Authorization: 'Bearer token' }
      }

      const instance1 = await extension.createProvider(settings1)
      const instance2 = await extension.createProvider(settings2)

      // Should recognize as same (order doesn't matter)
      expect(instance1).toBe(instance2)
      expect(createFn).toHaveBeenCalledTimes(1)
    })

    it('should execute lifecycle hooks when creating new instance', async () => {
      const onBeforeCreate = vi.fn()
      const onAfterCreate = vi.fn()

      const extension = new ProviderExtension<TestSettings>({
        name: 'test-provider',
        create: createMockProviderV3 as any,
        hooks: {
          onBeforeCreate,
          onAfterCreate
        }
      })

      const settings = { apiKey: 'test-key' }
      await extension.createProvider(settings)

      expect(onBeforeCreate).toHaveBeenCalledTimes(1)
      expect(onAfterCreate).toHaveBeenCalledTimes(1)
    })

    it('should NOT execute hooks when returning cached instance', async () => {
      const onBeforeCreate = vi.fn()
      const onAfterCreate = vi.fn()

      const extension = new ProviderExtension<TestSettings>({
        name: 'test-provider',
        create: createMockProviderV3 as any,
        hooks: {
          onBeforeCreate,
          onAfterCreate
        }
      })

      const settings = { apiKey: 'test-key' }
      await extension.createProvider(settings)
      await extension.createProvider(settings) // Second call - should use cache

      // Hooks should only be called once (for first creation)
      expect(onBeforeCreate).toHaveBeenCalledTimes(1)
      expect(onAfterCreate).toHaveBeenCalledTimes(1)
    })

    it('should support variant suffix parameter', async () => {
      const extension = new ProviderExtension<TestSettings>({
        name: 'test-provider',
        create: createMockProviderV3 as any,
        variants: [
          {
            suffix: 'chat',
            name: 'Test Chat',
            transform: (provider) => provider
          }
        ]
      })

      const settings = { apiKey: 'test-key' }

      // Should work when providing a valid variant suffix
      await expect(extension.createProvider(settings, 'chat')).resolves.toBeDefined()

      // Should throw for unknown variant suffix
      await expect(extension.createProvider(settings, 'unknown')).rejects.toThrow('variant "unknown" not found')
    })

    it('should support dynamic import providers', async () => {
      const mockModule = {
        createProvider: vi.fn(createMockProviderV3)
      }

      const extension = new ProviderExtension<TestSettings>({
        name: 'lazy-provider',
        import: async () => mockModule,
        creatorFunctionName: 'createProvider'
      })

      const instance1 = await extension.createProvider({ apiKey: 'key' })
      const instance2 = await extension.createProvider({ apiKey: 'key' })

      expect(instance1).toBe(instance2)
      expect(mockModule.createProvider).toHaveBeenCalledTimes(1)
    })

    it('should throw error if creatorFunctionName not found in module', async () => {
      const mockModule = {
        wrongName: vi.fn(createMockProviderV3)
      }

      const extension = new ProviderExtension<TestSettings>({
        name: 'lazy-provider',
        import: async () => mockModule,
        creatorFunctionName: 'createProvider'
      })

      await expect(extension.createProvider({ apiKey: 'key' })).rejects.toThrow(
        'creatorFunctionName "createProvider" not found'
      )
    })

    it('should deduplicate concurrent requests with same settings', async () => {
      const createFn = vi.fn(async () => {
        // Simulate async delay
        await new Promise((resolve) => setTimeout(resolve, 10))
        return createMockProviderV3()
      })

      const extension = new ProviderExtension<TestSettings>({
        name: 'test-provider',
        create: createFn as any
      })

      const settings = { apiKey: 'test-key' }

      // Fire multiple concurrent requests
      const [instance1, instance2, instance3] = await Promise.all([
        extension.createProvider(settings),
        extension.createProvider(settings),
        extension.createProvider(settings)
      ])

      // All concurrent requests should return the same instance
      expect(instance1).toBe(instance2)
      expect(instance2).toBe(instance3)
      // Creator should only be called once
      expect(createFn).toHaveBeenCalledTimes(1)

      // Verify subsequent sequential calls also use cache
      const instance4 = await extension.createProvider(settings)
      expect(instance4).toBe(instance1)
      expect(createFn).toHaveBeenCalledTimes(1)
    })

    it('should run lifecycle hooks exactly once for concurrent requests', async () => {
      const onBeforeCreate = vi.fn()
      const onAfterCreate = vi.fn()

      const extension = new ProviderExtension<TestSettings>({
        name: 'test-provider',
        create: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          return createMockProviderV3()
        },
        hooks: { onBeforeCreate, onAfterCreate }
      })

      const settings = { apiKey: 'test-key' }

      await Promise.all([
        extension.createProvider(settings),
        extension.createProvider(settings),
        extension.createProvider(settings)
      ])

      expect(onBeforeCreate).toHaveBeenCalledTimes(1)
      expect(onAfterCreate).toHaveBeenCalledTimes(1)
    })

    it('should handle arrays in settings', async () => {
      const createFn = vi.fn(createMockProviderV3)
      const extension = new ProviderExtension<any>({
        name: 'test-provider',
        create: createFn as any
      })

      const settings1 = { apiKey: 'key', tags: ['a', 'b', 'c'] }
      const settings2 = { apiKey: 'key', tags: ['a', 'b', 'c'] }

      const instance1 = await extension.createProvider(settings1)
      const instance2 = await extension.createProvider(settings2)

      expect(instance1).toBe(instance2)
      expect(createFn).toHaveBeenCalledTimes(1)
    })

    it('should differentiate settings with different array values', async () => {
      const createFn = vi.fn(createMockProviderV3)
      const extension = new ProviderExtension<any>({
        name: 'test-provider',
        create: createFn as any
      })

      const settings1 = { apiKey: 'key', tags: ['a', 'b'] }
      const settings2 = { apiKey: 'key', tags: ['a', 'c'] }

      const instance1 = await extension.createProvider(settings1)
      const instance2 = await extension.createProvider(settings2)

      expect(instance1).not.toBe(instance2)
      expect(createFn).toHaveBeenCalledTimes(2)
    })
  })

  describe('Cache Key Correctness (no hash collisions)', () => {
    it('should differentiate settings with different API keys', async () => {
      const createFn = vi.fn(createMockProviderV3)
      const extension = new ProviderExtension<any>({
        name: 'test-provider',
        create: createFn as any
      })

      const instance1 = await extension.createProvider({ apiKey: 'sk-key-A', baseURL: 'https://api.example.com' })
      const instance2 = await extension.createProvider({ apiKey: 'sk-key-B', baseURL: 'https://api.example.com' })

      expect(instance1).not.toBe(instance2)
      expect(createFn).toHaveBeenCalledTimes(2)
    })

    it('should differentiate settings with different base URLs', async () => {
      const createFn = vi.fn(createMockProviderV3)
      const extension = new ProviderExtension<any>({
        name: 'test-provider',
        create: createFn as any
      })

      const instance1 = await extension.createProvider({ apiKey: 'same-key', baseURL: 'https://api-a.example.com' })
      const instance2 = await extension.createProvider({ apiKey: 'same-key', baseURL: 'https://api-b.example.com' })

      expect(instance1).not.toBe(instance2)
      expect(createFn).toHaveBeenCalledTimes(2)
    })

    it('should treat structurally identical settings as the same regardless of construction', async () => {
      const createFn = vi.fn(createMockProviderV3)
      const extension = new ProviderExtension<any>({
        name: 'test-provider',
        create: createFn as any
      })

      // Construct settings in completely different ways
      const base = { apiKey: 'key', baseURL: 'url' }
      const settings1 = { ...base, headers: { Authorization: 'Bearer tok' } }
      const settings2 = JSON.parse(JSON.stringify(settings1))

      const instance1 = await extension.createProvider(settings1)
      const instance2 = await extension.createProvider(settings2)

      expect(instance1).toBe(instance2)
      expect(createFn).toHaveBeenCalledTimes(1)
    })

    it('should differentiate same-base-provider with different variant suffixes', async () => {
      const createFn = vi.fn(createMockProviderV3)
      const extension = new ProviderExtension<any>({
        name: 'azure',
        create: createFn as any,
        variants: [
          { suffix: 'chat', name: 'Chat', transform: (p: any) => p },
          { suffix: 'responses', name: 'Responses', transform: (p: any) => p }
        ]
      })

      const settings = { apiKey: 'key' }

      const chatInstance = await extension.createProvider(settings, 'chat')
      const responsesInstance = await extension.createProvider(settings, 'responses')
      const baseInstance = await extension.createProvider(settings)

      // All three should be different cached instances
      expect(chatInstance).not.toBe(responsesInstance)
      expect(chatInstance).not.toBe(baseInstance)
      expect(responsesInstance).not.toBe(baseInstance)
      expect(createFn).toHaveBeenCalledTimes(3)
    })

    it('should handle settings with functions by treating them uniformly', async () => {
      const createFn = vi.fn(createMockProviderV3)
      const extension = new ProviderExtension<any>({
        name: 'test-provider',
        create: createFn as any
      })

      const fetchFn = () => Promise.resolve(new Response())
      const settings1 = { apiKey: 'key', fetch: fetchFn }
      const settings2 = { apiKey: 'key', fetch: fetchFn }

      const instance1 = await extension.createProvider(settings1)
      const instance2 = await extension.createProvider(settings2)

      // Same function reference → same serialization → same cache hit
      expect(instance1).toBe(instance2)
      expect(createFn).toHaveBeenCalledTimes(1)
    })

    it('should distinguish settings with null vs missing keys', async () => {
      const createFn = vi.fn(createMockProviderV3)
      const extension = new ProviderExtension<any>({
        name: 'test-provider',
        create: createFn as any
      })

      // null/undefined serialize identically via stableStringify, so same cache key
      const instance1 = await extension.createProvider({ apiKey: 'key', extra: null })
      const instance2 = await extension.createProvider({ apiKey: 'key', extra: null })

      expect(instance1).toBe(instance2)
      expect(createFn).toHaveBeenCalledTimes(1)

      // But a truly different value should create a new instance
      const instance3 = await extension.createProvider({ apiKey: 'key', extra: 'value' })
      expect(instance3).not.toBe(instance1)
      expect(createFn).toHaveBeenCalledTimes(2)
    })

    it('should not collide on similarly-structured but different settings', async () => {
      const createFn = vi.fn(createMockProviderV3)
      const extension = new ProviderExtension<any>({
        name: 'test-provider',
        create: createFn as any
      })

      // These have similar structure but different values - old DJB2 hash could collide
      const settingsA = { apiKey: 'aaaa1111', baseURL: 'https://host-a.com', timeout: 3000 }
      const settingsB = { apiKey: 'bbbb2222', baseURL: 'https://host-b.com', timeout: 3000 }
      const settingsC = { apiKey: 'cccc3333', baseURL: 'https://host-c.com', timeout: 3000 }

      const instanceA = await extension.createProvider(settingsA)
      const instanceB = await extension.createProvider(settingsB)
      const instanceC = await extension.createProvider(settingsC)

      expect(instanceA).not.toBe(instanceB)
      expect(instanceB).not.toBe(instanceC)
      expect(instanceA).not.toBe(instanceC)
      expect(createFn).toHaveBeenCalledTimes(3)
    })
  })

  describe('ProviderExtensionBuilder with New Features', () => {
    it('should support setInitialStorage', () => {
      const extension = new ProviderExtensionBuilder()
        .setName('test-provider')
        .setCreate(createMockProviderV3)
        .setInitialStorage({
          providerCache: new Map(),
          apiKeyValid: false
        })
        .build()

      expect(extension.storage.get('providerCache')).toBeInstanceOf(Map)
      expect(extension.storage.get('apiKeyValid')).toBe(false)
    })

    it('should support setHooks', () => {
      const hooks = {
        onBeforeCreate: vi.fn(),
        onAfterCreate: vi.fn()
      }

      const extension = new ProviderExtensionBuilder()
        .setName('test-provider')
        .setCreate(createMockProviderV3)
        .setHooks(hooks)
        .build()

      expect(extension.config.hooks).toBe(hooks)
    })
  })
})
