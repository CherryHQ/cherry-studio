import { describe, expect, it } from 'vitest'

import {
  convertLatexMathToDollars,
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

  describe('convertLatexMathToDollars', () => {
    it('converts formulas and preserves inline and fenced code', () => {
      const input = 'Euler \\(e\\) and `r"\\(\\d+\\)"`\n\n```bash\nif \\[ -f x \\]; then :; fi\n```\n\n\\[ a^2 \\]'

      expect(convertLatexMathToDollars(input)).toBe(
        'Euler $e$ and `r"\\(\\d+\\)"`\n\n```bash\nif \\[ -f x \\]; then :; fi\n```\n\n$$ a^2 $$'
      )
    })

    it('converts prose between code blocks when the first block contains a literal fence', () => {
      const input = '```python\nprint("```")\n```\n\nFormula: \\(x\\)\n\n```python\nre.match(r"\\(\\d+\\)", s)\n```'

      expect(convertLatexMathToDollars(input)).toBe(
        '```python\nprint("```")\n```\n\nFormula: $x$\n\n```python\nre.match(r"\\(\\d+\\)", s)\n```'
      )
    })

    it('preserves a fence that starts on the list marker line', () => {
      const input = '- ```js\n  test(/\\(a\\)/)\n  ```\n\nFormula: \\(x\\)'

      expect(convertLatexMathToDollars(input)).toBe('- ```js\n  test(/\\(a\\)/)\n  ```\n\nFormula: $x$')
    })

    it('preserves tilde fences, longer fences wrapping shorter ones, and indented code', () => {
      expect(convertLatexMathToDollars('~~~js\n\\(a\\)\n~~~\n\n\\(x\\)')).toBe('~~~js\n\\(a\\)\n~~~\n\n$x$')
      expect(convertLatexMathToDollars('````md\n```js\n\\(a\\)\n```\n````\n\n\\(x\\)')).toBe(
        '````md\n```js\n\\(a\\)\n```\n````\n\n$x$'
      )
      expect(convertLatexMathToDollars('Text\n\n    \\(a\\)\n\n\\(x\\)')).toBe('Text\n\n    \\(a\\)\n\n$x$')
    })

    it('preserves inline code delimited by more than one backtick', () => {
      expect(convertLatexMathToDollars('``a ` \\(b\\)`` and \\(x\\)')).toBe('``a ` \\(b\\)`` and $x$')
    })

    it('converts a display formula whose delimiters own their lines, keeping its indentation', () => {
      expect(convertLatexMathToDollars('Sum:\n\n  \\[\n  a + b\n  \\]\n\nDone')).toBe(
        'Sum:\n\n  $$\n  a + b\n  $$\n\nDone'
      )
    })

    it('converts several formulas on one line', () => {
      expect(convertLatexMathToDollars('Text \\[block1\\] and \\(inline\\) and \\[block2\\]')).toBe(
        'Text $$block1$$ and $inline$ and $$block2$$'
      )
    })

    it('keeps LaTeX line-break spacing and escaped backslashes that only look like delimiters', () => {
      expect(convertLatexMathToDollars('\\[\na \\\\[2pt]\nb\n\\]')).toBe('$$\na \\\\[2pt]\nb\n$$')
      expect(convertLatexMathToDollars('path C:\\\\(x) and \\(y\\)')).toBe('path C:\\\\(x) and $y$')
    })

    it('leaves an unclosed delimiter alone instead of emitting an unbalanced dollar fence', () => {
      expect(convertLatexMathToDollars('an escaped \\[ bracket, then \\(x\\) math')).toBe(
        'an escaped \\[ bracket, then $x$ math'
      )
    })

    it('leaves link text alone, where the chat renders the formula as plain text', () => {
      expect(convertLatexMathToDollars('[\\(x\\)](https://example.com) and \\(y\\)')).toBe(
        '[\\(x\\)](https://example.com) and $y$'
      )
    })

    it('returns content without delimiters unchanged', () => {
      expect(convertLatexMathToDollars('')).toBe('')
      expect(convertLatexMathToDollars('plain `code` and $x$')).toBe('plain `code` and $x$')
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
    it('updates the edited block and leaves every other byte untouched', () => {
      const markdown =
        'Intro $a_b$ and [cite:abc_1].\n\n```js\nconst a = 1\n```\n\n- [ ] todo\n\n```js\nconst b = 2\n```\n\nOutro __bold__.'

      const result = updateCodeBlock(markdown, 'const b = 2', 'const b = 3')

      expect(result).toBe(
        'Intro $a_b$ and [cite:abc_1].\n\n```js\nconst a = 1\n```\n\n- [ ] todo\n\n```js\nconst b = 3\n```\n\nOutro __bold__.'
      )
    })

    it('matches the rendered code text, which carries one trailing newline', () => {
      const result = updateCodeBlock('```js\nconst a = 1\n```', 'const a = 1\n', 'const a = 2')

      expect(result).toBe('```js\nconst a = 2\n```')
    })

    it('matches an SVG block whose blank lines were removed for rendering', () => {
      const markdown = '```svg\n<svg>\n\n<rect />\n\n</svg>\n```'

      const result = updateCodeBlock(markdown, '<svg>\n<rect />\n</svg>', '<svg></svg>')

      expect(result).toBe('```svg\n<svg></svg>\n```')
    })

    it('returns null when the original content matches no code block', () => {
      expect(updateCodeBlock('# Test\n\n```js\nvar x = 1;\n```', 'var y = 1;', 'const y = 2;')).toBeNull()
    })

    it('returns null when identical code blocks make the target ambiguous', () => {
      const markdown = '```js\nconst value = 100;\n```\n\nMiddle.\n\n```js\nconst value = 100;\n```'

      expect(updateCodeBlock(markdown, 'const value = 100;', 'const value = 200;')).toBeNull()
    })

    it('fills an empty code block', () => {
      expect(updateCodeBlock('```js\n\n```', '', 'console.log("no longer empty");')).toBe(
        '```js\nconsole.log("no longer empty");\n```'
      )
    })

    it('keeps the indentation of a block nested in a list', () => {
      const markdown = '1. Install:\n\n   ```bash\n   npm i\n   ```\n\n2. Done'

      const result = updateCodeBlock(markdown, 'npm i', 'pnpm i\n\npnpm dev')

      expect(result).toBe('1. Install:\n\n   ```bash\n   pnpm i\n\n   pnpm dev\n   ```\n\n2. Done')
    })

    it('lengthens the fence when the new content contains a fence', () => {
      const result = updateCodeBlock('```md\nold\n```', 'old', '```js\nnested\n```')

      expect(result).toBe('````md\n```js\nnested\n```\n````')
    })

    it('writes replacement patterns in the new content literally', () => {
      const result = updateCodeBlock('```sh\necho hi\n```', 'echo hi', "echo $$ '$&' $1")

      expect(result).toBe("```sh\necho $$ '$&' $1\n```")
    })

    it('updates an unfenced HTML document that is rendered as a code block', () => {
      const html = '<!DOCTYPE html>\n<html>\n<body>\n\n<h1>Hi</h1>\n\n</body>\n</html>'
      const updated = html.replace('Hi', 'Hello')

      const result = updateCodeBlock(`Here is the page:\n\n${html}\n\nDone $a_b$.`, `${html}\n`, updated)

      expect(result).toBe(`Here is the page:\n\n${updated}\n\nDone $a_b$.`)
    })

    it('returns null when the original content only appears in prose', () => {
      expect(updateCodeBlock('Run npm i once.\n\n```sh\nnpm  i\n```', 'npm i', 'pnpm i')).toBeNull()
    })

    it('still updates a block nested in a blockquote', () => {
      const result = updateCodeBlock('> ```js\n> const a = 1\n> ```', 'const a = 1', 'const a = 2')

      expect(result).toBe('> ```js\n> const a = 2\n> ```\n')
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
