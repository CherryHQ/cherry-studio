import { describe, expect, it } from 'vitest'

import {
  convertMathFormula,
  findCitationInChildren,
  isHtmlCode,
  markdownToPlainText,
  purifyMarkdownImages,
  removeTrailingDoubleSpaces,
  updateCodeBlock
} from '../markdown'

describe('markdown', () => {
  describe('findCitationInChildren', () => {
    it('returns an empty string when no citation is present', () => {
      expect(findCitationInChildren(null)).toBe('')
      expect(findCitationInChildren(undefined)).toBe('')
      expect(
        findCitationInChildren([{ props: { foo: 'bar' } }, { props: { children: [{ props: { baz: 'qux' } }] } }])
      ).toBe('')
    })

    it('finds citation in direct child element', () => {
      const children = [{ props: { 'data-citation': 'test-citation' } }]
      expect(findCitationInChildren(children)).toBe('test-citation')
    })

    it('handles single child object (non-array)', () => {
      const child = { props: { 'data-citation': 'single-citation' } }
      expect(findCitationInChildren(child)).toBe('single-citation')
    })

    it('handles deeply nested structures', () => {
      const children = [
        'text node',
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
  })

  describe('convertMathFormula', () => {
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
      const input = 'Line one  \nLine two \nLine three'
      const result = removeTrailingDoubleSpaces(input)
      expect(result).toBe('Line one\nLine two \nLine three')
    })

    it('should return unchanged if no trailing double spaces', () => {
      // 验证没有末尾两个空格时返回原始输入
      const input = 'Line one\nLine two \nLine three'
      const result = removeTrailingDoubleSpaces(input)
      expect(result).toBe('Line one\nLine two \nLine three')
    })
  })

  describe('updateCodeBlock', () => {
    /**
     * 辅助函数：用户获取代码块的实际 ID
     *
     * 使用方法：
     * 1. 修改测试用例，调用该函数
     * 2. 运行测试并查看控制台输出中的代码块 ID
     * 3. 用输出的 ID 替换测试中的硬编码 ID
     * 4. 再次注释掉对此函数的调用
     */
    // function getAllCodeBlockIds(markdown: string): { [content: string]: string } {
    //   const result: { [content: string]: string } = {}
    //   const tree = unified().use(remarkParse).parse(markdown)
    //
    //   visit(tree, 'code', (node) => {
    //     const id = getCodeBlockId(node.position?.start)
    //     if (id) {
    //       result[node.value] = id
    //       console.log(`Code Block ID: "${id}" for content: "${node.value}" lang: "${node.lang}"`)
    //     }
    //   })
    //
    //   return result
    // }

    it('should not modify content when code block ID does not match', () => {
      const markdown = '# Test\n```js\nvar x = 1;\n```\nOther content'
      const wrongId = 'non-existent-id'
      const newContent = 'const x = 2;'

      const result = updateCodeBlock(markdown, wrongId, newContent)

      expect(result).toContain('var x = 1;')
      expect(result).not.toContain(newContent)
    })

    it('should only update the second of two identical code blocks', () => {
      // 创建包含两个相同内容代码块的Markdown，文本和代码块交替出现
      const markdown =
        '# Heading\n\nFirst paragraph.\n\n```js\nconst value = 100;\n```\n\nMiddle paragraph with some text.\n\n```js\nconst value = 100;\n```\n\nFinal text paragraph.'

      const expectedResult =
        '# Heading\n\nFirst paragraph.\n\n```js\nconst value = 100;\n```\n\nMiddle paragraph with some text.\n\n```js\nconst updatedValue = 200;\n```\n\nFinal text paragraph.\n'

      const secondBlockId = '11:1:93'
      const newContent = 'const updatedValue = 200;'

      // getAllCodeBlockIds(markdown)

      const result = updateCodeBlock(markdown, secondBlockId, newContent)

      expect(result).toBe(expectedResult)
    })

    it('should handle empty code blocks', () => {
      const markdown = '```js\n\n```'
      const expectedResult = '```js\nconsole.log("no longer empty");\n```\n'

      const blockId = '1:1:0'
      const newContent = 'console.log("no longer empty");'

      // getAllCodeBlockIds(markdown)

      const result = updateCodeBlock(markdown, blockId, newContent)

      expect(result).toBe(expectedResult)
    })

    it('should handle code blocks with indentation', () => {
      const markdown = '  ```js\n  const indented = true;\n  ```'
      const expectedResult = '```js\nconst noLongerIndented = true;\n```\n'

      const blockId = '1:3:2'
      const newContent = 'const noLongerIndented = true;'

      // getAllCodeBlockIds(markdown)

      const result = updateCodeBlock(markdown, blockId, newContent)

      expect(result).toBe(expectedResult)
    })
  })

  describe('markdownToPlainText', () => {
    it('should return an empty string if input is null or empty', () => {
      expect(markdownToPlainText(null as any)).toBe('')
      expect(markdownToPlainText('')).toBe('')
    })

    it('should remove code blocks', () => {
      const codeBlock = '```javascript\nconst x = 1;\n```'
      expect(markdownToPlainText(codeBlock)).toBe('const x = 1;') // remove-markdown keeps code content
    })

    it('should handle a mix of markdown elements', () => {
      const mixed = '# Title\nSome **bold** and *italic* text.\n[link](url)\n`code`\n> quote\n* list item'
      const expected = 'Title\nSome bold and italic text.\nlink\ncode\nquote\nlist item'
      const normalize = (str: string) => str.replace(/\s+/g, ' ').trim()
      expect(normalize(markdownToPlainText(mixed))).toBe(normalize(expected))
    })
  })

  describe('isHtmlCode', () => {
    it('should detect HTML with DOCTYPE', () => {
      expect(isHtmlCode('<!DOCTYPE html>')).toBe(true)
      expect(isHtmlCode('<!doctype html>')).toBe(true)
    })

    it('should detect HTML with valid tags', () => {
      expect(isHtmlCode('<html>')).toBe(true)
      expect(isHtmlCode('</html>')).toBe(true)
      expect(isHtmlCode('<head>')).toBe(true)
      expect(isHtmlCode('<body>')).toBe(true)
      expect(isHtmlCode('<div>')).toBe(true)
    })

    it('should detect complete HTML structure', () => {
      const html = '<html><head><title>Test</title></head><body>Hello</body></html>'
      expect(isHtmlCode(html)).toBe(true)
    })

    it('should return false for non-HTML content', () => {
      expect(isHtmlCode(null)).toBe(false)
      expect(isHtmlCode('')).toBe(false)
      expect(isHtmlCode('Hello world')).toBe(false)
      expect(isHtmlCode('a < b')).toBe(false)
    })
  })

  describe('purifyMarkdownImages', () => {
    it('should replace base64 image with placeholder', () => {
      const input = '![cat](data:image/png;base64,iVBORw0KGgo)'
      const expected = '![cat](image_url)'
      expect(purifyMarkdownImages(input)).toBe(expected)
    })

    it('should handle multiple base64 images', () => {
      const input = `
      ![dog](data:image/jpeg;base64,ABC123)
      Some text
      ![avatar](data:image/png;base64,XYZ789)
    `
      const expected = `
      ![dog](image_url)
      Some text
      ![avatar](image_url)
    `
      expect(purifyMarkdownImages(input)).toBe(expected)
    })

    it('should ignore normal image links', () => {
      const input = '![cat](https://example.com/cat.png)'
      expect(purifyMarkdownImages(input)).toBe(input)
    })

    it('should handle whitespace in base64 url', () => {
      const input = '![logo](  data:image/svg+xml;base64,CONTENT  )'
      const expected = '![logo](image_url)'
      expect(purifyMarkdownImages(input)).toBe(expected)
    })

    it('should preserve alt text', () => {
      const input = '![User Avatar](data:image/png;base64,xxx)'
      const expected = '![User Avatar](image_url)'
      expect(purifyMarkdownImages(input)).toBe(expected)
    })

    it('should handle uppercase data URL', () => {
      const input = '![test](DATA:IMAGE/PNG;BASE64,ABC)'
      const expected = '![test](image_url)'
      expect(purifyMarkdownImages(input)).toBe(expected)
    })

    it('should not modify text that is not image', () => {
      const input = 'This is a data:image/png;base64,iVBORw line of text'
      expect(purifyMarkdownImages(input)).toBe(input)
    })

    it('should handle mixed content', () => {
      const input = `
      Regular: ![cat](https://example.com/cat.png)
      Base64: ![dog](data:image/jpeg;base64,BASE64DATA)
      Another: ![bird](https://example.com/bird.gif)
      Inline: ![icon](  data:image/x-icon;base64,ICONDATA  )
    `
      const expected = `
      Regular: ![cat](https://example.com/cat.png)
      Base64: ![dog](image_url)
      Another: ![bird](https://example.com/bird.gif)
      Inline: ![icon](image_url)
    `
      expect(purifyMarkdownImages(input)).toBe(expected)
    })
  })
})
