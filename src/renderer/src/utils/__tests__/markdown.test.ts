import { describe, expect, it } from 'vitest'

import { convertMathFormula, encodeHTML, findCitationInChildren, removeTrailingDoubleSpaces } from '../markdown'

describe('markdown', () => {
  describe('findCitationInChildren', () => {
    it('returns null when children is null or undefined', () => {
      expect(findCitationInChildren(null)).toBe('')
      expect(findCitationInChildren(undefined)).toBe('')
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
      expect(findCitationInChildren(children)).toBe('')
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
      // @ts-expect-error purposely pass wrong type to test error branch
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

  describe('encodeHTML', () => {
    it('should encode all special HTML characters', () => {
      const input = `Tom & Jerry's "cat" <dog>`
      const result = encodeHTML(input)
      expect(result).toBe('Tom &amp; Jerry&apos;s &quot;cat&quot; &lt;dog&gt;')
    })

    it('should return the same string if no special characters', () => {
      const input = 'Hello World!'
      const result = encodeHTML(input)
      expect(result).toBe('Hello World!')
    })

    it('should return empty string if input is empty', () => {
      const input = ''
      const result = encodeHTML(input)
      expect(result).toBe('')
    })

    it('should encode single special character', () => {
      expect(encodeHTML('&')).toBe('&amp;')
      expect(encodeHTML('<')).toBe('&lt;')
      expect(encodeHTML('>')).toBe('&gt;')
      expect(encodeHTML('"')).toBe('&quot;')
      expect(encodeHTML("'")).toBe('&apos;')
    })

    it('should throw if input is not a string', () => {
      // @ts-expect-error purposely pass wrong type to test error branch
      expect(() => encodeHTML(null)).toThrow()
      // @ts-expect-error purposely pass wrong type to test error branch
      expect(() => encodeHTML(undefined)).toThrow()
    })
  })
})
