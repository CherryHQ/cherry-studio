/**
 * 测试真正的 AiProviderRegistry 功能
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// 模拟 AI SDK
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => ({ name: 'openai-mock' }))
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => ({ name: 'anthropic-mock' }))
}))

vi.mock('@ai-sdk/azure', () => ({
  createAzure: vi.fn(() => ({ name: 'azure-mock' }))
}))

vi.mock('@ai-sdk/deepseek', () => ({
  createDeepSeek: vi.fn(() => ({ name: 'deepseek-mock' }))
}))

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => ({ name: 'google-mock' }))
}))

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn(() => ({ name: 'openai-compatible-mock' }))
}))

vi.mock('@ai-sdk/xai', () => ({
  createXai: vi.fn(() => ({ name: 'xai-mock' }))
}))

import {
  cleanup,
  clearAllProviders,
  createAndRegisterProvider,
  createProvider,
  getAllProviderConfigAliases,
  getAllProviderConfigs,
  getInitializedProviders,
  getLanguageModel,
  getProviderConfig,
  getProviderConfigByAlias,
  getSupportedProviders,
  hasInitializedProviders,
  hasProviderConfig,
  hasProviderConfigByAlias,
  isProviderConfigAlias,
  ProviderInitializationError,
  providerRegistry,
  registerMultipleProviderConfigs,
  registerProvider,
  registerProviderConfig,
  resolveProviderConfigId
} from '../registry'
import type { ProviderConfig } from '../schemas'

describe('Provider Registry 功能测试', () => {
  beforeEach(() => {
    // 清理状态
    cleanup()
  })

  describe('基础功能', () => {
    it('能够获取支持的 providers 列表', () => {
      const providers = getSupportedProviders()
      expect(Array.isArray(providers)).toBe(true)
      expect(providers.length).toBeGreaterThan(0)

      // 检查返回的数据结构
      providers.forEach((provider) => {
        expect(provider).toHaveProperty('id')
        expect(provider).toHaveProperty('name')
        expect(typeof provider.id).toBe('string')
        expect(typeof provider.name).toBe('string')
      })

      // 包含基础 providers
      const providerIds = providers.map((p) => p.id)
      expect(providerIds).toContain('openai')
      expect(providerIds).toContain('anthropic')
      expect(providerIds).toContain('google')
    })

    it('能够获取已初始化的 providers', () => {
      // 初始状态下没有已初始化的 providers
      expect(getInitializedProviders()).toEqual([])
      expect(hasInitializedProviders()).toBe(false)
    })

    it('能够访问全局注册管理器', () => {
      expect(providerRegistry).toBeDefined()
      expect(typeof providerRegistry.clear).toBe('function')
      expect(typeof providerRegistry.getRegisteredProviders).toBe('function')
      expect(typeof providerRegistry.hasProviders).toBe('function')
    })

    it('能够获取语言模型', () => {
      // 在没有注册 provider 的情况下，这个函数应该会抛出错误
      expect(() => getLanguageModel('non-existent')).toThrow('No providers registered')
    })
  })

  describe('Provider 配置注册', () => {
    it('能够注册自定义 provider 配置', () => {
      const config: ProviderConfig = {
        id: 'custom-provider',
        name: 'Custom Provider',
        creator: vi.fn(() => ({ name: 'custom' })),
        supportsImageGeneration: false
      }

      const success = registerProviderConfig(config)
      expect(success).toBe(true)

      expect(hasProviderConfig('custom-provider')).toBe(true)
      expect(getProviderConfig('custom-provider')).toEqual(config)
    })

    it('能够注册带别名的 provider 配置', () => {
      const config: ProviderConfig = {
        id: 'custom-provider-with-aliases',
        name: 'Custom Provider with Aliases',
        creator: vi.fn(() => ({ name: 'custom-aliased' })),
        supportsImageGeneration: false,
        aliases: ['alias-1', 'alias-2']
      }

      const success = registerProviderConfig(config)
      expect(success).toBe(true)

      expect(hasProviderConfigByAlias('alias-1')).toBe(true)
      expect(hasProviderConfigByAlias('alias-2')).toBe(true)
      expect(getProviderConfigByAlias('alias-1')).toEqual(config)
      expect(resolveProviderConfigId('alias-1')).toBe('custom-provider-with-aliases')
    })

    it('拒绝无效的配置', () => {
      // 缺少必要字段
      const invalidConfig = {
        id: 'invalid-provider'
        // 缺少 name, creator 等
      }

      const success = registerProviderConfig(invalidConfig as any)
      expect(success).toBe(false)
    })

    it('能够批量注册 provider 配置', () => {
      const configs: ProviderConfig[] = [
        {
          id: 'provider-1',
          name: 'Provider 1',
          creator: vi.fn(() => ({ name: 'provider-1' })),
          supportsImageGeneration: false
        },
        {
          id: 'provider-2',
          name: 'Provider 2',
          creator: vi.fn(() => ({ name: 'provider-2' })),
          supportsImageGeneration: true
        },
        {
          id: '', // 无效配置
          name: 'Invalid Provider',
          creator: vi.fn(() => ({ name: 'invalid' })),
          supportsImageGeneration: false
        } as any
      ]

      const successCount = registerMultipleProviderConfigs(configs)
      expect(successCount).toBe(2) // 只有前两个成功

      expect(hasProviderConfig('provider-1')).toBe(true)
      expect(hasProviderConfig('provider-2')).toBe(true)
      expect(hasProviderConfig('')).toBe(false)
    })

    it('能够获取所有配置和别名信息', () => {
      // 注册一些配置
      registerProviderConfig({
        id: 'test-provider',
        name: 'Test Provider',
        creator: vi.fn(),
        supportsImageGeneration: false,
        aliases: ['test-alias']
      })

      const allConfigs = getAllProviderConfigs()
      expect(Array.isArray(allConfigs)).toBe(true)
      expect(allConfigs.some((config) => config.id === 'test-provider')).toBe(true)

      const aliases = getAllProviderConfigAliases()
      expect(aliases['test-alias']).toBe('test-provider')
      expect(isProviderConfigAlias('test-alias')).toBe(true)
    })
  })

  describe('Provider 创建和注册', () => {
    it('能够创建 provider 实例', async () => {
      const config: ProviderConfig = {
        id: 'test-create-provider',
        name: 'Test Create Provider',
        creator: vi.fn(() => ({ name: 'test-created' })),
        supportsImageGeneration: false
      }

      // 先注册配置
      registerProviderConfig(config)

      // 创建 provider 实例
      const provider = await createProvider('test-create-provider', { apiKey: 'test' })
      expect(provider).toBeDefined()
      expect(config.creator).toHaveBeenCalledWith({ apiKey: 'test' })
    })

    it('能够注册 provider 到全局管理器', () => {
      const mockProvider = { name: 'mock-provider' }
      const config: ProviderConfig = {
        id: 'test-register-provider',
        name: 'Test Register Provider',
        creator: vi.fn(() => mockProvider),
        supportsImageGeneration: false
      }

      // 先注册配置
      registerProviderConfig(config)

      // 注册 provider 到全局管理器
      const success = registerProvider('test-register-provider', mockProvider)
      expect(success).toBe(true)

      // 验证注册成功
      const registeredProviders = getInitializedProviders()
      expect(registeredProviders).toContain('test-register-provider')
      expect(hasInitializedProviders()).toBe(true)
    })

    it('能够一步完成创建和注册', async () => {
      const config: ProviderConfig = {
        id: 'test-create-and-register',
        name: 'Test Create and Register',
        creator: vi.fn(() => ({ name: 'test-both' })),
        supportsImageGeneration: false
      }

      // 先注册配置
      registerProviderConfig(config)

      // 一步完成创建和注册
      const success = await createAndRegisterProvider('test-create-and-register', { apiKey: 'test' })
      expect(success).toBe(true)

      // 验证注册成功
      const registeredProviders = getInitializedProviders()
      expect(registeredProviders).toContain('test-create-and-register')
    })
  })

  describe('Registry 管理', () => {
    it('能够清理所有配置和注册的 providers', () => {
      // 注册一些配置
      registerProviderConfig({
        id: 'temp-provider',
        name: 'Temp Provider',
        creator: vi.fn(() => ({ name: 'temp' })),
        supportsImageGeneration: false
      })

      expect(hasProviderConfig('temp-provider')).toBe(true)

      // 清理
      cleanup()

      expect(hasProviderConfig('temp-provider')).toBe(false)
      // 但基础配置应该重新加载
      expect(hasProviderConfig('openai')).toBe(true) // 基础 providers 会重新初始化
    })

    it('能够单独清理已注册的 providers', () => {
      // 清理所有 providers
      clearAllProviders()

      expect(getInitializedProviders()).toEqual([])
      expect(hasInitializedProviders()).toBe(false)
    })

    it('ProviderInitializationError 错误类工作正常', () => {
      const error = new ProviderInitializationError('Test error', 'test-provider')
      expect(error.message).toBe('Test error')
      expect(error.providerId).toBe('test-provider')
      expect(error.name).toBe('ProviderInitializationError')
    })
  })

  describe('错误处理', () => {
    it('优雅处理空配置', () => {
      const success = registerProviderConfig(null as any)
      expect(success).toBe(false)
    })

    it('优雅处理未定义配置', () => {
      const success = registerProviderConfig(undefined as any)
      expect(success).toBe(false)
    })

    it('处理空字符串 ID', () => {
      const config = {
        id: '',
        name: 'Empty ID Provider',
        creator: vi.fn(() => ({ name: 'empty' })),
        supportsImageGeneration: false
      }

      const success = registerProviderConfig(config)
      expect(success).toBe(false)
    })

    it('处理创建不存在配置的 provider', async () => {
      await expect(createProvider('non-existent-provider', {})).rejects.toThrow(
        'ProviderConfig not found for id: non-existent-provider'
      )
    })

    it('处理注册不存在配置的 provider', () => {
      const mockProvider = { name: 'mock' }
      const success = registerProvider('non-existent-provider', mockProvider)
      expect(success).toBe(false)
    })

    it('处理获取不存在配置的情况', () => {
      expect(getProviderConfig('non-existent')).toBeUndefined()
      expect(getProviderConfigByAlias('non-existent-alias')).toBeUndefined()
      expect(hasProviderConfig('non-existent')).toBe(false)
      expect(hasProviderConfigByAlias('non-existent-alias')).toBe(false)
    })

    it('处理批量注册时的部分失败', () => {
      const mixedConfigs: ProviderConfig[] = [
        {
          id: 'valid-provider-1',
          name: 'Valid Provider 1',
          creator: vi.fn(() => ({ name: 'valid-1' })),
          supportsImageGeneration: false
        },
        {
          id: '', // 无效配置
          name: 'Invalid Provider',
          creator: vi.fn(() => ({ name: 'invalid' })),
          supportsImageGeneration: false
        } as any,
        {
          id: 'valid-provider-2',
          name: 'Valid Provider 2',
          creator: vi.fn(() => ({ name: 'valid-2' })),
          supportsImageGeneration: true
        }
      ]

      const successCount = registerMultipleProviderConfigs(mixedConfigs)
      expect(successCount).toBe(2) // 只有两个有效配置成功

      expect(hasProviderConfig('valid-provider-1')).toBe(true)
      expect(hasProviderConfig('valid-provider-2')).toBe(true)
      expect(hasProviderConfig('')).toBe(false)
    })

    it('处理动态导入失败的情况', async () => {
      const config: ProviderConfig = {
        id: 'import-test-provider',
        name: 'Import Test Provider',
        import: vi.fn().mockRejectedValue(new Error('Import failed')),
        creatorFunctionName: 'createTest',
        supportsImageGeneration: false
      }

      registerProviderConfig(config)

      await expect(createProvider('import-test-provider', {})).rejects.toThrow('Import failed')
    })
  })

  describe('集成测试', () => {
    it('正确处理复杂的配置、创建、注册和清理场景', async () => {
      // 初始状态验证
      const initialConfigs = getAllProviderConfigs()
      expect(initialConfigs.length).toBeGreaterThan(0) // 有基础配置
      expect(getInitializedProviders()).toEqual([])

      // 注册多个带别名的 provider 配置
      const configs: ProviderConfig[] = [
        {
          id: 'integration-provider-1',
          name: 'Integration Provider 1',
          creator: vi.fn(() => ({ name: 'integration-1' })),
          supportsImageGeneration: false,
          aliases: ['alias-1', 'short-name-1']
        },
        {
          id: 'integration-provider-2',
          name: 'Integration Provider 2',
          creator: vi.fn(() => ({ name: 'integration-2' })),
          supportsImageGeneration: true,
          aliases: ['alias-2', 'short-name-2']
        }
      ]

      const successCount = registerMultipleProviderConfigs(configs)
      expect(successCount).toBe(2)

      // 验证配置注册成功
      expect(hasProviderConfig('integration-provider-1')).toBe(true)
      expect(hasProviderConfig('integration-provider-2')).toBe(true)
      expect(hasProviderConfigByAlias('alias-1')).toBe(true)
      expect(hasProviderConfigByAlias('alias-2')).toBe(true)

      // 验证别名映射
      const aliases = getAllProviderConfigAliases()
      expect(aliases['alias-1']).toBe('integration-provider-1')
      expect(aliases['alias-2']).toBe('integration-provider-2')

      // 创建和注册 providers
      const success1 = await createAndRegisterProvider('integration-provider-1', { apiKey: 'test1' })
      const success2 = await createAndRegisterProvider('integration-provider-2', { apiKey: 'test2' })
      expect(success1).toBe(true)
      expect(success2).toBe(true)

      // 验证注册成功
      const registeredProviders = getInitializedProviders()
      expect(registeredProviders).toContain('integration-provider-1')
      expect(registeredProviders).toContain('integration-provider-2')
      expect(hasInitializedProviders()).toBe(true)

      // 清理
      cleanup()

      // 验证清理后的状态
      expect(getInitializedProviders()).toEqual([])
      expect(hasProviderConfig('integration-provider-1')).toBe(false)
      expect(hasProviderConfig('integration-provider-2')).toBe(false)
      expect(getAllProviderConfigAliases()).toEqual({})

      // 基础配置应该重新加载
      expect(hasProviderConfig('openai')).toBe(true)
    })

    it('正确处理动态导入配置的 provider', async () => {
      const mockModule = { createCustomProvider: vi.fn(() => ({ name: 'custom-dynamic' })) }
      const dynamicImportConfig: ProviderConfig = {
        id: 'dynamic-import-provider',
        name: 'Dynamic Import Provider',
        import: vi.fn().mockResolvedValue(mockModule),
        creatorFunctionName: 'createCustomProvider',
        supportsImageGeneration: false
      }

      // 注册配置
      const configSuccess = registerProviderConfig(dynamicImportConfig)
      expect(configSuccess).toBe(true)

      // 创建和注册 provider
      const registerSuccess = await createAndRegisterProvider('dynamic-import-provider', { apiKey: 'test' })
      expect(registerSuccess).toBe(true)

      // 验证导入函数被调用
      expect(dynamicImportConfig.import).toHaveBeenCalled()
      expect(mockModule.createCustomProvider).toHaveBeenCalledWith({ apiKey: 'test' })

      // 验证注册成功
      expect(getInitializedProviders()).toContain('dynamic-import-provider')
    })

    it('正确处理大量配置的注册和管理', () => {
      const largeConfigList: ProviderConfig[] = []

      // 生成50个配置
      for (let i = 0; i < 50; i++) {
        largeConfigList.push({
          id: `bulk-provider-${i}`,
          name: `Bulk Provider ${i}`,
          creator: vi.fn(() => ({ name: `bulk-${i}` })),
          supportsImageGeneration: i % 2 === 0, // 偶数支持图像生成
          aliases: [`alias-${i}`, `short-${i}`]
        })
      }

      const successCount = registerMultipleProviderConfigs(largeConfigList)
      expect(successCount).toBe(50)

      // 验证所有配置都被正确注册
      const allConfigs = getAllProviderConfigs()
      expect(allConfigs.filter((config) => config.id.startsWith('bulk-provider-')).length).toBe(50)

      // 验证别名数量
      const aliases = getAllProviderConfigAliases()
      const bulkAliases = Object.keys(aliases).filter(
        (alias) => alias.startsWith('alias-') || alias.startsWith('short-')
      )
      expect(bulkAliases.length).toBe(100) // 每个 provider 有2个别名

      // 随机验证几个配置
      expect(hasProviderConfig('bulk-provider-0')).toBe(true)
      expect(hasProviderConfig('bulk-provider-25')).toBe(true)
      expect(hasProviderConfig('bulk-provider-49')).toBe(true)

      // 验证别名工作正常
      expect(resolveProviderConfigId('alias-25')).toBe('bulk-provider-25')
      expect(isProviderConfigAlias('short-30')).toBe(true)

      // 清理能正确处理大量数据
      cleanup()
      const cleanupAliases = getAllProviderConfigAliases()
      expect(
        Object.keys(cleanupAliases).filter((alias) => alias.startsWith('alias-') || alias.startsWith('short-'))
      ).toEqual([])
    })
  })

  describe('边界测试', () => {
    it('处理包含特殊字符的 provider IDs', () => {
      const specialCharsConfigs: ProviderConfig[] = [
        {
          id: 'provider-with-dashes',
          name: 'Provider With Dashes',
          creator: vi.fn(() => ({ name: 'dashes' })),
          supportsImageGeneration: false
        },
        {
          id: 'provider_with_underscores',
          name: 'Provider With Underscores',
          creator: vi.fn(() => ({ name: 'underscores' })),
          supportsImageGeneration: false
        },
        {
          id: 'provider.with.dots',
          name: 'Provider With Dots',
          creator: vi.fn(() => ({ name: 'dots' })),
          supportsImageGeneration: false
        }
      ]

      const successCount = registerMultipleProviderConfigs(specialCharsConfigs)
      expect(successCount).toBeGreaterThan(0) // 至少有一些成功

      // 验证支持的特殊字符格式
      if (hasProviderConfig('provider-with-dashes')) {
        expect(getProviderConfig('provider-with-dashes')).toBeDefined()
      }
      if (hasProviderConfig('provider_with_underscores')) {
        expect(getProviderConfig('provider_with_underscores')).toBeDefined()
      }
    })

    it('处理空的批量注册', () => {
      const successCount = registerMultipleProviderConfigs([])
      expect(successCount).toBe(0)

      // 确保没有额外的配置被添加
      const configsBefore = getAllProviderConfigs().length
      expect(configsBefore).toBeGreaterThan(0) // 应该有基础配置
    })

    it('处理重复的配置注册', () => {
      const config: ProviderConfig = {
        id: 'duplicate-test-provider',
        name: 'Duplicate Test Provider',
        creator: vi.fn(() => ({ name: 'duplicate' })),
        supportsImageGeneration: false
      }

      // 第一次注册成功
      expect(registerProviderConfig(config)).toBe(true)
      expect(hasProviderConfig('duplicate-test-provider')).toBe(true)

      // 重复注册相同的配置（允许覆盖）
      const updatedConfig: ProviderConfig = {
        ...config,
        name: 'Updated Duplicate Test Provider'
      }
      expect(registerProviderConfig(updatedConfig)).toBe(true)
      expect(hasProviderConfig('duplicate-test-provider')).toBe(true)

      // 验证配置被更新
      const retrievedConfig = getProviderConfig('duplicate-test-provider')
      expect(retrievedConfig?.name).toBe('Updated Duplicate Test Provider')
    })

    it('处理极长的 ID 和名称', () => {
      const longId = 'very-long-provider-id-' + 'x'.repeat(100)
      const longName = 'Very Long Provider Name ' + 'Y'.repeat(100)

      const config: ProviderConfig = {
        id: longId,
        name: longName,
        creator: vi.fn(() => ({ name: 'long-test' })),
        supportsImageGeneration: false
      }

      const success = registerProviderConfig(config)
      expect(success).toBe(true)
      expect(hasProviderConfig(longId)).toBe(true)

      const retrievedConfig = getProviderConfig(longId)
      expect(retrievedConfig?.name).toBe(longName)
    })

    it('处理大量别名的配置', () => {
      const manyAliases = Array.from({ length: 50 }, (_, i) => `alias-${i}`)

      const config: ProviderConfig = {
        id: 'provider-with-many-aliases',
        name: 'Provider With Many Aliases',
        creator: vi.fn(() => ({ name: 'many-aliases' })),
        supportsImageGeneration: false,
        aliases: manyAliases
      }

      const success = registerProviderConfig(config)
      expect(success).toBe(true)

      // 验证所有别名都能正确解析
      manyAliases.forEach((alias) => {
        expect(hasProviderConfigByAlias(alias)).toBe(true)
        expect(resolveProviderConfigId(alias)).toBe('provider-with-many-aliases')
        expect(isProviderConfigAlias(alias)).toBe(true)
      })
    })
  })
})
