import { describe, expect, it } from 'vitest'

import {
  cleanLinkCommas,
  completeLinks,
  convertLinks,
  convertLinksToHunyuan,
  convertLinksToOpenRouter,
  convertLinksToZhipu,
  extractUrlsFromMarkdown
} from '../linkConverter'

describe('linkConverter', () => {
  describe('convertLinksToZhipu', () => {
    it('should correctly convert complete [ref_N] format', () => {
      const input = '这里有一个参考文献 [ref_1] 和另一个 [ref_2]'
      const result = convertLinksToZhipu(input, true)
      expect(result).toBe('这里有一个参考文献 [<sup>1</sup>]() 和另一个 [<sup>2</sup>]()')
    })

    it('should handle chunked input and preserve incomplete link patterns', () => {
      // 第一个块包含未完成的模式
      const chunk1 = '这是第一部分 [ref'
      const result1 = convertLinksToZhipu(chunk1, true)
      expect(result1).toBe('这是第一部分 ')

      // 第二个块完成该模式
      const chunk2 = '_1] 这是剩下的部分'
      const result2 = convertLinksToZhipu(chunk2, false)
      expect(result2).toBe('[<sup>1</sup>]() 这是剩下的部分')
    })

    it('should clear buffer when resetting counter', () => {
      // 先进行一次转换不重置
      const input1 = '第一次输入 [ref_1]'
      convertLinksToZhipu(input1, false)

      // 然后重置并进行新的转换
      const input2 = '新的输入 [ref_2]'
      const result = convertLinksToZhipu(input2, true)
      expect(result).toBe('新的输入 [<sup>2</sup>]()')
    })
  })

  describe('convertLinksToHunyuan', () => {
    it('should correctly convert [N](@ref) format to links with URLs', () => {
      const webSearch = [{ url: 'https://example.com/1' }, { url: 'https://example.com/2' }]
      const input = '这里有单个引用 [1](@ref) 和多个引用 [2](@ref)'
      const result = convertLinksToHunyuan(input, webSearch, true)
      expect(result).toBe(
        '这里有单个引用 [<sup>1</sup>](https://example.com/1) 和多个引用 [<sup>2</sup>](https://example.com/2)'
      )
    })

    it('should correctly handle comma-separated multiple references', () => {
      const webSearch = [
        { url: 'https://example.com/1' },
        { url: 'https://example.com/2' },
        { url: 'https://example.com/3' }
      ]
      const input = '这里有多个引用 [1, 2, 3](@ref)'
      const result = convertLinksToHunyuan(input, webSearch, true)
      expect(result).toBe(
        '这里有多个引用 [<sup>1</sup>](https://example.com/1)[<sup>2</sup>](https://example.com/2)[<sup>3</sup>](https://example.com/3)'
      )
    })

    it('should handle non-existent reference indices', () => {
      const webSearch = [{ url: 'https://example.com/1' }]
      const input = '这里有一个超出范围的引用 [2](@ref)'
      const result = convertLinksToHunyuan(input, webSearch, true)
      expect(result).toBe('这里有一个超出范围的引用 [<sup>2</sup>](@ref)')
    })

    it('should handle incomplete reference formats in chunked input', () => {
      const webSearch = [{ url: 'https://example.com/1' }]
      // 第一个块包含未完成的模式
      const chunk1 = '这是第一部分 ['
      const result1 = convertLinksToHunyuan(chunk1, webSearch, true)
      expect(result1).toBe('这是第一部分 ')

      // 第二个块完成该模式
      const chunk2 = '1](@ref) 这是剩下的部分'
      const result2 = convertLinksToHunyuan(chunk2, webSearch, false)
      expect(result2).toBe('[<sup>1</sup>](https://example.com/1) 这是剩下的部分')
    })
  })

  describe('convertLinks', () => {
    it('should convert links with domain-like text to numbered links', () => {
      const input = '查看这个网站 [example.com](https://example.com)'
      const result = convertLinks(input, true)
      expect(result).toBe('查看这个网站 [<sup>1</sup>](https://example.com)')
    })

    it('should handle parenthesized link format ([host](url))', () => {
      const input = '这里有链接 ([example.com](https://example.com))'
      const result = convertLinks(input, true)
      expect(result).toBe('这里有链接 [<sup>1</sup>](https://example.com)')
    })

    it('should use the same counter for duplicate URLs', () => {
      const input =
        '第一个链接 [example.com](https://example.com) 和第二个相同链接 [subdomain.example.com](https://example.com)'
      const result = convertLinks(input, true)
      expect(result).toBe(
        '第一个链接 [<sup>1</sup>](https://example.com) 和第二个相同链接 [<sup>1</sup>](https://example.com)'
      )
    })
  })

  describe('convertLinksToOpenRouter', () => {
    it('should only convert links with domain-like text', () => {
      const input = '网站 [example.com](https://example.com) 和 [点击这里](https://other.com)'
      const result = convertLinksToOpenRouter(input, true)
      expect(result).toBe('网站 [<sup>1</sup>](https://example.com) 和 [点击这里](https://other.com)')
    })

    it('should use the same counter for duplicate URLs', () => {
      const input = '两个相同的链接 [example.com](https://example.com) 和 [example.org](https://example.com)'
      const result = convertLinksToOpenRouter(input, true)
      expect(result).toBe('两个相同的链接 [<sup>1</sup>](https://example.com) 和 [<sup>1</sup>](https://example.com)')
    })

    it('should handle incomplete links in chunked input', () => {
      // 第一个块包含未完成的链接
      const chunk1 = '这是域名链接 ['
      const result1 = convertLinksToOpenRouter(chunk1, true)
      expect(result1).toBe('这是域名链接 ')

      // 第二个块完成链接
      const chunk2 = 'example.com](https://example.com)'
      const result2 = convertLinksToOpenRouter(chunk2, false)
      expect(result2).toBe('[<sup>1</sup>](https://example.com)')
    })
  })

  describe('completeLinks', () => {
    it('should complete empty links with webSearch data', () => {
      const webSearch = [{ link: 'https://example.com/1' }, { link: 'https://example.com/2' }]
      const input = '参考 [<sup>1</sup>]() 和 [<sup>2</sup>]()'
      const result = completeLinks(input, webSearch)
      expect(result).toBe('参考 [<sup>1</sup>](https://example.com/1) 和 [<sup>2</sup>](https://example.com/2)')
    })

    it('should preserve link format when URL not found', () => {
      const webSearch = [{ link: 'https://example.com/1' }]
      const input = '参考 [<sup>1</sup>]() 和 [<sup>2</sup>]()'
      const result = completeLinks(input, webSearch)
      expect(result).toBe('参考 [<sup>1</sup>](https://example.com/1) 和 [<sup>2</sup>]()')
    })

    it('should handle empty webSearch array', () => {
      const webSearch: any[] = []
      const input = '参考 [<sup>1</sup>]() 和 [<sup>2</sup>]()'
      const result = completeLinks(input, webSearch)
      expect(result).toBe('参考 [<sup>1</sup>]() 和 [<sup>2</sup>]()')
    })
  })

  describe('extractUrlsFromMarkdown', () => {
    it('should extract URLs from all link formats', () => {
      const input =
        '这里有普通链接 [文本](https://example.com) 和编号链接 [<sup>1</sup>](https://other.com) 以及括号链接 ([域名](https://third.com))'
      const result = extractUrlsFromMarkdown(input)
      expect(result).toEqual(['https://example.com', 'https://other.com', 'https://third.com'])
    })

    it('should deduplicate URLs', () => {
      const input = '重复链接 [链接1](https://example.com) 和 [链接2](https://example.com)'
      const result = extractUrlsFromMarkdown(input)
      expect(result).toEqual(['https://example.com'])
    })

    it('should filter invalid URLs', () => {
      const input = '有效链接 [链接](https://example.com) 和无效链接 [链接](invalid-url)'
      const result = extractUrlsFromMarkdown(input)
      expect(result.length).toBe(1)
      expect(result[0]).toBe('https://example.com')
    })

    it('should handle empty string', () => {
      const input = ''
      const result = extractUrlsFromMarkdown(input)
      expect(result).toEqual([])
    })
  })

  describe('cleanLinkCommas', () => {
    it('should remove commas between links', () => {
      const input = '[链接1](https://example.com),[链接2](https://other.com)'
      const result = cleanLinkCommas(input)
      expect(result).toBe('[链接1](https://example.com)[链接2](https://other.com)')
    })

    it('should handle commas with spaces between links', () => {
      const input = '[链接1](https://example.com) , [链接2](https://other.com)'
      const result = cleanLinkCommas(input)
      expect(result).toBe('[链接1](https://example.com)[链接2](https://other.com)')
    })
  })
})
