import { describe, expect, it } from 'vitest'

import { cleanLinkCommas, completeLinks, extractUrlsFromMarkdown, LinkConverter } from '../linkConverter'

describe('linkConverter', () => {
  describe('LinkConverter.convert', () => {
    it('should convert number links to numbered links', () => {
      const lc = new LinkConverter()
      const input = '参考 [1](https://example.com/1) 和 [2](https://example.com/2)'
      const result = lc.convert(input, true)
      expect(result.text).toBe('参考 [<sup>1</sup>](https://example.com/1) 和 [<sup>2</sup>](https://example.com/2)')
      expect(result.hasBufferedContent).toBe(false)
    })

    it('should convert links with domain-like text to numbered links', () => {
      const lc = new LinkConverter()
      const input = '查看这个网站 [example.com](https://example.com)'
      const result = lc.convert(input, true)
      expect(result.text).toBe('查看这个网站 [<sup>1</sup>](https://example.com)')
      expect(result.hasBufferedContent).toBe(false)
    })

    it('should handle parenthesized link format ([host](url))', () => {
      const lc = new LinkConverter()
      const input = '这里有链接 ([example.com](https://example.com))'
      const result = lc.convert(input, true)
      expect(result.text).toBe('这里有链接 [<sup>1</sup>](https://example.com)')
      expect(result.hasBufferedContent).toBe(false)
    })

    it('should not handle impossible parenthesized grounding link', () => {
      const lc = new LinkConverter()
      const input = 'await sendBatch([1], topicData.topicID, topicData.csrfToken);'
      const result = lc.convert(input, true)
      expect(result.text).toBe(input)
      expect(result.hasBufferedContent).toBe(false)
    })

    it('should use the same counter for duplicate URLs', () => {
      const lc = new LinkConverter()
      const input =
        '第一个链接 [example.com](https://example.com) 和第二个相同链接 [subdomain.example.com](https://example.com)'
      const result = lc.convert(input, true)
      expect(result.text).toBe(
        '第一个链接 [<sup>1</sup>](https://example.com) 和第二个相同链接 [<sup>1</sup>](https://example.com)'
      )
      expect(result.hasBufferedContent).toBe(false)
    })

    it('should not misinterpret code placeholders as incomplete links', () => {
      const lc = new LinkConverter()
      const input =
        'The most common reason for a `404` error is that the repository specified in the `owner` and `repo`'
      const result = lc.convert(input, true)
      expect(result.text).toBe(
        'The most common reason for a `404` error is that the repository specified in the `owner` and `repo`'
      )
      expect(result.hasBufferedContent).toBe(false)
    })

    it('should handle text with square brackets that are not links', () => {
      const lc = new LinkConverter()
      const input = 'Use [owner] and [repo] placeholders in your configuration [file]'
      const result = lc.convert(input, true)
      expect(result.text).toBe('Use [owner] and [repo] placeholders in your configuration [file]')
      expect(result.hasBufferedContent).toBe(false)
    })

    it('should handle markdown code blocks with square brackets', () => {
      const lc = new LinkConverter()
      const input = 'In the code: `const config = { [key]: value }` you can see [brackets]'
      const result = lc.convert(input, true)
      expect(result.text).toBe('In the code: `const config = { [key]: value }` you can see [brackets]')
      expect(result.hasBufferedContent).toBe(false)
    })

    it('should properly handle partial markdown link patterns', () => {
      const lc = new LinkConverter()
      // 这种情况下，[text] 后面没有紧跟 (，所以不应该被当作潜在链接
      const input = 'Check the [documentation] for more details'
      const result = lc.convert(input, true)
      expect(result.text).toBe('Check the [documentation] for more details')
      expect(result.hasBufferedContent).toBe(false)
    })

    it('should correctly identify and handle real incomplete links', () => {
      const lc = new LinkConverter()
      // 第一个块包含真正的不完整链接模式
      const chunk1 = 'Visit [example.com]('
      const result1 = lc.convert(chunk1, true)
      expect(result1.text).toBe('Visit ')
      expect(result1.hasBufferedContent).toBe(true)

      // 第二个块完成该链接
      const chunk2 = 'https://example.com) for more info'
      const result2 = lc.convert(chunk2, false)
      expect(result2.text).toBe('[<sup>1</sup>](https://example.com) for more info')
      expect(result2.hasBufferedContent).toBe(false)
    })

    it('should handle mixed content with real links and placeholders', () => {
      const lc = new LinkConverter()
      const input = 'Configure [owner] and [repo] in [GitHub](https://github.com) settings'
      const result = lc.convert(input, true)
      expect(result.text).toBe('Configure [owner] and [repo] in GitHub [<sup>1</sup>](https://github.com) settings')
      expect(result.hasBufferedContent).toBe(false)
    })

    it('should handle empty text', () => {
      const lc = new LinkConverter()
      const input = ''
      const result = lc.convert(input, true)
      expect(result.text).toBe('')
      expect(result.hasBufferedContent).toBe(false)
    })

    it('should handle text with only square brackets', () => {
      const lc = new LinkConverter()
      const input = '[][][]'
      const result = lc.convert(input, true)
      expect(result.text).toBe('[][][]')
      expect(result.hasBufferedContent).toBe(false)
    })

    describe('streaming small chunks simulation', () => {
      it('should handle non-link placeholders in small chunks without buffering', () => {
        const lc = new LinkConverter()
        // 模拟用户遇到的问题：包含方括号占位符的文本被分成小chunks
        const chunks = [
          'The most common reason for a `404` error is that the repository specified in the `',
          'owner` and `',
          'repo` parameters are incorrect.'
        ]

        let accumulatedText = ''

        // 第一个chunk
        const result1 = lc.convert(chunks[0], true)
        expect(result1.text).toBe(chunks[0]) // 应该立即返回，不缓冲
        expect(result1.hasBufferedContent).toBe(false)
        accumulatedText += result1.text

        // 第二个chunk
        const result2 = lc.convert(chunks[1], false)
        expect(result2.text).toBe(chunks[1]) // 应该立即返回，不缓冲
        expect(result2.hasBufferedContent).toBe(false)
        accumulatedText += result2.text

        // 第三个chunk
        const result3 = lc.convert(chunks[2], false)
        expect(result3.text).toBe(chunks[2]) // 应该立即返回，不缓冲
        expect(result3.hasBufferedContent).toBe(false)
        accumulatedText += result3.text

        // 验证最终结果
        expect(accumulatedText).toBe(chunks.join(''))
        expect(accumulatedText).toBe(
          'The most common reason for a `404` error is that the repository specified in the `owner` and `repo` parameters are incorrect.'
        )
      })

      it('should handle real links split across small chunks with proper buffering', () => {
        const lc = new LinkConverter()
        // 模拟真实链接被分割成小chunks的情况 - 更现实的分割方式
        const chunks = [
          'Please visit [example.',
          'com](', // 不完整链接'
          'https://exa',
          'mple.com) for details' // 完成链接'
        ]

        let accumulatedText = ''

        // 第一个chunk：包含不完整链接 [text](
        const result1 = lc.convert(chunks[0], true)
        expect(result1.text).toBe('Please visit ') // 只返回安全部分
        expect(result1.hasBufferedContent).toBe(true) //
        accumulatedText += result1.text

        // 第二个chunk
        const result2 = lc.convert(chunks[1], false)
        expect(result2.text).toBe('')
        expect(result2.hasBufferedContent).toBe(true)
        // 第三个chunk
        const result3 = lc.convert(chunks[2], false)
        expect(result3.text).toBe('')
        expect(result3.hasBufferedContent).toBe(true)
        accumulatedText += result3.text

        // 第四个chunk
        const result4 = lc.convert(chunks[3], false)
        expect(result4.text).toBe('[<sup>1</sup>](https://example.com) for details')
        expect(result4.hasBufferedContent).toBe(false)
        accumulatedText += result4.text

        // 验证最终结果
        expect(accumulatedText).toBe('Please visit [<sup>1</sup>](https://example.com) for details')
      })

      it('should handle mixed content with placeholders and real links in small chunks', () => {
        const lc = new LinkConverter()
        // 混合内容：既有占位符又有真实链接 - 更现实的分割方式
        const chunks = [
          'Configure [owner] and [repo] in [GitHub](', // 占位符 + 不完整链接
          'https://github.com) settings page.' // 完成链接
        ]

        let accumulatedText = ''

        // 第一个chunk：包含占位符和不完整链接
        const result1 = lc.convert(chunks[0], true)
        expect(result1.text).toBe('Configure [owner] and [repo] in ') // 占位符保留，链接部分被缓冲
        expect(result1.hasBufferedContent).toBe(true) // [GitHub]( 被缓冲
        accumulatedText += result1.text

        // 第二个chunk：完成链接
        const result2 = lc.convert(chunks[1], false)
        expect(result2.text).toBe('GitHub [<sup>1</sup>](https://github.com) settings page.') // 完整链接 + 剩余文本
        expect(result2.hasBufferedContent).toBe(false)
        accumulatedText += result2.text

        // 验证最终结果
        expect(accumulatedText).toBe(
          'Configure [owner] and [repo] in GitHub [<sup>1</sup>](https://github.com) settings page.'
        )
        expect(accumulatedText).toContain('[owner] and [repo]') // 占位符保持原样
        expect(accumulatedText).toContain('[<sup>1</sup>](https://github.com)') // 链接被转换
      })

      it('should properly handle buffer flush at stream end', () => {
        const lc = new LinkConverter()
        // 测试流结束时的buffer清理
        const incompleteChunk = 'Check the documentation at [GitHub]('
        const result = lc.convert(incompleteChunk, true)

        // 应该有内容被缓冲
        expect(result.hasBufferedContent).toBe(true)
        expect(result.text).toBe('Check the documentation at ') // 只返回安全部分

        // 模拟流结束，强制清空buffer
        const remainingText = lc.flush()
        expect(remainingText).toBe('[GitHub](') // buffer中的剩余内容
      })
    })

    describe('concurrent stream isolation', () => {
      it('should not leak buffered text between two interleaved converters', () => {
        // Regression test for cross-conversation streaming bleed: two streams run
        // concurrently, each with its own LinkConverter. Stream A buffers an
        // incomplete link while stream B emits unrelated text in between. With the
        // old module-level buffer, A's buffered tail leaked into B's output (and
        // B's reset wiped A's buffer). With per-instance state, each stays isolated.
        const lcA = new LinkConverter()
        const lcB = new LinkConverter()

        let textA = ''
        let textB = ''

        // A: starts an incomplete link → buffers the tail
        const a1 = lcA.convert('Visit [example.com](', true)
        expect(a1.hasBufferedContent).toBe(true)
        textA += a1.text

        // B: a fresh stream resets ITS OWN state; must not touch A's buffer
        const b1 = lcB.convert('Plain text from B with [docs] placeholder', true)
        expect(b1.hasBufferedContent).toBe(false)
        textB += b1.text

        // A: completes its link → uses A's own buffer, not contaminated by B
        const a2 = lcA.convert('https://example.com) done', false)
        expect(a2.hasBufferedContent).toBe(false)
        textA += a2.text

        // B: continues with its own incomplete link
        const b2 = lcB.convert(' and a link [GitHub](', false)
        expect(b2.hasBufferedContent).toBe(true)
        textB += b2.text
        const b3 = lcB.convert('https://github.com) end', false)
        textB += b3.text

        // Each stream produced exactly its own content, with independent counters
        expect(textA).toBe('Visit [<sup>1</sup>](https://example.com) done')
        expect(textB).toBe(
          'Plain text from B with [docs] placeholder and a link GitHub [<sup>1</sup>](https://github.com) end'
        )

        // No fragment of one stream appears in the other
        expect(textA).not.toContain('GitHub')
        expect(textA).not.toContain('docs')
        expect(textB).not.toContain('example.com')
      })
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
