import { describe, expect, it } from 'vitest'

import {
  firstLetter,
  generateColorFromChar,
  getBriefInfo,
  getDefaultGroupName,
  getFirstCharacter,
  getLeadingEmoji,
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

    it('should extract group name from ID with hyphen', () => {
      // 验证从包含连字符的 ID 中提取组名
      expect(getDefaultGroupName('group-subgroup-model')).toBe('group-subgroup')
    })

    it('should return original ID if no separators', () => {
      // 验证没有分隔符时返回原始 ID
      expect(getDefaultGroupName('group')).toBe('group')
    })
  })

  describe('generateColorFromChar', () => {
    it('should generate a valid hex color code', () => {
      // 验证生成有效的十六进制颜色代码
      const result = generateColorFromChar('A')
      expect(result).toMatch(/^#[0-9a-fA-F]{6}$/)
    })

    it('should generate consistent color for same input', () => {
      // 验证相同输入生成一致的颜色
      const result1 = generateColorFromChar('A')
      const result2 = generateColorFromChar('A')
      expect(result1).toBe(result2)
    })

    it('should generate different colors for different inputs', () => {
      // 验证不同输入生成不同的颜色
      const result1 = generateColorFromChar('A')
      const result2 = generateColorFromChar('B')
      expect(result1).not.toBe(result2)
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
})
