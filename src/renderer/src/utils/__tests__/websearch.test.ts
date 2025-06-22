import { KnowledgeReference, WebSearchProviderResult } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import { consolidateReferencesByUrl } from '../websearch'

describe('websearch', () => {
  describe('consolidateReferencesByUrl', () => {
    const createMockRawResult = (url: string, title: string): WebSearchProviderResult => ({
      title,
      url,
      content: `Original content for ${title}`
    })

    const createMockReference = (sourceUrl: string, content: string, id: number = 1): KnowledgeReference => ({
      id,
      sourceUrl,
      content,
      type: 'url'
    })

    it('should consolidate single reference to matching raw result', () => {
      // 基本功能：单个引用与原始结果匹配
      const rawResults = [createMockRawResult('https://example.com', 'Example Title')]
      const references = [createMockReference('https://example.com', 'Retrieved content')]

      const result = consolidateReferencesByUrl(rawResults, references)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        title: 'Example Title',
        url: 'https://example.com',
        content: 'Retrieved content'
      })
    })

    it('should consolidate multiple references from same source URL', () => {
      // 多个片段合并到同一个URL
      const rawResults = [createMockRawResult('https://example.com', 'Example Title')]
      const references = [
        createMockReference('https://example.com', 'First content', 1),
        createMockReference('https://example.com', 'Second content', 2)
      ]

      const result = consolidateReferencesByUrl(rawResults, references)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        title: 'Example Title',
        url: 'https://example.com',
        content: 'First content\n\n---\n\nSecond content'
      })
    })

    it('should consolidate references from multiple source URLs', () => {
      // 多个不同URL的引用
      const rawResults = [
        createMockRawResult('https://example.com', 'Example Title'),
        createMockRawResult('https://test.com', 'Test Title')
      ]
      const references = [
        createMockReference('https://example.com', 'Example content', 1),
        createMockReference('https://test.com', 'Test content', 2)
      ]

      const result = consolidateReferencesByUrl(rawResults, references)

      expect(result).toHaveLength(2)
      // 结果顺序可能不确定，使用 toContainEqual
      expect(result).toContainEqual({
        title: 'Example Title',
        url: 'https://example.com',
        content: 'Example content'
      })
      expect(result).toContainEqual({
        title: 'Test Title',
        url: 'https://test.com',
        content: 'Test content'
      })
    })

    it('should use custom separator for multiple references', () => {
      // 自定义分隔符
      const rawResults = [createMockRawResult('https://example.com', 'Example Title')]
      const references = [
        createMockReference('https://example.com', 'First content', 1),
        createMockReference('https://example.com', 'Second content', 2)
      ]

      const result = consolidateReferencesByUrl(rawResults, references, ' | ')

      expect(result).toHaveLength(1)
      expect(result[0].content).toBe('First content | Second content')
    })

    it('should ignore references with no matching raw result', () => {
      // 无匹配的引用
      const rawResults = [createMockRawResult('https://example.com', 'Example Title')]
      const references = [
        createMockReference('https://example.com', 'Matching content', 1),
        createMockReference('https://nonexistent.com', 'Non-matching content', 2)
      ]

      const result = consolidateReferencesByUrl(rawResults, references)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        title: 'Example Title',
        url: 'https://example.com',
        content: 'Matching content'
      })
    })

    it('should return empty array when no references match raw results', () => {
      // 完全无匹配的情况
      const rawResults = [createMockRawResult('https://example.com', 'Example Title')]
      const references = [createMockReference('https://nonexistent.com', 'Non-matching content', 1)]

      const result = consolidateReferencesByUrl(rawResults, references)

      expect(result).toHaveLength(0)
    })

    it('should handle empty inputs', () => {
      // 边界条件：空输入
      expect(consolidateReferencesByUrl([], [])).toEqual([])

      const rawResults = [createMockRawResult('https://example.com', 'Example Title')]
      expect(consolidateReferencesByUrl(rawResults, [])).toEqual([])

      const references = [createMockReference('https://example.com', 'Content', 1)]
      expect(consolidateReferencesByUrl([], references)).toEqual([])
    })

    it('should preserve original result metadata', () => {
      // 验证原始结果的元数据保持不变
      const rawResults = [createMockRawResult('https://example.com', 'Complex Title with Special Characters & Symbols')]
      const references = [createMockReference('https://example.com', 'New content', 1)]

      const result = consolidateReferencesByUrl(rawResults, references)

      expect(result[0].title).toBe('Complex Title with Special Characters & Symbols')
      expect(result[0].url).toBe('https://example.com')
    })
  })
})
