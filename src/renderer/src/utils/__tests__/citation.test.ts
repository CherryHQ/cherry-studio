import { GroundingSupport } from '@google/genai'
import { Citation, WebSearchSource } from '@renderer/types'
import { describe, expect, it, vi } from 'vitest'

import {
  determineCitationSource,
  generateCitationTag,
  mapCitationMarksToTags,
  normalizeCitationMarks,
  withCitationTags
} from '../citation'

// Mock dependencies
vi.mock('@renderer/utils/formats', () => ({
  cleanMarkdownContent: vi.fn((content: string) => content.replace(/[*_~`]/g, '')),
  encodeHTML: vi.fn((str: string) =>
    str.replace(/[&<>"']/g, (match) => {
      const entities: { [key: string]: string } = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;'
      }
      return entities[match]
    })
  )
}))

describe('citation', () => {
  const createCitationMap = (citations: Citation[]) => new Map(citations.map((c) => [c.number, c]))

  describe('determineCitationSource', () => {
    it('should find the the citation source', () => {
      const citationReferences = [{ citationBlockId: 'block1', citationBlockSource: WebSearchSource.OPENAI }]

      const result = determineCitationSource(citationReferences)
      expect(result).toBe(WebSearchSource.OPENAI)
    })

    it('should find first valid source in citation references', () => {
      const citationReferences = [
        { citationBlockId: 'block1' }, // no source
        { citationBlockId: 'block2', citationBlockSource: WebSearchSource.GEMINI },
        { citationBlockId: 'block3', citationBlockSource: WebSearchSource.GEMINI }
      ]

      const result = determineCitationSource(citationReferences)
      expect(result).toBe(WebSearchSource.GEMINI)
    })

    it('should return undefined when no sources available', () => {
      const citationReferences = [
        { citationBlockId: 'block1' }, // no source
        { citationBlockId: 'block2' } // no source
      ]

      const result = determineCitationSource(citationReferences)
      expect(result).toBeUndefined()
    })

    it('should return undefined for empty citation references', () => {
      const result = determineCitationSource([])
      expect(result).toBeUndefined()
    })

    it('should return undefined for undefined citation references', () => {
      const result = determineCitationSource(undefined)
      expect(result).toBeUndefined()
    })
  })

  describe('withCitationTags', () => {
    it('should process citations with default source type', () => {
      const content = 'Test content [1] with citation'
      const citations: Citation[] = [
        {
          number: 1,
          url: 'https://example.com',
          title: 'Example'
        }
      ]

      const result = withCitationTags(content, citations)

      expect(result).toContain('[<sup data-citation=')
      expect(result).toContain('1</sup>](https://example.com)')
    })

    it('should process citations with OpenAI source type', () => {
      const content = 'Test content [<sup>1</sup>](https://example.com)'
      const citations: Citation[] = [
        {
          number: 1,
          url: 'https://example.com',
          title: 'Example',
          content: 'Some **content**'
        }
      ]

      const result = withCitationTags(content, citations, WebSearchSource.OPENAI)

      expect(result).toContain('[<sup data-citation=')
      expect(result).toContain('1</sup>](https://example.com)')
    })

    it('should process citations with Gemini source type', () => {
      const content = 'Test content from Gemini'
      const metadata: GroundingSupport[] = [
        {
          segment: { text: 'Test content' },
          groundingChunkIndices: [0]
        }
      ]
      const citations: Citation[] = [
        {
          number: 1,
          url: 'https://example.com',
          title: 'Example',
          metadata
        }
      ]

      const result = withCitationTags(content, citations, WebSearchSource.GEMINI)

      expect(result).toContain('Test content[<sup data-citation=')
      expect(result).toContain('1</sup>](https://example.com)')
    })

    it('should handle empty citations array', () => {
      const content = 'This is test content [1]'
      const result = withCitationTags(content, [])
      expect(result).toBe(content)
    })
  })

  describe('normalizeCitationMarks with markdown', () => {
    const citations: Citation[] = [
      { number: 1, url: 'https://example1.com', title: 'Example 1' },
      { number: 2, url: 'https://example2.com', title: 'Example 2' },
      { number: 3, url: 'https://example3.com', title: 'Example 3' }
    ]
    const citationMap = createCitationMap(citations)

    it('should not process citations in inline code', () => {
      const content = 'Here is `code with [1] citation` and normal [2] citation'
      const result = normalizeCitationMarks(content, citationMap)

      // 内联代码中的 [1] 应该保持不变
      expect(result).toContain('`code with [1] citation`')
      // 普通文本中的 [2] 应该被处理
      expect(result).toContain('[cite:2]')
    })

    it('should not process citations in code blocks', () => {
      const content = `Text with citation [1]

\`\`\`python
# Python code with [2] reference
def func():
  data = [3, 4, 5]  # Array with [1] element reference
  return data
\`\`\`

\`\`\`bash
echo "Command with [2] parameter"
\`\`\`

    // Indented code block is not skipped
    echo "Indented code block [3]"

Normal text with [3] citation`

      const result = normalizeCitationMarks(content, citationMap)

      // 代码块内的内容应该保持原样
      expect(result).toContain('# Python code with [2] reference')
      expect(result).toContain('data = [3, 4, 5]  # Array with [1] element reference')
      expect(result).toContain('echo "Command with [2] parameter"')

      // 代码块外的引用应该被处理
      expect(result).toContain('Text with citation [cite:1]')
      expect(result).toContain('Indented code block [cite:3]')
      expect(result).toContain('Normal text with [cite:3]')
    })

    it('should handle malformed code blocks', () => {
      const content = `Text with [1]

\`\`\`unclosed
Code block without closing
With [2] citation

Normal text with [3] continues`

      const result = normalizeCitationMarks(content, citationMap)

      expect(result).toContain('[cite:1]')
      expect(result).toContain('[cite:2]')
      expect(result).toContain('[cite:3]')
    })

    it('should handle citations in various markdown structures', () => {
      const content = `Normal citation [1]

> This is a blockquote with [2] citation
> And another line with [3]

Back to normal **with [1] again**

# Heading with [3] citation
## Subheading with [2] citation

List:
- list item with citation [1]

Numbered list:
1. item with [2]`

      const result = normalizeCitationMarks(content, citationMap)
      console.log(result)

      expect(result).toContain('citation [cite:1]')
      expect(result).toContain('blockquote with [cite:2]')
      expect(result).toContain('another line with [cite:3]')
      expect(result).toContain('with [cite:1] again')
      expect(result).toContain('Heading with [cite:3]')
      expect(result).toContain('Subheading with [cite:2]')
      expect(result).toContain('list item with citation [cite:1]')
      expect(result).toContain('item with [cite:2]')
    })
  })

  describe('normalizeCitationMarks simple', () => {
    describe('OpenAI format citations', () => {
      it('should normalize OpenAI format citations', () => {
        const content = 'Text with [<sup>1</sup>](https://example.com) citation'
        const citations: Citation[] = [{ number: 1, url: 'https://example.com', title: 'Test' }]
        const citationMap = createCitationMap(citations)

        for (const sourceType of [WebSearchSource.OPENAI, WebSearchSource.OPENAI_RESPONSE]) {
          const result = normalizeCitationMarks(content, citationMap, sourceType)
          expect(result).toBe('Text with [cite:1] citation')
        }
      })

      it('should preserve non-matching OpenAI citations', () => {
        const content = 'Text with [<sup>3</sup>](https://missing.com) citation'
        const citations: Citation[] = [{ number: 1, url: 'https://example.com', title: 'Test' }]
        const citationMap = createCitationMap(citations)

        for (const sourceType of [WebSearchSource.OPENAI, WebSearchSource.OPENAI_RESPONSE]) {
          const result = normalizeCitationMarks(content, citationMap, sourceType)
          expect(result).toBe('Text with [<sup>3</sup>](https://missing.com) citation')
        }
      })
    })

    describe('Perplexity format citations', () => {
      it('should normalize Perplexity format citations', () => {
        const content = 'Perplexity citations [<sup>1</sup>](https://example.com)'
        const citations: Citation[] = [
          { number: 1, url: 'https://example.com', title: 'Example Citation', content: 'Citation content' }
        ]
        const citationMap = new Map(citations.map((c) => [c.number, c]))

        const normalized = normalizeCitationMarks(content, citationMap, WebSearchSource.PERPLEXITY)
        expect(normalized).toBe('Perplexity citations [cite:1]')
      })

      it('should preserve unmatched Perplexity citations', () => {
        const content = 'Text with [<sup>2</sup>](https://notfound.com) citation'
        const citations: Citation[] = [{ number: 1, url: 'https://example.com', title: 'Example Citation' }]
        const citationMap = new Map(citations.map((c) => [c.number, c]))

        // 2号引用不存在，应该保持原样
        const normalized = normalizeCitationMarks(content, citationMap, WebSearchSource.PERPLEXITY)
        expect(normalized).toBe('Text with [<sup>2</sup>](https://notfound.com) citation')
      })
    })

    describe('Gemini format citations', () => {
      it('should normalize Gemini format citations', () => {
        const content = 'This is test content from Gemini'
        const metadata: GroundingSupport[] = [
          {
            segment: { text: 'test content' },
            groundingChunkIndices: [0, 1]
          }
        ]
        const citations: Citation[] = [
          { number: 1, url: 'https://example1.com', title: 'Test 1', metadata },
          { number: 2, url: 'https://example2.com', title: 'Test 2' }
        ]
        const citationMap = createCitationMap(citations)

        const result = normalizeCitationMarks(content, citationMap, WebSearchSource.GEMINI)

        expect(result).toBe('This is test content[cite:1][cite:2] from Gemini')
      })

      it('should handle Gemini citations without metadata', () => {
        const content = 'Content without metadata'
        const citations: Citation[] = [{ number: 1, url: 'https://example.com', title: 'Test' }]
        const citationMap = createCitationMap(citations)

        const result = normalizeCitationMarks(content, citationMap, WebSearchSource.GEMINI)

        expect(result).toBe('Content without metadata')
      })
    })

    describe('default format citations', () => {
      it('should normalize default format citations', () => {
        const content = 'Text with [1][2] and [3] citations'
        const citations: Citation[] = [
          { number: 1, url: 'https://example1.com', title: 'Test 1' },
          { number: 2, url: 'https://example2.com', title: 'Test 2' },
          { number: 3, url: 'https://example3.com', title: 'Test 3' }
        ]
        const citationMap = createCitationMap(citations)

        const result = normalizeCitationMarks(content, citationMap)

        expect(result).toBe('Text with [cite:1][cite:2] and [cite:3] citations')
      })

      it('should preserve non-matching default format citations', () => {
        const content = 'Text with [1] and [3] citations'
        const citations: Citation[] = [{ number: 1, url: 'https://example1.com', title: 'Test 1' }]
        const citationMap = createCitationMap(citations)

        const result = normalizeCitationMarks(content, citationMap)

        expect(result).toBe('Text with [cite:1] and [3] citations')
      })

      it('should handle nested citation patterns', () => {
        const content = 'Text with [[1]] and [cite:[2]] patterns'
        const citations: Citation[] = [
          { number: 1, url: 'https://example1.com', title: 'Test 1' },
          { number: 2, url: 'https://example2.com', title: 'Test 2' }
        ]
        const citationMap = new Map(citations.map((c) => [c.number, c]))

        const result = normalizeCitationMarks(content, citationMap)

        // 最里面的会被处理
        expect(result).toBe('Text with [[cite:1]] and [cite:[cite:2]] patterns')
      })

      it('should handle mixed citation formats', () => {
        const content = 'Text with [1] and [<sup>2</sup>](url) and other [3] formats'
        const citations: Citation[] = [
          { number: 1, url: 'https://example1.com', title: 'Test 1' },
          { number: 2, url: 'https://example2.com', title: 'Test 2' }
        ]
        const citationMap = createCitationMap(citations)

        const result = normalizeCitationMarks(content, citationMap, WebSearchSource.OPENAI)

        expect(result).toBe('Text with [1] and [cite:2] and other [3] formats')
      })
    })
  })

  describe('mapCitationMarksToTags', () => {
    const createCitationMap = (citations: Citation[]) => new Map(citations.map((c) => [c.number, c]))

    it('should convert cite marks to tags', () => {
      const content = 'Text with [cite:1] citation'
      const citations: Citation[] = [{ number: 1, url: 'https://example.com', title: 'Test' }]
      const citationMap = createCitationMap(citations)

      const result = mapCitationMarksToTags(content, citationMap)

      expect(result).toContain('with [<sup data-citation=')
      expect(result).toContain('1</sup>](https://example.com) citation')
    })

    it('should handle multiple cite marks', () => {
      const content = 'Text with [cite:1][cite:2] and [cite:3] citations'
      const citations: Citation[] = [
        { number: 1, url: 'https://example1.com', title: 'Test 1' },
        { number: 2, url: 'https://example2.com', title: 'Test 2' },
        { number: 3, url: 'https://example3.com', title: 'Test 3' }
      ]
      const citationMap = createCitationMap(citations)

      const result = mapCitationMarksToTags(content, citationMap)

      expect(result).toContain('with [<sup data-citation=')
      expect(result).toContain('1</sup>](https://example1.com)[<sup data-citation=')
      expect(result).toContain('2</sup>](https://example2.com) and')
      expect(result).toContain('3</sup>](https://example3.com) citations')
    })

    it('should preserve non-matching cite marks', () => {
      const content = 'Text with [cite:1] and [cite:3] citations'
      const citations: Citation[] = [{ number: 1, url: 'https://example1.com', title: 'Test 1' }]
      const citationMap = createCitationMap(citations)

      const result = mapCitationMarksToTags(content, citationMap)

      expect(result).toContain('1</sup>](https://example1.com)')
      expect(result).toContain('[cite:3]') // Should remain unchanged
    })

    it('should handle nested cite marks', () => {
      const content = 'Text with [cite:[cite:1]] and [cite:2] citations'
      const citations: Citation[] = [
        { number: 1, url: 'https://example1.com', title: 'Test 1' },
        { number: 2, url: 'https://example2.com', title: 'Test 2' }
      ]
      const citationMap = createCitationMap(citations)

      const result = mapCitationMarksToTags(content, citationMap)

      expect(result).toContain('[cite:[<sup data-citation=')
      expect(result).toContain('1</sup>](https://example1.com)]')
      expect(result).toContain('2</sup>](https://example2.com)')
    })

    it('should handle content without cite marks', () => {
      const content = 'Text without citations'
      const citationMap = new Map()

      const result = mapCitationMarksToTags(content, citationMap)

      expect(result).toBe('Text without citations')
    })

    it('should handle malformed citation numbers', () => {
      const content = 'Text with [cite:abc] and [cite:] marks'
      const citationMap = new Map()

      const result = mapCitationMarksToTags(content, citationMap)

      expect(result).toBe('Text with [cite:abc] and [cite:] marks')
    })
  })

  describe('generateCitationTag', () => {
    it('should generate citation tag with valid URL', () => {
      const citation: Citation = {
        number: 1,
        url: 'https://example.com',
        title: 'Example Title',
        content: 'Some content here'
      }

      const result = generateCitationTag(citation)

      expect(result).toContain('[<sup data-citation=')
      expect(result).toContain('1</sup>](https://example.com)')
      expect(result).toContain('Example Title')
    })

    it('should generate citation tag without URL when invalid', () => {
      const citation: Citation = {
        number: 2,
        url: 'invalid-url',
        title: 'Test Title'
      }

      const result = generateCitationTag(citation)

      expect(result).toContain('[<sup data-citation=')
      expect(result).toContain('2</sup>]()')
      expect(result).not.toContain('](invalid-url)')
    })

    it('should handle citation without URL', () => {
      const citation: Citation = {
        number: 3,
        url: '',
        title: 'No URL Title'
      }

      const result = generateCitationTag(citation)

      expect(result).toContain('[<sup data-citation=')
      expect(result).toContain('3</sup>]()')
    })

    it('should use hostname when title is missing', () => {
      const citation: Citation = {
        number: 4,
        url: 'https://example.com',
        hostname: 'example.com'
      }

      const result = generateCitationTag(citation)

      expect(result).toContain('example.com')
    })

    it('should handle citation with all empty values', () => {
      const citation: Citation = {
        number: 6,
        url: '',
        title: '',
        hostname: '',
        content: ''
      }

      const result = generateCitationTag(citation)

      expect(result).toContain('[<sup data-citation=')
      expect(result).toContain('6</sup>]()')
    })

    it('should truncate content to 200 characters in data-citation', () => {
      const longContent = 'a'.repeat(300)
      const citation: Citation = {
        number: 1,
        url: 'https://example.com',
        title: 'Test',
        content: longContent
      }

      const result = generateCitationTag(citation)
      const match = result.match(/data-citation='([^']+)'/)
      expect(match).not.toBeNull()
      if (match) {
        const citationData = JSON.parse(match[1].replace(/&quot;/g, '"'))
        expect(citationData.content.length).toBe(200)
        expect(citationData.content).toBe(longContent.substring(0, 200))
      }
    })
  })

  describe('performance', () => {
    it('should handle large content efficiently', () => {
      const largeContent = 'Test content '.repeat(10000) + '[1]'
      const citations: Citation[] = [{ number: 1, url: 'https://example.com', title: 'Test' }]

      const start = Date.now()
      const result = withCitationTags(largeContent, citations)
      const end = Date.now()

      expect(result).toContain('[<sup data-citation=')
      expect(end - start).toBeLessThan(100) // Should complete within 100ms
    })

    it('should handle many citations efficiently', () => {
      const citations: Citation[] = Array.from({ length: 100 }, (_, i) => ({
        number: i + 1,
        url: `https://example${i + 1}.com`,
        title: `Test ${i + 1}`
      }))
      const content = citations.map((c) => `[${c.number}]`).join(' ')

      const start = Date.now()
      const result = withCitationTags(content, citations)
      const end = Date.now()

      expect(result).toContain('[<sup data-citation=')
      expect(end - start).toBeLessThan(100) // Should complete within 200ms
    })
  })
})
