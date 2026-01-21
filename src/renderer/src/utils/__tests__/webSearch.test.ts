import type { KnowledgeReference, WebSearchProviderResult } from '@renderer/types'
import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import { describe, expect, it } from 'vitest'

import {
  consolidateReferencesByUrl,
  getProviderType,
  isApiProvider,
  isLocalProvider,
  isValidDomain,
  isValidRegexPattern,
  parseDomains,
  selectReferences,
  validateDomains
} from '../webSearch'

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

  describe('selectReferences', () => {
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

    it('should select references using round robin strategy', () => {
      const rawResults = [
        createMockRawResult('https://a.com', 'A'),
        createMockRawResult('https://b.com', 'B'),
        createMockRawResult('https://c.com', 'C')
      ]

      const references = [
        createMockReference('https://a.com', 'A1', 1),
        createMockReference('https://a.com', 'A2', 2),
        createMockReference('https://b.com', 'B1', 3),
        createMockReference('https://c.com', 'C1', 4),
        createMockReference('https://c.com', 'C2', 5)
      ]

      const result = selectReferences(rawResults, references, 4)

      expect(result).toHaveLength(4)
      // 按照 rawResults 顺序轮询：A1, B1, C1, A2
      expect(result[0].content).toBe('A1')
      expect(result[1].content).toBe('B1')
      expect(result[2].content).toBe('C1')
      expect(result[3].content).toBe('A2')
    })

    it('should handle maxRefs larger than available references', () => {
      const rawResults = [createMockRawResult('https://a.com', 'A')]
      const references = [createMockReference('https://a.com', 'A1', 1)]

      const result = selectReferences(rawResults, references, 10)

      expect(result).toHaveLength(1)
      expect(result[0].content).toBe('A1')
    })

    it('should return empty array for edge cases', () => {
      const rawResults = [createMockRawResult('https://a.com', 'A')]
      const references = [createMockReference('https://a.com', 'A1', 1)]

      // maxRefs is 0
      expect(selectReferences(rawResults, references, 0)).toEqual([])

      // empty references
      expect(selectReferences(rawResults, [], 5)).toEqual([])

      // no matching URLs
      const nonMatchingRefs = [createMockReference('https://different.com', 'Content', 1)]
      expect(selectReferences(rawResults, nonMatchingRefs, 5)).toEqual([])
    })

    it('should preserve rawResults order in round robin', () => {
      // rawResults 的顺序应该影响轮询顺序
      const rawResults = [
        createMockRawResult('https://z.com', 'Z'), // 应该第一个被选择
        createMockRawResult('https://a.com', 'A') // 应该第二个被选择
      ]

      const references = [createMockReference('https://a.com', 'A1', 1), createMockReference('https://z.com', 'Z1', 2)]

      const result = selectReferences(rawResults, references, 2)

      expect(result).toHaveLength(2)
      expect(result[0].content).toBe('Z1') // Z 先被选择
      expect(result[1].content).toBe('A1') // A 后被选择
    })
  })

  // ============================================================================
  // Provider Type Helpers
  // ============================================================================

  describe('isLocalProvider', () => {
    const createProvider = (type: 'local' | 'api'): WebSearchProvider => ({
      id: 'test',
      name: 'Test',
      type,
      apiKey: '',
      apiHost: '',
      engines: [],
      usingBrowser: false,
      basicAuthUsername: '',
      basicAuthPassword: ''
    })

    it('should return true for local type provider', () => {
      const provider = createProvider('local')
      expect(isLocalProvider(provider)).toBe(true)
    })

    it('should return false for api type provider', () => {
      const provider = createProvider('api')
      expect(isLocalProvider(provider)).toBe(false)
    })
  })

  describe('isApiProvider', () => {
    const createProvider = (type: 'local' | 'api'): WebSearchProvider => ({
      id: 'test',
      name: 'Test',
      type,
      apiKey: '',
      apiHost: '',
      engines: [],
      usingBrowser: false,
      basicAuthUsername: '',
      basicAuthPassword: ''
    })

    it('should return true for api type provider', () => {
      const provider = createProvider('api')
      expect(isApiProvider(provider)).toBe(true)
    })

    it('should return false for local type provider', () => {
      const provider = createProvider('local')
      expect(isApiProvider(provider)).toBe(false)
    })
  })

  describe('getProviderType', () => {
    const createProvider = (type: 'local' | 'api'): WebSearchProvider => ({
      id: 'test',
      name: 'Test',
      type,
      apiKey: '',
      apiHost: '',
      engines: [],
      usingBrowser: false,
      basicAuthUsername: '',
      basicAuthPassword: ''
    })

    it('should return "local" for local provider', () => {
      const provider = createProvider('local')
      expect(getProviderType(provider)).toBe('local')
    })

    it('should return "api" for api provider', () => {
      const provider = createProvider('api')
      expect(getProviderType(provider)).toBe('api')
    })
  })

  // ============================================================================
  // Domain Validation Helpers
  // ============================================================================

  describe('isValidRegexPattern', () => {
    it('should return true for valid regex pattern', () => {
      expect(isValidRegexPattern('/example\\.com/')).toBe(true)
      expect(isValidRegexPattern('/.*\\.google\\.com/')).toBe(true)
      expect(isValidRegexPattern('/^https?:\\/\\//')).toBe(true)
    })

    it('should return false for invalid regex pattern', () => {
      expect(isValidRegexPattern('/[invalid/')).toBe(false)
      expect(isValidRegexPattern('/(unclosed/')).toBe(false)
      expect(isValidRegexPattern('/\\/')).toBe(false)
    })

    it('should return false for empty pattern', () => {
      expect(isValidRegexPattern('//')).toBe(true) // Empty regex is valid
    })

    it('should handle complex regex patterns', () => {
      expect(isValidRegexPattern('/^https?:\\/\\/([a-z0-9-]+\\.)*example\\.com/')).toBe(true)
      expect(isValidRegexPattern('/\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}/')).toBe(true)
    })

    it('should handle special characters in regex', () => {
      expect(isValidRegexPattern('/[a-zA-Z0-9]/')).toBe(true)
      expect(isValidRegexPattern('/(?:foo|bar)/')).toBe(true)
    })
  })

  describe('isValidDomain', () => {
    it('should return true for valid match patterns', () => {
      expect(isValidDomain('*://example.com/*')).toBe(true)
      expect(isValidDomain('https://example.com/*')).toBe(true)
      expect(isValidDomain('http://example.com/path/*')).toBe(true)
    })

    it('should return true for wildcard patterns', () => {
      expect(isValidDomain('*://*.example.com/*')).toBe(true)
      expect(isValidDomain('https://*.google.com/*')).toBe(true)
    })

    it('should return true for valid regex patterns', () => {
      expect(isValidDomain('/example\\.com/')).toBe(true)
      expect(isValidDomain('/.*\\.google\\.com/')).toBe(true)
    })

    it('should return false for invalid regex patterns', () => {
      expect(isValidDomain('/[invalid/')).toBe(false)
    })

    it('should return false for empty string', () => {
      expect(isValidDomain('')).toBe(false)
    })

    it('should return false for whitespace-only string', () => {
      expect(isValidDomain('   ')).toBe(false)
      expect(isValidDomain('\t\n')).toBe(false)
    })

    it('should trim and validate domain', () => {
      expect(isValidDomain('  *://example.com/*  ')).toBe(true)
      expect(isValidDomain('\t/example\\.com/\t')).toBe(true)
    })

    it('should return false for invalid patterns', () => {
      expect(isValidDomain('not-a-valid-pattern')).toBe(false)
      expect(isValidDomain('example.com')).toBe(false) // Missing scheme and path
    })
  })

  describe('validateDomains', () => {
    it('should return all domains in valid array when all are valid', () => {
      const domains = ['*://example.com/*', 'https://google.com/*', '/regex\\.com/']
      const result = validateDomains(domains)
      expect(result.valid).toEqual(domains)
      expect(result.invalid).toEqual([])
    })

    it('should return all domains in invalid array when all are invalid', () => {
      const domains = ['invalid', 'also-invalid', '/[unclosed/']
      const result = validateDomains(domains)
      expect(result.valid).toEqual([])
      expect(result.invalid).toEqual(domains)
    })

    it('should correctly classify mixed domains', () => {
      const result = validateDomains(['*://example.com/*', 'invalid', '/valid\\.regex/', '/[unclosed/'])
      expect(result.valid).toEqual(['*://example.com/*', '/valid\\.regex/'])
      expect(result.invalid).toEqual(['invalid', '/[unclosed/'])
    })

    it('should return empty arrays for empty input', () => {
      const result = validateDomains([])
      expect(result.valid).toEqual([])
      expect(result.invalid).toEqual([])
    })

    it('should filter out empty string elements', () => {
      const result = validateDomains(['*://example.com/*', '', '   ', 'https://test.com/*'])
      expect(result.valid).toEqual(['*://example.com/*', 'https://test.com/*'])
      expect(result.invalid).toEqual([])
    })

    it('should trim all domains before validation', () => {
      const result = validateDomains(['  *://example.com/*  ', '\thttps://test.com/*\n'])
      expect(result.valid).toEqual(['*://example.com/*', 'https://test.com/*'])
      expect(result.invalid).toEqual([])
    })
  })

  describe('parseDomains', () => {
    it('should split text by newlines', () => {
      const text = 'domain1.com\ndomain2.com\ndomain3.com'
      const result = parseDomains(text)
      expect(result).toEqual(['domain1.com', 'domain2.com', 'domain3.com'])
    })

    it('should filter out empty lines', () => {
      const text = 'domain1.com\n\ndomain2.com\n\n\ndomain3.com'
      const result = parseDomains(text)
      expect(result).toEqual(['domain1.com', 'domain2.com', 'domain3.com'])
    })

    it('should trim each line', () => {
      const text = '  domain1.com  \n\tdomain2.com\t\n   domain3.com   '
      const result = parseDomains(text)
      expect(result).toEqual(['domain1.com', 'domain2.com', 'domain3.com'])
    })

    it('should return empty array for empty input', () => {
      expect(parseDomains('')).toEqual([])
      expect(parseDomains('\n\n\n')).toEqual([])
      expect(parseDomains('   \n   \n   ')).toEqual([])
    })

    it('should return single element array for single line', () => {
      const result = parseDomains('single-domain.com')
      expect(result).toEqual(['single-domain.com'])
    })
  })
})
