import type { Provider, SystemProvider } from '@renderer/types'
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
  isEmoji,
  removeLeadingEmoji,
  removeSpecialCharactersForTopicName,
  sanitizeProviderName
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
    it('should remove trailing (free)', () => {
      expect(getLowerBaseModelName('agent/gpt-4(free)')).toBe('gpt-4')
    })
    it('should remove trailing :cloud', () => {
      expect(getLowerBaseModelName('local/kimi-k2.5:cloud')).toBe('kimi-k2.5')
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

  describe('sanitizeProviderName', () => {
    it('should replace spaces with dashes', () => {
      expect(sanitizeProviderName('My Provider')).toBe('My-Provider')
    })

    it('should replace dangerous characters with underscores', () => {
      expect(sanitizeProviderName('Provider/Name')).toBe('Provider_Name')
    })

    it('should handle mixed special characters', () => {
      expect(sanitizeProviderName('My Provider <test>:name')).toBe('My-Provider-_test__name')
    })

    it('should return empty string for empty input', () => {
      expect(sanitizeProviderName('')).toBe('')
    })
  })
})
