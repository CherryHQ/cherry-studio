import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'

import { createChatMarkdownBlockParser, remarkCodeBlockTabs } from '../plugins/codeBlockTabs'

const first = '```typescript\nconst first = 1\n```'
const second = '~~~python\nprint(2)\n~~~'

describe('chat code-block grouping', () => {
  it('keeps adjacent fences together without merging surrounding prose or changing the source', () => {
    const source = `Before\n\n${first}\n\n${second}\n\nAfter`
    const blocks = createChatMarkdownBlockParser()(source)
    expect(blocks.join('')).toBe(source)
    expect(blocks.map((block) => block.trim())).toEqual(['Before', `${first}\n\n${second}`, 'After'])
  })

  it('retains a growing group through incomplete fences, completion, and source replacement', () => {
    const parse = createChatMarkdownBlockParser()
    for (const tail of ['```python\np', '```python\nprint(2)', '```python\nprint(2)\n```']) {
      const source = `${first}\n\n${tail}`
      expect(parse(source)).toEqual([source])
    }
    expect(parse(`${second}\n\n${first}`)).toEqual([`${second}\n\n${first}`])
    expect(parse(`${first}\n\ntext\n\n${second}`).map((block) => block.trim())).toEqual([first, 'text', second])
  })

  it.each([
    'Text',
    '# Heading',
    '![](https://example.com/a.png)',
    '<div>HTML</div>',
    '    indented',
    '```\n/tmp/test.ts\n```'
  ])('does not group across %s', (boundary) => {
    const blocks = createChatMarkdownBlockParser()(`${first}\n\n${boundary}\n\n${second}`)
    expect(blocks.some((block) => block.includes(first) && block.includes(second))).toBe(false)
  })

  it('does not mark indented code or generated HTML artifacts as eligible fences', () => {
    const source = `${first}\n\n    code\n\n<div>HTML</div>\n\n${second}`
    const processor = unified().use(remarkParse).use(remarkCodeBlockTabs)
    const file = { value: source, data: {} }
    processor.runSync(processor.parse(source), file)
    expect(file.data).toEqual({
      codeBlockTabLanguages: new Map([
        [0, 'typescript'],
        [source.indexOf(second), 'python']
      ])
    })
  })

  it('preserves nested containers and existing multiline LaTeX partitioning', () => {
    const quote = `${first}\n\n${second}`
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')
    const formula = '\\[\nx\n=\n\ny\n\\]'
    const source = `${quote}\n\n${formula}\n\n${first}`
    const blocks = createChatMarkdownBlockParser()(source)
    expect(blocks.join('')).toBe(source)
    expect(blocks.map((block) => block.trim())).toEqual([quote, formula, first])
  })
})
