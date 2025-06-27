// import remarkParse from 'remark-parse'
// import { unified } from 'unified'
// import { visit } from 'unist-util-visit'
import { describe, expect, it } from 'vitest'

import {
  convertMathFormula,
  findCitationInChildren,
  getCodeBlockId,
  getExtensionByLanguage,
  markdownToPlainText,
  processLatexBrackets,
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

  describe('getExtensionByLanguage', () => {
    // 批量测试语言名称到扩展名的映射
    const testLanguageExtensions = (testCases: Record<string, string>) => {
      for (const [language, expectedExtension] of Object.entries(testCases)) {
        const result = getExtensionByLanguage(language)
        expect(result).toBe(expectedExtension)
      }
    }

    it('should return extension for exact language name match', () => {
      testLanguageExtensions({
        '4D': '.4dm',
        'C#': '.cs',
        JavaScript: '.js',
        TypeScript: '.ts',
        'Objective-C++': '.mm',
        Python: '.py',
        SVG: '.svg',
        'Visual Basic .NET': '.vb'
      })
    })

    it('should return extension for case-insensitive language name match', () => {
      testLanguageExtensions({
        '4d': '.4dm',
        'c#': '.cs',
        javascript: '.js',
        typescript: '.ts',
        'objective-c++': '.mm',
        python: '.py',
        svg: '.svg',
        'visual basic .net': '.vb'
      })
    })

    it('should return extension for language aliases', () => {
      testLanguageExtensions({
        js: '.js',
        node: '.js',
        'obj-c++': '.mm',
        'objc++': '.mm',
        'objectivec++': '.mm',
        py: '.py',
        'visual basic': '.vb'
      })
    })

    it('should return fallback extension for unknown languages', () => {
      testLanguageExtensions({
        'unknown-language': '.unknown-language',
        custom: '.custom'
      })
    })

    it('should handle empty string input', () => {
      testLanguageExtensions({
        '': '.'
      })
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

  describe('processLatexBrackets', () => {
    describe('basic LaTeX conversion', () => {
      it('should convert (inline) display math \\[...\\] to $$...$$', () => {
        expect(processLatexBrackets('The formula is \\[a+b=c\\]')).toBe('The formula is $$a+b=c$$')
      })

      it('should convert display math \\[...\\] to $$...$$', () => {
        const input = `
The formula is

\\[
a+b=c
\\]
`
        const expected = `
The formula is

$$
a+b=c
$$
`
        expect(processLatexBrackets(input)).toBe(expected)
      })

      it('should convert inline math \\(...\\) to $...$', () => {
        expect(processLatexBrackets('The formula is \\(a+b=c\\)')).toBe('The formula is $a+b=c$')
      })

      it('should handle complex mathematical text with escaped brackets', () => {
        const input = `设 \\(A\\) 为 \\(n\\times n\\) 的实可逆矩阵，
\\[
B=\\begin{pmatrix} O & A \\\\[2pt] A' & O \\end{pmatrix}\\;(2n\\times 2n,\\;B=B'),
\\]
求 \\(B\\) 的正惯性指数 \\(p(B)\\) 和负惯性指数 \\(q(B)\\)。`

        const expected = `设 $A$ 为 $n\\times n$ 的实可逆矩阵，
$$
B=\\begin{pmatrix} O & A \\\\[2pt] A' & O \\end{pmatrix}\\;(2n\\times 2n,\\;B=B'),
$$
求 $B$ 的正惯性指数 $p(B)$ 和负惯性指数 $q(B)$。`

        expect(processLatexBrackets(input)).toBe(expected)
      })
    })

    describe('code block protection', () => {
      it('should not affect multi-line code blocks', () => {
        const input = 'Text ```const arr = \\[1, 2, 3\\]\\nconst func = \\(x\\) => x``` more text'
        expect(processLatexBrackets(input)).toBe(input)
      })

      it('should not affect inline code', () => {
        const input = 'This is text with `const x = \\[1, 2, 3\\]` inline code'
        expect(processLatexBrackets(input)).toBe(input)
      })

      it('should handle mixed code and LaTeX', () => {
        const input = 'Math: \\[x + y\\] and code: `arr = \\[1, 2\\]` and more math: \\(z\\)'
        const expected = 'Math: $$x + y$$ and code: `arr = \\[1, 2\\]` and more math: $z$'
        expect(processLatexBrackets(input)).toBe(expected)
      })

      it('should protect complex code blocks', () => {
        for (const [input, expected] of new Map([
          [
            '```javascript\\nconst latex = "\\\\[formula\\\\]"\\n```',
            '```javascript\\nconst latex = "\\\\[formula\\\\]"\\n```'
          ],
          ['`\\[escaped brackets\\]`', '`\\[escaped brackets\\]`'],
          [
            '```\\narray = \\[\\n  \\(item1\\),\\n  \\(item2\\)\\n\\]\\n```',
            '```\\narray = \\[\\n  \\(item1\\),\\n  \\(item2\\)\\n\\]\\n```'
          ]
        ])) {
          expect(processLatexBrackets(input)).toBe(expected)
        }
      })
    })

    describe('link protection', () => {
      it('should not affect LaTeX in link text', () => {
        const input = '[\\[pdf\\] Document](https://example.com/doc.pdf)'
        expect(processLatexBrackets(input)).toBe(input)
      })

      it('should not affect LaTeX in link URLs', () => {
        const input = '[Click here](https://example.com/path\\[with\\]brackets)'
        expect(processLatexBrackets(input)).toBe(input)
      })

      it('should handle mixed links and LaTeX', () => {
        const input = 'See [\\[pdf\\] file](url) for formula \\[x + y = z\\]'
        const expected = 'See [\\[pdf\\] file](url) for formula $$x + y = z$$'
        expect(processLatexBrackets(input)).toBe(expected)
      })

      it('should protect complex link patterns', () => {
        for (const [input, expected] of new Map([
          ['[Title with \\(math\\)](https://example.com)', '[Title with \\(math\\)](https://example.com)'],
          ['[Link](https://example.com/\\[path\\]/file)', '[Link](https://example.com/\\[path\\]/file)'],
          [
            '[\\[Section 1\\] Overview](url) and \\[math formula\\]',
            '[\\[Section 1\\] Overview](url) and $$math formula$$'
          ]
        ])) {
          expect(processLatexBrackets(input)).toBe(expected)
        }
      })
    })

    describe('edge cases', () => {
      it('should handle empty string', () => {
        expect(processLatexBrackets('')).toBe('')
      })

      it('should handle content without LaTeX', () => {
        for (const [input, expected] of new Map([
          ['Regular text without math', 'Regular text without math'],
          ['Text with [regular] brackets', 'Text with [regular] brackets'],
          ['Text with (parentheses)', 'Text with (parentheses)'],
          ['No special characters here', 'No special characters here']
        ])) {
          expect(processLatexBrackets(input)).toBe(expected)
        }
      })

      it('should handle malformed LaTeX patterns', () => {
        for (const [input, expected] of new Map([
          ['\\[unclosed bracket', '\\[unclosed bracket'],
          ['unopened bracket\\]', 'unopened bracket\\]'],
          ['\\(unclosed paren', '\\(unclosed paren'],
          ['unopened paren\\)', 'unopened paren\\)'],
          ['\\[\\]', '$$$$'], // Empty LaTeX block
          ['\\(\\)', '$$'] // Empty LaTeX inline
        ])) {
          expect(processLatexBrackets(input)).toBe(expected)
        }
      })

      it('should handle nested brackets', () => {
        for (const [input, expected] of new Map([
          ['\\[outer \\[inner\\] formula\\]', '$$outer \\[inner\\] formula$$'],
          ['\\(a + \\(b + c\\)\\)', '$a + \\(b + c\\)$']
        ])) {
          expect(processLatexBrackets(input)).toBe(expected)
        }
      })
    })

    describe('complex cases', () => {
      it('should handle complex mixed content', () => {
        const complexInput = `
# Mathematical Document

Here's a simple formula \\(E = mc^2\\) in text.

## Section 1: Equations

The quadratic formula is \\[x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\\].

- Item 1: See formula \\(\\alpha + \\beta = \\gamma\\) in this list
- Item 2: Check [\\[PDF\\] Complex Analysis](https://example.com/math.pdf)
  - Subitem 2.1: Basic concepts and definitions
  - Subitem 2.2: The Cauchy-Riemann equations \\[\\frac{\\partial u}{\\partial x} = \\frac{\\partial v}{\\partial y}, \\quad \\frac{\\partial u}{\\partial y} = -\\frac{\\partial v}{\\partial x}\\]
  - Subitem 2.3: Green's theorem connects line integrals and double integrals
  \\[
  \\oint_C (P dx + Q dy) = \\iint_D \\left(\\frac{\\partial Q}{\\partial x} - \\frac{\\partial P}{\\partial y}\\right) dx dy
  \\]
  - Subitem 2.4: Applications in engineering and physics
- Item 3: The sum \\[\\sum_{i=1}^{n} \\frac{1}{i^2} = \\frac{\\pi^2}{6}\\] is famous

\`\`\`javascript
// Code should not be affected
const matrix = \\[
  \\[1, 2\\],
  \\[3, 4\\]
\\];
const func = \\(x\\) => x * 2;
\`\`\`

Read more in [Section \\[3.2\\]: Advanced Topics](url) and see inline code \`\\[array\\]\`.

Final thoughts on \\(\\nabla \\cdot \\vec{F} = \\rho\\) in inline math and display math:

\\[\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}\\]

\\[
\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}
\\]
`

        const expectedOutput = `
# Mathematical Document

Here's a simple formula $E = mc^2$ in text.

## Section 1: Equations

The quadratic formula is $$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$.

- Item 1: See formula $\\alpha + \\beta = \\gamma$ in this list
- Item 2: Check [\\[PDF\\] Complex Analysis](https://example.com/math.pdf)
  - Subitem 2.1: Basic concepts and definitions
  - Subitem 2.2: The Cauchy-Riemann equations $$\\frac{\\partial u}{\\partial x} = \\frac{\\partial v}{\\partial y}, \\quad \\frac{\\partial u}{\\partial y} = -\\frac{\\partial v}{\\partial x}$$
  - Subitem 2.3: Green's theorem connects line integrals and double integrals
  $$
  \\oint_C (P dx + Q dy) = \\iint_D \\left(\\frac{\\partial Q}{\\partial x} - \\frac{\\partial P}{\\partial y}\\right) dx dy
  $$
  - Subitem 2.4: Applications in engineering and physics
- Item 3: The sum $$\\sum_{i=1}^{n} \\frac{1}{i^2} = \\frac{\\pi^2}{6}$$ is famous

\`\`\`javascript
// Code should not be affected
const matrix = \\[
  \\[1, 2\\],
  \\[3, 4\\]
\\];
const func = \\(x\\) => x * 2;
\`\`\`

Read more in [Section \\[3.2\\]: Advanced Topics](url) and see inline code \`\\[array\\]\`.

Final thoughts on $\\nabla \\cdot \\vec{F} = \\rho$ in inline math and display math:

$$\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}$$

$$
\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}
$$
`

        expect(processLatexBrackets(complexInput)).toBe(expectedOutput)
      })
    })
  })
})
