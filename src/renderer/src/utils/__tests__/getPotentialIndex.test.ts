import { describe, expect, it } from 'vitest'

import { getPotentialStartIndex } from '../getPotentialIndex'

describe('getPotentialIndex', () => {
  describe('getPotentialStartIndex', () => {
    // 核心功能：直接匹配
    it('should return the index of exact match', () => {
      expect(getPotentialStartIndex('Hello world', 'world')).toBe(6)
      expect(getPotentialStartIndex('Hello world world', 'world')).toBe(6) // 返回第一个匹配
    })

    // 核心功能：后缀-前缀匹配（流式文本的关键场景）
    it('should return index when text suffix matches search prefix', () => {
      expect(getPotentialStartIndex('Hello wo', 'world')).toBe(6)
      expect(getPotentialStartIndex('Hello w', 'world')).toBe(6)
      expect(getPotentialStartIndex('I am thinking', 'thinking about')).toBe(5)
    })

    // 边界情况：空字符串
    it('should return null when searchedText is empty', () => {
      expect(getPotentialStartIndex('Hello', '')).toBe(null)
      expect(getPotentialStartIndex('', '')).toBe(null)
    })

    // 边界情况：无匹配
    it('should return null when no match is found', () => {
      expect(getPotentialStartIndex('Hello', 'world')).toBe(null)
      expect(getPotentialStartIndex('', 'world')).toBe(null)
    })

    // 流式文本实际场景：标签检测
    it('should handle tag detection in streaming response', () => {
      // 完整标签
      expect(getPotentialStartIndex('Response with <thinking>', '<thinking>')).toBe(14)

      // 部分标签（流式传输中断）
      expect(getPotentialStartIndex('Response with <thin', '<thinking>')).toBe(14)
      expect(getPotentialStartIndex('Response with <', '<thinking>')).toBe(14)

      // 多个标签场景
      const text = 'Start <tag1>content</tag1> middle <tag'
      expect(getPotentialStartIndex(text, '<tag2>')).toBe(34)
    })

    // 特殊字符处理
    it('should handle special characters correctly', () => {
      expect(getPotentialStartIndex('Hello\nworld', 'world')).toBe(6)
      expect(getPotentialStartIndex('Hello\n', '\nworld')).toBe(5)
      expect(getPotentialStartIndex('Test 中文', '中文测试')).toBe(5)
    })
  })
})
