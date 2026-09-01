import type { GroundingSupport } from '@google/genai'
import type { Citation } from '@renderer/types/message'
import { WEB_SEARCH_SOURCE } from '@renderer/types/webSearchProvider'
import { describe, expect, it, vi } from 'vitest'

import {
  determineCitationSource,
  generateCitationTag,
  isLinkableCitationUrl,
  mapCitationMarksToTags,
  normalizeCitationMarks,
  toTooltipCitation,
  withCitationTags
} from '../citation'
import { buildContent, groundingChunks, groundingSupports } from './fixtures/geminiCitation8880'

// Mock dependencies
vi.mock('@renderer/utils/formats', () => ({
  cleanMarkdownContent: vi.fn((content: string) => content.replace(/[*_~`]/g, ''))
}))

describe('citation', () => {
  const createCitationMap = (citations: Citation[]) => new Map(citations.map((c) => [c.number, c]))

  describe('determineCitationSource', () => {
    it('should find the the citation source', () => {
      const citationReferences = [{ citationBlockId: 'block1', citationBlockSource: WEB_SEARCH_SOURCE.OPENAI }]

      const result = determineCitationSource(citationReferences)
      expect(result).toBe(WEB_SEARCH_SOURCE.OPENAI)
    })

    it('should find first valid source in citation references', () => {
      const citationReferences = [
        { citationBlockId: 'block1' }, // no source
        { citationBlockId: 'block2', citationBlockSource: WEB_SEARCH_SOURCE.GEMINI },
        { citationBlockId: 'block3', citationBlockSource: WEB_SEARCH_SOURCE.GEMINI }
      ]

      const result = determineCitationSource(citationReferences)
      expect(result).toBe(WEB_SEARCH_SOURCE.GEMINI)
    })

    it('should return undefined when no sources available', () => {
      const citationReferences = [
        { citationBlockId: 'block1' }, // no source
        { citationBlockId: 'block2' } // no source
      ]

      const result = determineCitationSource(citationReferences)
      expect(result).toBeUndefined()
    })

    it('should return undefined for empty or missing citation references', () => {
      expect(determineCitationSource([])).toBeUndefined()
      expect(determineCitationSource(undefined)).toBeUndefined()
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

      const result = withCitationTags(content, citations, WEB_SEARCH_SOURCE.OPENAI)

      expect(result).toContain('[<sup data-citation=')
      expect(result).toContain('1</sup>](https://example.com)')
    })

    it('should process citations with Gemini source type', () => {
      const content = 'Test content from Gemini'
      const metadata: GroundingSupport[] = [
        {
          segment: { startIndex: 0, endIndex: 12, text: 'Test content' },
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

      const result = withCitationTags(content, citations, WEB_SEARCH_SOURCE.GEMINI)

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

        for (const sourceType of [WEB_SEARCH_SOURCE.OPENAI, WEB_SEARCH_SOURCE.OPENAI_RESPONSE]) {
          const result = normalizeCitationMarks(content, citationMap, sourceType)
          expect(result).toBe('Text with [cite:1] citation')
        }
      })

      it('should normalize AI SDK source-url citation links', () => {
        const content = 'Text with [<sup>1</sup>](https://example.com) citation'
        const citations: Citation[] = [{ number: 1, url: 'https://example.com', title: 'Test' }]
        const citationMap = createCitationMap(citations)

        const result = normalizeCitationMarks(content, citationMap, WEB_SEARCH_SOURCE.AISDK)

        expect(result).toBe('Text with [cite:1] citation')
      })

      it('should preserve non-matching OpenAI citations', () => {
        const content = 'Text with [<sup>3</sup>](https://missing.com) citation'
        const citations: Citation[] = [{ number: 1, url: 'https://example.com', title: 'Test' }]
        const citationMap = createCitationMap(citations)

        for (const sourceType of [WEB_SEARCH_SOURCE.OPENAI, WEB_SEARCH_SOURCE.OPENAI_RESPONSE]) {
          const result = normalizeCitationMarks(content, citationMap, sourceType)
          expect(result).toBe('Text with [<sup>3</sup>](https://missing.com) citation')
        }
      })

      it('should normalize plain bracket citations from OpenAI-compatible responses', () => {
        const content = 'Moonshot Kimi K2.6[4][9]'
        const citations: Citation[] = [
          { number: 4, url: 'https://example4.com', title: 'Test 4' },
          { number: 9, url: 'https://example9.com', title: 'Test 9' }
        ]
        const citationMap = createCitationMap(citations)

        for (const sourceType of [WEB_SEARCH_SOURCE.OPENAI, WEB_SEARCH_SOURCE.OPENAI_RESPONSE]) {
          const result = normalizeCitationMarks(content, citationMap, sourceType)
          expect(result).toBe('Moonshot Kimi K2.6[cite:4][cite:9]')
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

        const normalized = normalizeCitationMarks(content, citationMap, WEB_SEARCH_SOURCE.PERPLEXITY)
        expect(normalized).toBe('Perplexity citations [cite:1]')
      })

      it('should preserve unmatched Perplexity citations', () => {
        const content = 'Text with [<sup>2</sup>](https://notfound.com) citation'
        const citations: Citation[] = [{ number: 1, url: 'https://example.com', title: 'Example Citation' }]
        const citationMap = new Map(citations.map((c) => [c.number, c]))

        // 2号引用不存在，应该保持原样
        const normalized = normalizeCitationMarks(content, citationMap, WEB_SEARCH_SOURCE.PERPLEXITY)
        expect(normalized).toBe('Text with [<sup>2</sup>](https://notfound.com) citation')
      })
    })

    describe('Gemini format citations', () => {
      it('should normalize Gemini format citations', () => {
        const content = 'This is test content from Gemini'
        const metadata: GroundingSupport[] = [
          {
            segment: { startIndex: 8, endIndex: 20, text: 'test content' },
            groundingChunkIndices: [0, 1]
          }
        ]
        const citations: Citation[] = [
          { number: 1, url: 'https://example1.com', title: 'Test 1', metadata },
          { number: 2, url: 'https://example2.com', title: 'Test 2' }
        ]
        const citationMap = createCitationMap(citations)

        const result = normalizeCitationMarks(content, citationMap, WEB_SEARCH_SOURCE.GEMINI)

        expect(result).toBe('This is test content[cite:1][cite:2] from Gemini')
      })

      it('should not over-match short text segments like ** (issue #8880)', () => {
        // Gemini API can return groundingSupports with very short text like "**"
        // which previously caused all "**" in the content to get citation tags
        const content = '**二氧化硫（$SO_2$）不能燃烧。**\n\n1. **自身不可燃**：说明'
        const metadata: GroundingSupport[] = [
          {
            segment: { startIndex: 0, endIndex: 2, text: '**' },
            groundingChunkIndices: [0]
          }
        ]
        const citations: Citation[] = [{ number: 1, url: 'https://example.com', title: 'Test', metadata }]
        const citationMap = createCitationMap(citations)

        const result = normalizeCitationMarks(content, citationMap, WEB_SEARCH_SOURCE.GEMINI)

        // Only the position at endIndex=2 should get the citation tag
        expect(result).toBe('**[cite:1]二氧化硫（$SO_2$）不能燃烧。**\n\n1. **自身不可燃**：说明')
      })

      it('should correctly convert UTF-8 byte offsets to char offsets for CJK text', () => {
        // Gemini API endIndex is in UTF-8 bytes, not JS characters
        // Chinese chars are 3 bytes each in UTF-8 but 1 char in JS
        // "你好world" = 你(3) + 好(3) + w(1) + o(1) + r(1) + l(1) + d(1) = 11 bytes
        const content = '你好world end'
        const metadata: GroundingSupport[] = [
          {
            segment: { startIndex: 0, endIndex: 11, text: '你好world' },
            groundingChunkIndices: [0]
          }
        ]
        const citations: Citation[] = [{ number: 1, url: 'https://example.com', title: 'Test', metadata }]
        const citationMap = createCitationMap(citations)

        const result = normalizeCitationMarks(content, citationMap, WEB_SEARCH_SOURCE.GEMINI)

        // endIndex=11 bytes → char offset 7 ("你好world".length === 7)
        expect(result).toBe('你好world[cite:1] end')
      })

      it('should handle Gemini citations without metadata', () => {
        const content = 'Content without metadata'
        const citations: Citation[] = [{ number: 1, url: 'https://example.com', title: 'Test' }]
        const citationMap = createCitationMap(citations)

        const result = normalizeCitationMarks(content, citationMap, WEB_SEARCH_SOURCE.GEMINI)

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

        const result = normalizeCitationMarks(content, citationMap, WEB_SEARCH_SOURCE.OPENAI)

        expect(result).toBe('Text with [cite:1] and [cite:2] and other [3] formats')
      })
    })
  })

  describe('mapCitationMarksToTags', () => {
    const createCitationMap = (citations: Citation[]) => new Map(citations.map((c) => [String(c.number), c]))

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

    it('should drop non-matching cite marks instead of exposing the internal id', () => {
      const content = 'Text with [cite:1] and [cite:3] citations'
      const citations: Citation[] = [{ number: 1, url: 'https://example1.com', title: 'Test 1' }]
      const citationMap = createCitationMap(citations)

      const result = mapCitationMarksToTags(content, citationMap)

      expect(result).toContain('1</sup>](https://example1.com)')
      expect(result).toBe("Text with [<sup data-citation='1'>1</sup>](https://example1.com) and citations")
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

    it('drops an id-shaped mark it cannot resolve but leaves an empty bracket alone', () => {
      const content = 'Text with [cite:abc] and [cite:] marks'
      const citationMap = new Map()

      const result = mapCitationMarksToTags(content, citationMap)

      expect(result).toBe('Text with and [cite:] marks')
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

      expect(result).toContain("[<sup data-citation='1'>")
      expect(result).toContain('1</sup>](https://example.com)')
      expect(result).not.toContain('Example Title')
    })

    // A non-http URL is not linkable, so the marker must be a bare <sup>: an empty-href
    // markdown link gets unwrapped by rehype-harden into a "<span>", losing the tooltip.
    it('should emit a bare sup (no link wrapper) when the URL is invalid', () => {
      const citation: Citation = {
        number: 2,
        url: 'invalid-url',
        title: 'Test Title'
      }

      const result = generateCitationTag(citation)

      expect(result).toMatch(/^<sup data-citation=/)
      expect(result).toContain('2</sup>')
      expect(result).not.toContain('](')
      expect(result).not.toContain('()')
    })

    // Migrated v1 knowledge citations store a bare file path here. `CitationSup` mounts the
    // tooltip for exactly the citations this branch leaves unlinked, so both must agree.
    it('should emit a bare sup for a non-http URL that CitationSup can pick up', () => {
      const citation: Citation = {
        number: 7,
        url: '/Users/me/docs/notes.md',
        title: 'notes.md',
        type: 'knowledge'
      }

      expect(isLinkableCitationUrl(citation.url)).toBe(false)
      const result = generateCitationTag(citation)

      expect(result).toMatch(/^<sup data-citation=/)
      expect(result).toContain('7</sup>')
      expect(result).not.toContain('](')
    })

    it('should emit a bare sup when the citation has no URL', () => {
      const citation: Citation = {
        number: 3,
        url: '',
        title: 'No URL Title'
      }

      const result = generateCitationTag(citation)

      expect(result).toMatch(/^<sup data-citation=/)
      expect(result).toContain('3</sup>')
      expect(result).not.toContain('](')
    })

    it('should keep tooltip metadata out of the rendered marker', () => {
      const citation: Citation = {
        number: 4,
        url: 'https://example.com',
        hostname: 'example.com'
      }

      const result = generateCitationTag(citation)

      expect(result).toBe("[<sup data-citation='4'>4</sup>](https://example.com)")
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

      expect(result).toMatch(/^<sup data-citation=/)
      expect(result).toContain('6</sup>')
      expect(result).not.toContain('](')
    })

    it('should not serialize pipe characters from a title into markdown', () => {
      const citation: Citation = {
        number: 1,
        url: 'https://example.com',
        title: 'Foo | Bar | Baz'
      }

      const result = generateCitationTag(citation)

      expect(result).toBe("[<sup data-citation='1'>1</sup>](https://example.com)")
    })

    it('should escape pipe characters in URL to prevent GFM table cell breakage', () => {
      const citation: Citation = {
        number: 1,
        url: 'https://example.com/path?a=1|b=2',
        title: 'Test'
      }

      const result = generateCitationTag(citation)

      // The | in URL must be percent-encoded as %7C
      expect(result).toContain('%7C')
      expect(result).not.toMatch(/\]\(https:\/\/example\.com\/path\?a=1\|/)
    })

    it('should truncate trusted tooltip content to 200 characters out of band', () => {
      const longContent = 'a'.repeat(300)
      const citation: Citation = {
        number: 1,
        url: 'https://example.com',
        title: 'Test',
        content: longContent
      }

      const tooltipCitation = toTooltipCitation(citation)
      expect(tooltipCitation.content).toHaveLength(200)
      expect(tooltipCitation.content).toBe(longContent.substring(0, 200))
      expect(generateCitationTag(tooltipCitation)).not.toContain(longContent.substring(0, 20))
    })
  })

  describe('Gemini citation placement (issue #8880)', () => {
    const content = buildContent()
    const citations: Citation[] = groundingChunks.map((chunk, index) => ({
      number: index + 1,
      url: chunk.web?.uri || '',
      title: chunk.web?.title,
      showFavicon: true,
      metadata: groundingSupports
    }))
    const citationMap = new Map(citations.map((c) => [c.number, c]))

    it('normalizeCitationMarks should insert [cite:N] at correct positions', () => {
      const result = normalizeCitationMarks(content, citationMap, WEB_SEARCH_SOURCE.GEMINI)

      for (const support of groundingSupports) {
        const marks = support.groundingChunkIndices?.map((index) => `[cite:${index + 1}]`).join('') ?? ''
        expect(result).toContain(`${support.segment?.text}${marks}`)
      }

      // Verify no over-matching: count total [cite:N] occurrences
      const citeMatches = result.match(/\[cite:\d+\]/g) || []
      // 6 segments with 3+3+2+2+3+2 = 15 total chunk references
      expect(citeMatches).toHaveLength(15)
    })

    it('withCitationTags should produce correct final output', () => {
      const result = withCitationTags(content, citations, WEB_SEARCH_SOURCE.GEMINI)

      for (const support of groundingSupports) {
        const tags = support.groundingChunkIndices?.map((index) => generateCitationTag(citations[index])).join('') ?? ''
        expect(result).toContain(`${support.segment?.text}${tags}`)
      }

      // Verify each citation tag appears the expected number of times
      // Chunk 0 (citation 1) is referenced in 5 of 6 segments
      const sup1Matches = result.match(/data-citation='[^']*'>1<\/sup>/g) || []
      expect(sup1Matches).toHaveLength(5)
    })
  })
})
