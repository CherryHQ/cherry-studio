import { render } from '@testing-library/react'
import ReactMarkdown from 'react-markdown'
import { describe, expect, it } from 'vitest'

import remarkDisableConstructs from '../remarkDisableConstructs'

describe('disableIndentedCode', () => {
  const renderMarkdown = (markdown: string, constructs: string[] = ['codeIndented']) => {
    return render(<ReactMarkdown remarkPlugins={[remarkDisableConstructs(constructs)]}>{markdown}</ReactMarkdown>)
  }

  describe('normal path', () => {
    it('should disable indented code blocks while preserving other code types', () => {
      const markdown = `
# Test Document

Regular paragraph.

    This should be treated as a regular paragraph, not code

\`inline code\` should work

\`\`\`javascript
// This fenced code should work
console.log('hello')
\`\`\`

Another paragraph.
`

      const { container } = renderMarkdown(markdown)

      // Verify only fenced code (pre element)
      expect(container.querySelectorAll('pre')).toHaveLength(1)

      // Verify inline code
      const inlineCode = container.querySelector('code:not(pre code)')
      expect(inlineCode?.textContent).toBe('inline code')

      // Verify fenced code
      const fencedCode = container.querySelector('pre code')
      expect(fencedCode?.textContent).toContain('console.log')

      // Verify indented content becomes paragraph
      const paragraphs = container.querySelectorAll('p')
      const indentedParagraph = Array.from(paragraphs).find((p) =>
        p.textContent?.includes('This should be treated as a regular paragraph')
      )
      expect(indentedParagraph).toBeTruthy()
    })

    it('should handle indented code in nested structures', () => {
      const markdown = `
> Blockquote with \`inline code\`
> 
>     This indented code in blockquote should become text

1. List item
   
       This indented code in list should become text

* Bullet list
  * Nested item
  
        More indented code to convert
`

      const { container } = renderMarkdown(markdown)

      // Verify no indented code blocks
      expect(container.querySelectorAll('pre')).toHaveLength(0)

      // Verify blockquote exists and contains converted text
      const blockquote = container.querySelector('blockquote')
      expect(blockquote?.textContent).toContain('This indented code in blockquote should become text')

      // Verify lists exist
      const lists = container.querySelectorAll('ul, ol')
      expect(lists.length).toBeGreaterThan(0)
    })

    it('should preserve other markdown elements when disabling constructs', () => {
      const markdown = `
# Heading

Paragraph text.

    Indented code to disable

[Link text](https://example.com)

\`\`\`
Fenced code to keep
\`\`\`
`

      const { container } = renderMarkdown(markdown)

      // Verify heading
      expect(container.querySelector('h1')?.textContent).toBe('Heading')

      // Verify link
      const link = container.querySelector('a')
      expect(link?.textContent).toBe('Link text')
      expect(link?.getAttribute('href')).toBe('https://example.com')

      // Verify only fenced code
      expect(container.querySelectorAll('pre')).toHaveLength(1)
    })
  })

  describe('edge cases', () => {
    it('should not affect markdown when no constructs are disabled', () => {
      const markdown = `
    This is indented code

\`inline code\`

\`\`\`javascript
console.log('fenced')
\`\`\`
`

      const { container } = renderMarkdown(markdown, [])

      // Should have indented code and fenced code
      expect(container.querySelectorAll('pre')).toHaveLength(2)
    })

    it('should handle markdown with only inline and fenced code', () => {
      const markdown = `
Regular paragraph with \`inline code\`.

\`\`\`typescript
function test(): string {
  return "hello";
}
\`\`\`
`

      const { container } = renderMarkdown(markdown)

      // Should have only fenced code
      expect(container.querySelectorAll('pre')).toHaveLength(1)

      // Verify fenced code content
      const fencedCode = container.querySelector('pre code')
      expect(fencedCode?.textContent).toContain('function test()')

      // Verify inline code
      const inlineCode = container.querySelector('code:not(pre code)')
      expect(inlineCode?.textContent).toBe('inline code')
    })
  })
})
