import { describe, expect, it } from 'vitest'

import { encodeHTML, extractHtmlTitle, getFileNameFromHtmlTitle, removeSvgEmptyLines } from '../formats'

describe('formats', () => {
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

  describe('extractHtmlTitle', () => {
    it('should extract title from HTML string', () => {
      const html = '<html><head><title>Page Title</title></head><body>Content</body></html>'
      expect(extractHtmlTitle(html)).toBe('Page Title')
    })

    it('should extract title with case insensitivity', () => {
      const html = '<html><head><TITLE>Page Title</TITLE></head><body>Content</body></html>'
      expect(extractHtmlTitle(html)).toBe('Page Title')
    })

    it('should handle HTML without title tag', () => {
      const html = '<html><head></head><body>Content</body></html>'
      expect(extractHtmlTitle(html)).toBe('')
    })

    it('should handle empty title tag', () => {
      const html = '<html><head><title></title></head><body>Content</body></html>'
      expect(extractHtmlTitle(html)).toBe('')
    })

    it('should handle malformed HTML', () => {
      const html = '<title>Partial HTML'
      expect(extractHtmlTitle(html)).toBe('Partial HTML')
    })

    it('should handle empty string', () => {
      expect(extractHtmlTitle('')).toBe('')
    })

    it('should handle undefined', () => {
      // @ts-ignore for testing
      expect(extractHtmlTitle(undefined)).toBe('')
    })
  })

  describe('getFileNameFromHtmlTitle', () => {
    it('should preserve Chinese characters', () => {
      expect(getFileNameFromHtmlTitle('中文标题')).toBe('中文标题')
      expect(getFileNameFromHtmlTitle('中文标题 测试')).toBe('中文标题-测试')
    })

    it('should preserve alphanumeric characters', () => {
      expect(getFileNameFromHtmlTitle('Hello123')).toBe('Hello123')
      expect(getFileNameFromHtmlTitle('Hello World 123')).toBe('Hello-World-123')
    })

    it('should remove special characters and replace spaces with hyphens', () => {
      expect(getFileNameFromHtmlTitle('File@Name#Test')).toBe('FileNameTest')
      expect(getFileNameFromHtmlTitle('File Name Test')).toBe('File-Name-Test')
    })

    it('should handle mixed languages', () => {
      expect(getFileNameFromHtmlTitle('中文English123')).toBe('中文English123')
      expect(getFileNameFromHtmlTitle('中文 English 123')).toBe('中文-English-123')
    })

    it('should handle empty string', () => {
      expect(getFileNameFromHtmlTitle('')).toBe('')
    })
  })

  describe('removeSvgEmptyLines', () => {
    it('should remove empty lines from within SVG tags', () => {
      const svg = '<svg>\n\n<circle></circle>\n\n<rect></rect>\n\n</svg>'
      const expected = '<svg>\n<circle></circle>\n<rect></rect>\n</svg>'
      expect(removeSvgEmptyLines(svg)).toBe(expected)
    })

    it('should handle SVG with only whitespace lines', () => {
      const svg = '<svg>\n  \n\t\n</svg>'
      const expected = '<svg>\n</svg>'
      expect(removeSvgEmptyLines(svg)).toBe(expected)
    })

    it('should handle multiple SVG tags', () => {
      const content = 'Text <svg>\n\n<circle></circle>\n\n</svg> More <svg>\n\n<rect></rect>\n\n</svg>'
      const expected = 'Text <svg>\n<circle></circle>\n</svg> More <svg>\n<rect></rect>\n</svg>'
      expect(removeSvgEmptyLines(content)).toBe(expected)
    })

    it('should not affect content outside SVG tags', () => {
      const content = 'Line 1\n\nLine 2\n\n<svg>\n<circle></circle>\n</svg>\n\nLine 3'
      expect(removeSvgEmptyLines(content)).toBe(content)
    })

    it('should handle multiline SVG with attributes', () => {
      const svg = '<svg width="100" height="100"\n\nviewBox="0 0 100 100">\n\n<circle></circle>\n\n</svg>'
      const expected = '<svg width="100" height="100"\nviewBox="0 0 100 100">\n<circle></circle>\n</svg>'
      expect(removeSvgEmptyLines(svg)).toBe(expected)
    })

    it('should handle string without SVG tags', () => {
      const content = 'Text without SVG'
      expect(removeSvgEmptyLines(content)).toBe(content)
    })
  })
})
