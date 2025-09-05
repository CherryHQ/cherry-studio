import { Provider, SystemProvider } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import {
  firstLetter,
  getBaseModelName,
  getBriefInfo,
  getDefaultGroupName,
  getFancyProviderName,
  getFirstCharacter,
  getLeadingEmoji,
  getLowerBaseModelName,
  groupModelsCaseInsensitive,
  isEmoji,
  removeLeadingEmoji,
  removeSpecialCharactersForTopicName
} from '../naming'

describe('naming', () => {
  describe('firstLetter', () => {
    it('should return first letter of string', () => {
      // 验证普通字符串的第一个字符
      expect(firstLetter('Hello')).toBe('H')
    })

    it('should return first emoji of string', () => {
      // 验证包含表情符号的字符串
      expect(firstLetter('😊Hello')).toBe('😊')
    })

    it('should return empty string for empty input', () => {
      // 验证空字符串
      expect(firstLetter('')).toBe('')
    })
  })

  describe('removeLeadingEmoji', () => {
    it('should remove leading emoji from string', () => {
      // 验证移除开头的表情符号
      expect(removeLeadingEmoji('😊Hello')).toBe('Hello')
    })

    it('should return original string if no leading emoji', () => {
      // 验证没有表情符号的字符串
      expect(removeLeadingEmoji('Hello')).toBe('Hello')
    })

    it('should return empty string if only emojis', () => {
      // 验证全表情符号字符串
      expect(removeLeadingEmoji('😊😊')).toBe('')
    })
  })

  describe('getLeadingEmoji', () => {
    it('should return leading emoji from string', () => {
      // 验证提取开头的表情符号
      expect(getLeadingEmoji('😊Hello')).toBe('😊')
    })

    it('should return empty string if no leading emoji', () => {
      // 验证没有表情符号的字符串
      expect(getLeadingEmoji('Hello')).toBe('')
    })

    it('should return all emojis if only emojis', () => {
      // 验证全表情符号字符串
      expect(getLeadingEmoji('😊😊')).toBe('😊😊')
    })
  })

  describe('isEmoji', () => {
    it('should return true for pure emoji string', () => {
      // 验证纯表情符号字符串返回 true
      expect(isEmoji('😊')).toBe(true)
    })

    it('should return false for mixed emoji and text string', () => {
      // 验证包含表情符号和文本的字符串返回 false
      expect(isEmoji('😊Hello')).toBe(false)
    })

    it('should return false for non-emoji string', () => {
      // 验证非表情符号字符串返回 false
      expect(isEmoji('Hello')).toBe(false)
    })

    it('should return false for data URI or URL', () => {
      // 验证 data URI 或 URL 字符串返回 false
      expect(isEmoji('data:image/png;base64,...')).toBe(false)
      expect(isEmoji('https://example.com')).toBe(false)
    })
  })

  describe('removeSpecialCharactersForTopicName', () => {
    it('should replace newlines with space for topic name', () => {
      // 验证移除换行符并转换为空格
      expect(removeSpecialCharactersForTopicName('Hello\nWorld')).toBe('Hello World')
    })

    it('should return original string if no newlines', () => {
      // 验证没有换行符的字符串
      expect(removeSpecialCharactersForTopicName('Hello World')).toBe('Hello World')
    })

    it('should return empty string for empty input', () => {
      // 验证空字符串
      expect(removeSpecialCharactersForTopicName('')).toBe('')
    })
  })

  describe('getDefaultGroupName', () => {
    it('should extract group name from ID with slash', () => {
      // 验证从包含斜杠的 ID 中提取组名
      expect(getDefaultGroupName('group/model')).toBe('group')
    })

    it('should extract group name from ID with colon', () => {
      // 验证从包含冒号的 ID 中提取组名
      expect(getDefaultGroupName('group:model')).toBe('group')
    })

    it('should extract group name from ID with space', () => {
      // 验证从包含空格的 ID 中提取组名
      expect(getDefaultGroupName('foo bar')).toBe('foo')
    })

    it('should extract group name from ID with hyphen', () => {
      // 验证从包含连字符的 ID 中提取组名
      expect(getDefaultGroupName('group-subgroup-model')).toBe('group-subgroup')
    })

    it('should use first delimiters for special providers', () => {
      // 这些 provider 下，'/', ' ', '-', '_', ':' 都属于第一类分隔符，分割后取第0部分
      const specialProviders = ['aihubmix', 'silicon', 'ocoolai', 'o3', 'dmxapi']
      specialProviders.forEach((provider) => {
        expect(getDefaultGroupName('Qwen/Qwen3-32B', provider)).toBe('qwen')
        expect(getDefaultGroupName('gpt-4.1-mini', provider)).toBe('gpt')
        expect(getDefaultGroupName('gpt-4.1', provider)).toBe('gpt')
        expect(getDefaultGroupName('gpt_4.1', provider)).toBe('gpt')
        expect(getDefaultGroupName('DeepSeek Chat', provider)).toBe('deepseek')
        expect(getDefaultGroupName('foo:bar', provider)).toBe('foo')
      })
    })

    it('should use first and second delimiters for default providers', () => {
      // 默认情况下，'/', ' ', ':' 属于第一类分隔符，'-' '_' 属于第二类
      expect(getDefaultGroupName('Qwen/Qwen3-32B', 'foobar')).toBe('qwen')
      expect(getDefaultGroupName('gpt-4.1-mini', 'foobar')).toBe('gpt-4.1')
      expect(getDefaultGroupName('gpt-4.1', 'foobar')).toBe('gpt-4.1')
      expect(getDefaultGroupName('DeepSeek Chat', 'foobar')).toBe('deepseek')
      expect(getDefaultGroupName('foo:bar', 'foobar')).toBe('foo')
    })

    it('should fallback to id if no delimiters', () => {
      // 没有分隔符时返回 id
      const specialProviders = ['aihubmix', 'silicon', 'ocoolai', 'o3', 'dmxapi']
      specialProviders.forEach((provider) => {
        expect(getDefaultGroupName('o3', provider)).toBe('o3')
      })
      expect(getDefaultGroupName('o3', 'openai')).toBe('o3')
    })
  })

  describe('getBaseModelName', () => {
    it('should extract base model name with single delimiter', () => {
      expect(getBaseModelName('DeepSeek/DeepSeek-R1')).toBe('DeepSeek-R1')
      expect(getBaseModelName('openai/gpt-4.1')).toBe('gpt-4.1')
      expect(getBaseModelName('anthropic/claude-3.5-sonnet')).toBe('claude-3.5-sonnet')
    })

    it('should extract base model name with multiple levels', () => {
      expect(getBaseModelName('Pro/deepseek-ai/DeepSeek-R1')).toBe('DeepSeek-R1')
      expect(getBaseModelName('org/team/group/model')).toBe('model')
    })

    it('should return original id if no delimiter found', () => {
      expect(getBaseModelName('deepseek-r1')).toBe('deepseek-r1')
    })

    it('should handle edge cases', () => {
      // 验证空字符串的情况
      expect(getBaseModelName('')).toBe('')
      // 验证以分隔符结尾的字符串
      expect(getBaseModelName('model/')).toBe('')
      expect(getBaseModelName('model/name/')).toBe('')
      // 验证以分隔符开头的字符串
      expect(getBaseModelName('/model')).toBe('model')
      expect(getBaseModelName('/path/to/model')).toBe('model')
      // 验证连续分隔符的情况
      expect(getBaseModelName('model//name')).toBe('name')
      expect(getBaseModelName('model///name')).toBe('name')
    })
  })

  describe('getLowerBaseModelName', () => {
    it('should convert base model name to lowercase', () => {
      // 验证将基础模型名称转换为小写
      expect(getLowerBaseModelName('DeepSeek/DeepSeek-R1')).toBe('deepseek-r1')
      expect(getLowerBaseModelName('openai/GPT-4.1')).toBe('gpt-4.1')
      expect(getLowerBaseModelName('Anthropic/Claude-3.5-Sonnet')).toBe('claude-3.5-sonnet')
    })

    it('should handle multiple levels of paths', () => {
      // 验证处理多层路径
      expect(getLowerBaseModelName('Pro/DeepSeek-AI/DeepSeek-R1')).toBe('deepseek-r1')
      expect(getLowerBaseModelName('Org/Team/Group/Model')).toBe('model')
    })

    it('should return lowercase original id if no delimiter found', () => {
      // 验证没有分隔符时返回小写原始ID
      expect(getLowerBaseModelName('DeepSeek-R1')).toBe('deepseek-r1')
      expect(getLowerBaseModelName('GPT-4')).toBe('gpt-4')
    })

    it('should handle edge cases', () => {
      // 验证边缘情况
      expect(getLowerBaseModelName('')).toBe('')
      expect(getLowerBaseModelName('Model/')).toBe('')
      expect(getLowerBaseModelName('/Model')).toBe('model')
      expect(getLowerBaseModelName('Model//Name')).toBe('name')
    })

    it('should remove trailing :free', () => {
      expect(getLowerBaseModelName('gpt-4:free')).toBe('gpt-4')
    })
  })

  describe('getFirstCharacter', () => {
    it('should return first character of string', () => {
      // 验证返回字符串的第一个字符
      expect(getFirstCharacter('Hello')).toBe('H')
    })

    it('should return empty string for empty input', () => {
      // 验证空字符串返回空字符串
      expect(getFirstCharacter('')).toBe('')
    })

    it('should handle special characters and emojis', () => {
      // 验证处理特殊字符和表情符号
      expect(getFirstCharacter('😊Hello')).toBe('😊')
    })
  })

  describe('getBriefInfo', () => {
    it('should return original text if under max length', () => {
      // 验证文本长度小于最大长度时返回原始文本
      const text = 'Short text'
      expect(getBriefInfo(text, 20)).toBe('Short text')
    })

    it('should truncate text at word boundary with ellipsis', () => {
      // 验证在单词边界处截断文本并添加省略号
      const text = 'This is a long text that needs truncation'
      const result = getBriefInfo(text, 10)
      expect(result).toBe('This is a...')
    })

    it('should handle empty lines by removing them', () => {
      // 验证移除空行
      const text = 'Line1\n\nLine2'
      expect(getBriefInfo(text, 20)).toBe('Line1\nLine2')
    })

    it('should handle custom max length', () => {
      // 验证自定义最大长度
      const text = 'This is a long text'
      expect(getBriefInfo(text, 5)).toBe('This...')
    })
  })

  describe('getFancyProviderName', () => {
    it('should get i18n name for system provider', () => {
      const mockSystemProvider: SystemProvider = {
        id: 'dashscope',
        type: 'openai',
        name: 'whatever',
        apiHost: 'whatever',
        apiKey: 'whatever',
        models: [],
        isSystem: true
      }
      // 默认 i18n 环境是 en-us
      expect(getFancyProviderName(mockSystemProvider)).toBe('Alibaba Cloud')
    })

    it('should get name for custom provider', () => {
      const mockProvider: Provider = {
        id: 'whatever',
        type: 'openai',
        name: '好名字',
        apiHost: 'whatever',
        apiKey: 'whatever',
        models: []
      }
      expect(getFancyProviderName(mockProvider)).toBe('好名字')
    })
  })

  describe('groupModelsCaseInsensitive', () => {
    // 模拟模型数据类型
    interface TestModel {
      id: string
      name: string
      group?: string
    }

    const testModels: TestModel[] = [
      { id: 'gpt-4', name: 'GPT-4', group: 'GPT' },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', group: 'gpt' },
      { id: 'gpt-4o', name: 'GPT-4o', group: 'Gpt' },
      { id: 'claude-3', name: 'Claude 3', group: 'Claude' },
      { id: 'claude-3.5', name: 'Claude 3.5', group: 'CLAUDE' },
      { id: 'gemini-pro', name: 'Gemini Pro', group: 'Gemini' },
      { id: 'gemini-flash', name: 'Gemini Flash', group: 'gemini' },
      { id: 'other-model', name: 'Other Model' } // 没有 group 字段
    ]

    // 模拟国际化函数
    const createMockT = (locale: 'en' | 'zh' | 'fr' | 'es' = 'en') => {
      const translations = {
        en: { 'settings.provider.misc': 'Other' },
        zh: { 'settings.provider.misc': '其他' },
        fr: { 'settings.provider.misc': 'autre' },
        es: { 'settings.provider.misc': 'otro' }
      }
      return (key: string) => translations[locale][key] || key
    }

    it('should group models case-insensitively using default group field', () => {
      // 验证使用默认 group 字段进行大小写不敏感分组
      const mockT = createMockT('en')
      const result = groupModelsCaseInsensitive(testModels, 'group', mockT('settings.provider.misc'))

      // 验证分组数量 - 应该有 4 个分组：GPT, Claude, Gemini, Other
      expect(Object.keys(result)).toHaveLength(4)

      // 验证 GPT 分组包含所有 GPT 相关模型
      const gptGroup = result['GPT'] // 使用第一次遇到的大小写
      expect(gptGroup).toHaveLength(3)
      expect(gptGroup.map((m) => m.name)).toContain('GPT-4')
      expect(gptGroup.map((m) => m.name)).toContain('GPT-3.5 Turbo')
      expect(gptGroup.map((m) => m.name)).toContain('GPT-4o')

      // 验证 Claude 分组包含所有 Claude 相关模型
      const claudeGroup = result['Claude'] // 使用第一次遇到的大小写
      expect(claudeGroup).toHaveLength(2)
      expect(claudeGroup.map((m) => m.name)).toContain('Claude 3')
      expect(claudeGroup.map((m) => m.name)).toContain('Claude 3.5')

      // 验证 Gemini 分组包含所有 Gemini 相关模型
      const geminiGroup = result['Gemini'] // 使用第一次遇到的大小写
      expect(geminiGroup).toHaveLength(2)
      expect(geminiGroup.map((m) => m.name)).toContain('Gemini Pro')
      expect(geminiGroup.map((m) => m.name)).toContain('Gemini Flash')

      // 验证其他分组
      const otherGroupName = mockT('settings.provider.misc')
      const otherGroup = result[otherGroupName]
      expect(otherGroup).toHaveLength(1)
      expect(otherGroup[0].name).toBe('Other Model')
    })

    it('should preserve first encountered case as display name', () => {
      // 验证保留第一次遇到的大小写作为显示名称
      const result = groupModelsCaseInsensitive(testModels)

      // 验证分组键使用第一次遇到的大小写
      expect(result).toHaveProperty('GPT') // 第一个是 'GPT'
      expect(result).toHaveProperty('Claude') // 第一个是 'Claude'
      expect(result).toHaveProperty('Gemini') // 第一个是 'Gemini'

      // 验证不应该有其他大小写变体的键
      expect(result).not.toHaveProperty('gpt')
      expect(result).not.toHaveProperty('Gpt')
      expect(result).not.toHaveProperty('CLAUDE')
      expect(result).not.toHaveProperty('gemini')
    })

    it('should sort groups alphabetically by normalized key', () => {
      // 验证分组按规范化键值字母顺序排序
      const mockT = createMockT('en')
      const result = groupModelsCaseInsensitive(testModels, 'group', mockT('settings.provider.misc'))
      const groupKeys = Object.keys(result)

      // 按规范化键值排序：claude, gemini, gpt, other
      expect(groupKeys[0]).toBe('Claude')
      expect(groupKeys[1]).toBe('Gemini')
      expect(groupKeys[2]).toBe('GPT')
      expect(groupKeys[3]).toBe(mockT('settings.provider.misc')) // 'Other' for English
    })

    it('should work with custom groupKey function', () => {
      // 验证使用自定义分组函数
      const customModels = [
        { id: 'model1', name: 'Model 1', category: 'AI' },
        { id: 'model2', name: 'Model 2', category: 'ai' },
        { id: 'model3', name: 'Model 3', category: 'ML' },
        { id: 'model4', name: 'Model 4', category: 'ml' }
      ]

      const result = groupModelsCaseInsensitive(customModels, (model) => model.category)

      expect(Object.keys(result)).toHaveLength(2)
      expect(result['AI']).toHaveLength(2) // AI 和 ai 合并
      expect(result['ML']).toHaveLength(2) // ML 和 ml 合并
    })

    it('should maintain stable sorting order', () => {
      // 验证排序的稳定性
      const modelsInDifferentOrder = [
        { id: 'model1', name: 'Model 1', group: 'zebra' },
        { id: 'model2', name: 'Model 2', group: 'alpha' },
        { id: 'model3', name: 'Model 3', group: 'ZEBRA' },
        { id: 'model4', name: 'Model 4', group: 'ALPHA' }
      ]

      const result = groupModelsCaseInsensitive(modelsInDifferentOrder)
      const groupKeys = Object.keys(result)

      // 应该按字母顺序排序：alpha, zebra
      expect(groupKeys[0]).toBe('alpha') // 第一次遇到的小写
      expect(groupKeys[1]).toBe('zebra') // 第一次遇到的小写

      // 验证分组内容
      expect(result['alpha']).toHaveLength(2)
      expect(result['zebra']).toHaveLength(2)
    })

    it('should use custom default group name', () => {
      // 验证使用自定义默认分组名称
      const modelsWithoutGroup = [
        { id: 'model1', name: 'Model 1', group: 'ValidGroup' },
        { id: 'model2', name: 'Model 2' }, // 没有 group 字段
        { id: 'model3', name: 'Model 3', group: '' }, // 空 group
        { id: 'model4', name: 'Model 4', group: undefined } // undefined group
      ]

      const customDefaultName = '未分类'
      const result = groupModelsCaseInsensitive(modelsWithoutGroup, 'group', customDefaultName)

      expect(Object.keys(result)).toHaveLength(2)
      expect(result['ValidGroup']).toHaveLength(1)
      expect(result[customDefaultName]).toHaveLength(3) // 3个没有有效分组的模型
      expect(result[customDefaultName].map((m) => m.name)).toEqual(['Model 2', 'Model 3', 'Model 4'])
    })

    it('should work with internationalized default group name', () => {
      // 验证国际化默认分组名称支持
      const modelsWithMixedGroups = [
        { id: 'model1', name: 'Model 1', group: 'GPT' },
        { id: 'model2', name: 'Model 2' }, // 没有分组，应该使用默认分组
        { id: 'model3', name: 'Model 3', group: '' }
      ]

      // 模拟不同语言环境的默认分组名称
      const testCases = [
        { defaultName: 'Other', language: 'en' },
        { defaultName: '其他', language: 'zh' },
        { defaultName: 'autre', language: 'fr' },
        { defaultName: 'otro', language: 'es' }
      ]

      testCases.forEach(({ defaultName }) => {
        const result = groupModelsCaseInsensitive(modelsWithMixedGroups, 'group', defaultName)

        expect(Object.keys(result)).toHaveLength(2)
        expect(result['GPT']).toHaveLength(1)
        expect(result[defaultName]).toHaveLength(2) // 两个没有有效分组的模型
        expect(result[defaultName].map((m) => m.name)).toEqual(['Model 2', 'Model 3'])
      })
    })

    it('should work with custom groupKey field name', () => {
      // 验证使用自定义分组字段名
      const customModels = [
        { id: 'model1', name: 'Model 1', category: 'Type1' },
        { id: 'model2', name: 'Model 2', category: 'type1' },
        { id: 'model3', name: 'Model 3', category: 'Type2' }
      ]

      const result = groupModelsCaseInsensitive(customModels, 'category')

      expect(Object.keys(result)).toHaveLength(2)
      expect(result['Type1']).toHaveLength(2) // Type1 和 type1 合并
      expect(result['Type2']).toHaveLength(1)
    })

    it('should handle empty models array', () => {
      // 验证处理空模型数组
      const result = groupModelsCaseInsensitive([])
      expect(result).toEqual({})
    })

    it('should handle models with empty or undefined group', () => {
      // 验证处理没有分组或分组为空的模型
      const modelsWithEmptyGroups = [
        { id: 'model1', name: 'Model 1', group: '' },
        { id: 'model2', name: 'Model 2', group: undefined },
        { id: 'model3', name: 'Model 3' }, // 没有 group 字段
        { id: 'model4', name: 'Model 4', group: 'Valid' }
      ]

      const mockT = createMockT('en')
      const result = groupModelsCaseInsensitive(modelsWithEmptyGroups, 'group', mockT('settings.provider.misc'))

      expect(Object.keys(result)).toHaveLength(2)
      expect(result[mockT('settings.provider.misc')]).toHaveLength(3) // 空、undefined、缺失的都归到国际化的默认分组
      expect(result['Valid']).toHaveLength(1)
    })

    it('should handle models with whitespace-only group names', () => {
      // 验证处理只有空白字符的分组名
      const modelsWithWhitespace = [
        { id: 'model1', name: 'Model 1', group: '   ' },
        { id: 'model2', name: 'Model 2', group: '\t\n' },
        { id: 'model3', name: 'Model 3', group: 'Valid' }
      ]

      const result = groupModelsCaseInsensitive(modelsWithWhitespace)

      // 空白字符分组名应该被视为有效分组，不会归入"其他"
      expect(Object.keys(result)).toHaveLength(3)
      expect(result['   ']).toBeDefined()
      expect(result['\t\n']).toBeDefined()
      expect(result['Valid']).toBeDefined()
    })

    it('should handle special characters in group names', () => {
      // 验证处理分组名中的特殊字符
      const modelsWithSpecialChars = [
        { id: 'model1', name: 'Model 1', group: 'Group-1' },
        { id: 'model2', name: 'Model 2', group: 'GROUP-1' },
        { id: 'model3', name: 'Model 3', group: 'Group_2' },
        { id: 'model4', name: 'Model 4', group: 'GROUP_2' },
        { id: 'model5', name: 'Model 5', group: 'Group/3' },
        { id: 'model6', name: 'Model 6', group: 'group/3' }
      ]

      const result = groupModelsCaseInsensitive(modelsWithSpecialChars)

      expect(Object.keys(result)).toHaveLength(3)
      expect(result['Group-1']).toHaveLength(2)
      expect(result['Group_2']).toHaveLength(2)
      expect(result['Group/3']).toHaveLength(2)
    })
  })
})
