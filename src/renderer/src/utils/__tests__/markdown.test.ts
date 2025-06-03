// import remarkParse from 'remark-parse'
// import { unified } from 'unified'
// import { visit } from 'unist-util-visit'
import { describe, expect, it } from 'vitest'

import {
  convertMathFormula,
  findCitationInChildren,
  getCodeBlockId,
  removeTrailingDoubleSpaces,
  updateCodeBlock
} from '../markdown'

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

  describe('getCodeBlockId', () => {
    it('should generate ID from position information', () => {
      // 从位置信息生成ID
      const start = { line: 10, column: 5, offset: 123 }
      const result = getCodeBlockId(start)
      expect(result).toBe('10:5:123')
    })

    it('should handle zero position values', () => {
      // 处理零值位置
      const start = { line: 1, column: 0, offset: 0 }
      const result = getCodeBlockId(start)
      expect(result).toBe('1:0:0')
    })

    it('should return null for null or undefined input', () => {
      // 处理null或undefined输入
      expect(getCodeBlockId(null)).toBeNull()
      expect(getCodeBlockId(undefined)).toBeNull()
    })

    it('should handle missing properties in position object', () => {
      // 处理缺少属性的位置对象
      const invalidStart = { line: 5 }
      const result = getCodeBlockId(invalidStart)
      expect(result).toBe('5:undefined:undefined')
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

    //   visit(tree, 'code', (node) => {
    //     const id = getCodeBlockId(node.position?.start)
    //     if (id) {
    //       result[node.value] = id
    //       console.log(`Code Block ID: "${id}" for content: "${node.value}" lang: "${node.lang}"`)
    //     }
    //   })

    //   return result
    // }

    it('should format content using remark-stringify', () => {
      const markdown = '# Test\n```js\nvar x = 1;\n```'
      const expectedResult = '# Test\n\n```js\nvar x = 1;\n```\n'

      const actualId = '2:1:7'
      const newContent = 'var x = 1;'

      // getAllCodeBlockIds(markdown)

      const result = updateCodeBlock(markdown, actualId, newContent)

      expect(result).toBe(expectedResult)
    })

    it('should update code block content when ID matches', () => {
      const markdown = '# Test\n```js\nvar x = 1;\n```\nOther content'
      const expectedResult = '# Test\n\n```js\nconst x = 2;\n```\n\nOther content\n'

      const actualId = '2:1:7'
      const newContent = 'const x = 2;'

      // getAllCodeBlockIds(markdown)

      const result = updateCodeBlock(markdown, actualId, newContent)

      expect(result).toBe(expectedResult)
    })

    it('should not modify content when code block ID does not match', () => {
      const markdown = '# Test\n```js\nvar x = 1;\n```\nOther content'
      const wrongId = 'non-existent-id'
      const newContent = 'const x = 2;'

      const result = updateCodeBlock(markdown, wrongId, newContent)

      expect(result).toContain('var x = 1;')
      expect(result).not.toContain(newContent)
    })

    it('should preserve code block language tag', () => {
      const markdown = '# Title\n\n```python\nprint("Hello")\n```\n'
      const expectedResult = '# Title\n\n```python\nprint("Updated")\n```\n'

      const pythonBlockId = '3:1:9'
      const newContent = 'print("Updated")'

      // getAllCodeBlockIds(markdown)

      const result = updateCodeBlock(markdown, pythonBlockId, newContent)

      expect(result).toBe(expectedResult)
    })

    it('should only update the code block with matching ID when multiple blocks exist', () => {
      const markdown = '```js\nvar x = 1;\n```\n\n```py\nprint("test")\n```'
      const expectedResult = '```js\nconst y = 2;\n```\n\n```py\nprint("test")\n```\n'

      const firstBlockId = '1:1:0'
      const newContent = 'const y = 2;'

      // getAllCodeBlockIds(markdown)

      const result = updateCodeBlock(markdown, firstBlockId, newContent)

      expect(result).toBe(expectedResult)
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

    it('should handle code blocks with special characters', () => {
      const markdown = '```js\nconst special = "\\n\\t\\"\\u{1F600}";\n```'
      const expectedResult = '```js\nconst updated = true;\n```\n'

      const blockId = '1:1:0'
      const newContent = 'const updated = true;'

      // getAllCodeBlockIds(markdown)

      const result = updateCodeBlock(markdown, blockId, newContent)

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
})
