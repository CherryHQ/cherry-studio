import { describe, expect, it, vi } from 'vitest'

import {
  type BaseProviderId,
  baseProviderIds,
  baseProviderIdSchema,
  baseProviders,
  type CustomProviderId,
  customProviderIdSchema,
  providerConfigSchema,
  type ProviderId,
  providerIdSchema
} from '../schemas'

describe('Provider Schemas', () => {
  describe('baseProviders', () => {
    it('包含所有预期的基础 providers', () => {
      expect(baseProviders).toBeDefined()
      expect(Array.isArray(baseProviders)).toBe(true)
      expect(baseProviders.length).toBeGreaterThan(0)

      const expectedIds = [
        'openai',
        'openai-responses',
        'openai-compatible',
        'anthropic',
        'google',
        'xai',
        'azure',
        'deepseek'
      ]
      const actualIds = baseProviders.map((p) => p.id)
      expectedIds.forEach((id) => {
        expect(actualIds).toContain(id)
      })
    })

    it('每个基础 provider 有必要的属性', () => {
      baseProviders.forEach((provider) => {
        expect(provider).toHaveProperty('id')
        expect(provider).toHaveProperty('name')
        expect(provider).toHaveProperty('creator')
        expect(provider).toHaveProperty('supportsImageGeneration')

        expect(typeof provider.id).toBe('string')
        expect(typeof provider.name).toBe('string')
        expect(typeof provider.creator).toBe('function')
        expect(typeof provider.supportsImageGeneration).toBe('boolean')
      })
    })

    it('provider ID 是唯一的', () => {
      const ids = baseProviders.map((p) => p.id)
      const uniqueIds = [...new Set(ids)]
      expect(ids).toEqual(uniqueIds)
    })
  })

  describe('baseProviderIds', () => {
    it('正确提取所有基础 provider IDs', () => {
      expect(baseProviderIds).toBeDefined()
      expect(Array.isArray(baseProviderIds)).toBe(true)
      expect(baseProviderIds.length).toBe(baseProviders.length)

      baseProviders.forEach((provider) => {
        expect(baseProviderIds).toContain(provider.id)
      })
    })
  })

  describe('baseProviderIdSchema', () => {
    it('验证有效的基础 provider IDs', () => {
      baseProviderIds.forEach((id) => {
        expect(baseProviderIdSchema.safeParse(id).success).toBe(true)
      })
    })

    it('拒绝无效的基础 provider IDs', () => {
      const invalidIds = ['invalid', 'not-exists', '']
      invalidIds.forEach((id) => {
        expect(baseProviderIdSchema.safeParse(id).success).toBe(false)
      })
    })
  })

  describe('customProviderIdSchema', () => {
    it('接受有效的自定义 provider IDs', () => {
      const validIds = ['custom-provider', 'my-ai-service', 'company-llm-v2']
      validIds.forEach((id) => {
        expect(customProviderIdSchema.safeParse(id).success).toBe(true)
      })
    })

    it('拒绝与基础 provider IDs 冲突的 IDs', () => {
      baseProviderIds.forEach((id) => {
        expect(customProviderIdSchema.safeParse(id).success).toBe(false)
      })
    })

    it('拒绝空字符串', () => {
      expect(customProviderIdSchema.safeParse('').success).toBe(false)
    })
  })

  describe('providerIdSchema', () => {
    it('接受基础 provider IDs', () => {
      baseProviderIds.forEach((id) => {
        expect(providerIdSchema.safeParse(id).success).toBe(true)
      })
    })

    it('接受有效的自定义 provider IDs', () => {
      const validCustomIds = ['custom-provider', 'my-ai-service']
      validCustomIds.forEach((id) => {
        expect(providerIdSchema.safeParse(id).success).toBe(true)
      })
    })

    it('拒绝无效的 IDs', () => {
      const invalidIds = ['', undefined, null, 123]
      invalidIds.forEach((id) => {
        expect(providerIdSchema.safeParse(id).success).toBe(false)
      })
    })
  })

  describe('providerConfigSchema', () => {
    it('验证带有 creator 的有效配置', () => {
      const validConfig = {
        id: 'custom-provider',
        name: 'Custom Provider',
        creator: vi.fn(),
        supportsImageGeneration: true
      }
      expect(providerConfigSchema.safeParse(validConfig).success).toBe(true)
    })

    it('验证带有 import 配置的有效配置', () => {
      const validConfig = {
        id: 'custom-provider',
        name: 'Custom Provider',
        import: vi.fn(),
        creatorFunctionName: 'createCustom',
        supportsImageGeneration: false
      }
      expect(providerConfigSchema.safeParse(validConfig).success).toBe(true)
    })

    it('拒绝既没有 creator 也没有 import 配置的配置', () => {
      const invalidConfig = {
        id: 'invalid',
        name: 'Invalid Provider',
        supportsImageGeneration: false
      }
      expect(providerConfigSchema.safeParse(invalidConfig).success).toBe(false)
    })

    it('为 supportsImageGeneration 设置默认值', () => {
      const config = {
        id: 'test',
        name: 'Test',
        creator: vi.fn()
      }
      const result = providerConfigSchema.safeParse(config)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.supportsImageGeneration).toBe(false)
      }
    })

    it('拒绝使用基础 provider ID 的配置', () => {
      const invalidConfig = {
        id: 'openai', // 基础 provider ID
        name: 'Should Fail',
        creator: vi.fn()
      }
      expect(providerConfigSchema.safeParse(invalidConfig).success).toBe(false)
    })

    it('拒绝缺少必需字段的配置', () => {
      const invalidConfigs = [
        { name: 'Missing ID', creator: vi.fn() },
        { id: 'missing-name', creator: vi.fn() },
        { id: '', name: 'Empty ID', creator: vi.fn() },
        { id: 'valid-custom', name: '', creator: vi.fn() }
      ]

      invalidConfigs.forEach((config) => {
        expect(providerConfigSchema.safeParse(config).success).toBe(false)
      })
    })
  })

  describe('Schema 验证功能', () => {
    it('baseProviderIdSchema 正确验证基础 provider IDs', () => {
      baseProviderIds.forEach((id) => {
        expect(baseProviderIdSchema.safeParse(id).success).toBe(true)
      })

      expect(baseProviderIdSchema.safeParse('invalid-id').success).toBe(false)
    })

    it('customProviderIdSchema 正确验证自定义 provider IDs', () => {
      const customIds = ['custom-provider', 'my-service', 'company-llm']
      customIds.forEach((id) => {
        expect(customProviderIdSchema.safeParse(id).success).toBe(true)
      })

      // 拒绝基础 provider IDs
      baseProviderIds.forEach((id) => {
        expect(customProviderIdSchema.safeParse(id).success).toBe(false)
      })
    })

    it('providerIdSchema 接受基础和自定义 provider IDs', () => {
      // 基础 IDs
      baseProviderIds.forEach((id) => {
        expect(providerIdSchema.safeParse(id).success).toBe(true)
      })

      // 自定义 IDs
      const customIds = ['custom-provider', 'my-service']
      customIds.forEach((id) => {
        expect(providerIdSchema.safeParse(id).success).toBe(true)
      })
    })

    it('providerConfigSchema 验证完整的 provider 配置', () => {
      const validConfig = {
        id: 'custom-provider',
        name: 'Custom Provider',
        creator: vi.fn(),
        supportsImageGeneration: true
      }
      expect(providerConfigSchema.safeParse(validConfig).success).toBe(true)

      const invalidConfig = {
        id: 'openai', // 不允许基础 provider ID
        name: 'OpenAI',
        creator: vi.fn()
      }
      expect(providerConfigSchema.safeParse(invalidConfig).success).toBe(false)
    })
  })

  describe('类型推导', () => {
    it('BaseProviderId 类型正确', () => {
      const id: BaseProviderId = 'openai'
      expect(baseProviderIds).toContain(id)
    })

    it('CustomProviderId 类型是字符串', () => {
      const id: CustomProviderId = 'custom-provider'
      expect(typeof id).toBe('string')
    })

    it('ProviderId 类型支持基础和自定义 IDs', () => {
      const baseId: ProviderId = 'openai'
      const customId: ProviderId = 'custom-provider'
      expect(typeof baseId).toBe('string')
      expect(typeof customId).toBe('string')
    })
  })
})
