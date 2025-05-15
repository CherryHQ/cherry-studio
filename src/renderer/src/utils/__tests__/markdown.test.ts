import { describe, expect, it } from 'vitest'

import {
  convertMathFormula,
  findCitationInChildren,
  removeTrailingDoubleSpaces,
  markdownToPlainText
} from '../markdown'

describe('markdown', () => {
  describe('findCitationInChildren', () => {
    it('returns null when children is null or undefined', () => {
      expect(findCitationInChildren(null)).toBeNull()
      expect(findCitationInChildren(undefined)).toBeNull()
    })

    it('finds citation in direct child element', () => {
      const children = [{ props: { 'data-citation': 'test-citation' } }]
      expect(findCitationInChildren(children)).toBe('test-citation')
    })

    it('finds citation in nested child element', () => {
      const children = [
        {
          props: {
            children: [{ props: { 'data-citation': 'nested-citation' } }]
          }
        }
      ]
      expect(findCitationInChildren(children)).toBe('nested-citation')
    })

    it('returns null when no citation is found', () => {
      const children = [{ props: { foo: 'bar' } }, { props: { children: [{ props: { baz: 'qux' } }] } }]
      expect(findCitationInChildren(children)).toBeNull()
    })

    it('handles single child object (non-array)', () => {
      const child = { props: { 'data-citation': 'single-citation' } }
      expect(findCitationInChildren(child)).toBe('single-citation')
    })

    it('handles deeply nested structures', () => {
      const children = [
        {
          props: {
            children: [
              {
                props: {
                  children: [
                    {
                      props: {
                        children: {
                          props: { 'data-citation': 'deep-citation' }
                        }
                      }
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
      expect(findCitationInChildren(children)).toBe('deep-citation')
    })

    it('handles non-object children gracefully', () => {
      const children = ['text node', 123, { props: { 'data-citation': 'mixed-citation' } }]
      expect(findCitationInChildren(children)).toBe('mixed-citation')
    })
  })

  describe('convertMathFormula', () => {
    it('should convert LaTeX block delimiters to $$$$', () => {
      // 验证将 LaTeX 块分隔符转换为 $$$$
      const input = 'Some text \\[math formula\\] more text'
      const result = convertMathFormula(input)
      expect(result).toBe('Some text $$math formula$$ more text')
    })

    it('should convert LaTeX inline delimiters to $$', () => {
      // 验证将 LaTeX 内联分隔符转换为 $$
      const input = 'Some text \\(inline math\\) more text'
      const result = convertMathFormula(input)
      expect(result).toBe('Some text $inline math$ more text')
    })

    it('should handle multiple delimiters in input', () => {
      // 验证处理输入中的多个分隔符
      const input = 'Text \\[block1\\] and \\(inline\\) and \\[block2\\]'
      const result = convertMathFormula(input)
      expect(result).toBe('Text $$block1$$ and $inline$ and $$block2$$')
    })

    it('should return input unchanged if no delimiters', () => {
      // 验证没有分隔符时返回原始输入
      const input = 'Some text without math'
      const result = convertMathFormula(input)
      expect(result).toBe('Some text without math')
    })

    it('should return input if null or empty', () => {
      // 验证空输入或 null 输入时返回原值
      expect(convertMathFormula('')).toBe('')
      expect(convertMathFormula(null)).toBe(null)
    })
  })

  describe('removeTrailingDoubleSpaces', () => {
    it('should remove trailing double spaces from each line', () => {
      // 验证移除每行末尾的两个空格
      const input = 'Line one  \nLine two  \nLine three'
      const result = removeTrailingDoubleSpaces(input)
      expect(result).toBe('Line one\nLine two\nLine three')
    })

    it('should handle single line with trailing double spaces', () => {
      // 验证处理单行末尾的两个空格
      const input = 'Single line  '
      const result = removeTrailingDoubleSpaces(input)
      expect(result).toBe('Single line')
    })

    it('should return unchanged if no trailing double spaces', () => {
      // 验证没有末尾两个空格时返回原始输入
      const input = 'Line one\nLine two \nLine three'
      const result = removeTrailingDoubleSpaces(input)
      expect(result).toBe('Line one\nLine two \nLine three')
    })

    it('should handle empty string', () => {
      // 验证处理空字符串
      const input = ''
      const result = removeTrailingDoubleSpaces(input)
      expect(result).toBe('')
    })
  })

  describe('markdownToPlainText', () => {
    it('should return an empty string if input is null or empty', () => {
      expect(markdownToPlainText(null as any)).toBe('')
      expect(markdownToPlainText('')).toBe('')
    })

    it('should remove headers', () => {
      expect(markdownToPlainText('# Header 1')).toBe('Header 1')
      expect(markdownToPlainText('## Header 2')).toBe('Header 2')
      expect(markdownToPlainText('### Header 3')).toBe('Header 3')
    })

    it('should remove bold and italic', () => {
      expect(markdownToPlainText('**bold**')).toBe('bold')
      expect(markdownToPlainText('*italic*')).toBe('italic')
      expect(markdownToPlainText('***bolditalic***')).toBe('bolditalic')
      expect(markdownToPlainText('__bold__')).toBe('bold')
      expect(markdownToPlainText('_italic_')).toBe('italic')
      expect(markdownToPlainText('___bolditalic___')).toBe('bolditalic')
    })

    it('should remove strikethrough', () => {
      expect(markdownToPlainText('~~strikethrough~~')).toBe('strikethrough')
    })

    it('should remove links, keeping the text', () => {
      expect(markdownToPlainText('[link text](http://example.com)')).toBe('link text')
      expect(markdownToPlainText('[link text with title](http://example.com "title")')).toBe('link text with title')
    })

    it('should remove images, keeping the alt text', () => {
      expect(markdownToPlainText('![alt text](http://example.com/image.png)')).toBe('alt text')
    })

    it('should remove inline code', () => {
      expect(markdownToPlainText('`inline code`')).toBe('inline code')
    })

    it('should remove code blocks', () => {
      const codeBlock = '```javascript\nconst x = 1;\n```'
      expect(markdownToPlainText(codeBlock)).toBe('const x = 1;') // remove-markdown keeps code content
    })

    it('should remove blockquotes', () => {
      expect(markdownToPlainText('> blockquote')).toBe('blockquote')
    })

    it('should remove unordered lists', () => {
      const list = '* item 1\n* item 2'
      expect(markdownToPlainText(list).replace(/\n+/g, ' ')).toBe('item 1 item 2')
    })

    it('should remove ordered lists', () => {
      const list = '1. item 1\n2. item 2'
      expect(markdownToPlainText(list).replace(/\n+/g, ' ')).toBe('item 1 item 2')
    })

    it('should remove horizontal rules', () => {
      expect(markdownToPlainText('---')).toBe('')
      expect(markdownToPlainText('***')).toBe('')
      expect(markdownToPlainText('___')).toBe('')
    })

    it('should handle a mix of markdown elements', () => {
      const mixed = '# Title\nSome **bold** and *italic* text.\n[link](url)\n`code`\n> quote\n* list item'
      const expected = 'Title\nSome bold and italic text.\nlink\ncode\nquote\nlist item'
      const normalize = (str: string) => str.replace(/\s+/g, ' ').trim()
      expect(normalize(markdownToPlainText(mixed))).toBe(normalize(expected))
    })

    it('should keep plain text unchanged', () => {
      expect(markdownToPlainText('This is plain text.')).toBe('This is plain text.')
    })
  })
})
