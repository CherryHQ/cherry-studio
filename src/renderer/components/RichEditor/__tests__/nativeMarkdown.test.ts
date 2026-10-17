import type { JSONContent } from '@tiptap/core'
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createRichEditorExtensions } from '../createExtensions'
import { findElementByLine } from '../helpers/jumpToLine'

// Build a real editor from the SAME extension factory production uses, so the test schema can never
// silently drift from production (the drift that previously let GFM-table serialization break).
let editor: Editor | undefined

const make = (content: string): Editor => {
  editor?.destroy()
  editor = new Editor({
    element: document.createElement('div'),
    extensions: createRichEditorExtensions(),
    content,
    contentType: 'markdown'
  })
  return editor
}

/** Parse markdown -> doc and return the top-level node JSON. */
const parse = (content: string): JSONContent[] => make(content).getJSON().content ?? []
/** Round-trip markdown -> doc -> markdown. */
const roundTrip = (content: string): string => make(content).getMarkdown().trim()

const copySelectionAsPlainText = (instance: Editor): string => {
  const clipboard = new Map<string, string>()
  const clipboardData = {
    clearData: () => clipboard.clear(),
    setData: (type: string, value: string) => {
      clipboard.set(type, value)
    }
  } as unknown as DataTransfer
  const event = new Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', { value: clipboardData })

  instance.view.dom.dispatchEvent(event)

  return clipboard.get('text/plain') ?? ''
}

afterEach(() => {
  editor?.destroy()
  editor = undefined
})

describe('native markdown round-trip matrix', () => {
  it('parses headings 1-6 and round-trips them', () => {
    for (let level = 1; level <= 6; level++) {
      const src = `${'#'.repeat(level)} Heading ${level}`
      const top = parse(src)[0]
      expect(top?.type).toBe('heading')
      expect(top?.attrs?.level).toBe(level)
      expect(roundTrip(src)).toBe(src)
    }
  })

  it('round-trips inline marks: bold, italic, strike, inline code', () => {
    const out = roundTrip('Some **bold**, *italic*, ~~strike~~ and `code` text.')
    expect(out).toContain('**bold**')
    expect(out).toContain('*italic*')
    expect(out).toContain('~~strike~~')
    expect(out).toContain('`code`')
  })

  it('round-trips the underline mark', () => {
    // Underline has no CommonMark spelling; @tiptap/markdown uses the Pandoc `++text++` form.
    const e = make('hello')
    e.commands.selectAll()
    e.commands.toggleUnderline()
    const serialized = e.getMarkdown()
    expect(serialized).toContain('++hello++')

    // ...and it must parse back to an underline mark, not literal text.
    const top = parse(serialized)[0]
    const underlined = top?.content?.find((n) => n.marks?.some((m) => m.type === 'underline'))
    expect(underlined?.text).toBe('hello')
  })

  it('round-trips links, including a titled link', () => {
    expect(roundTrip('[text](https://example.com)')).toContain('[text](https://example.com)')
    const titled = roundTrip('[text](https://example.com "Title")')
    expect(titled).toContain('[text](https://example.com')
    expect(titled).toContain('Title')
  })

  it('round-trips images', () => {
    const top = parse('![alt](https://example.com/i.png)')[0]
    const img = top?.type === 'image' ? top : top?.content?.find((n) => n.type === 'image')
    expect(img?.type).toBe('image')
    expect(roundTrip('![alt](https://example.com/i.png)')).toContain('![alt](https://example.com/i.png)')
  })

  it('parses and round-trips blockquotes', () => {
    expect(parse('> quoted')[0]?.type).toBe('blockquote')
    expect(roundTrip('> quoted')).toContain('> quoted')
  })

  it('parses a thematic break into a horizontalRule', () => {
    const top = parse('before\n\n***\n\nafter')
    expect(top.some((n) => n.type === 'horizontalRule')).toBe(true)
    expect(roundTrip('before\n\n***\n\nafter')).toContain('---')
  })

  it('round-trips bullet, ordered and nested lists', () => {
    expect(parse('- a\n- b')[0]?.type).toBe('bulletList')
    expect(parse('1. a\n2. b')[0]?.type).toBe('orderedList')

    const bullets = roundTrip('- a\n- b')
    expect(bullets).toContain('- a')
    expect(bullets).toContain('- b')

    const ordered = roundTrip('1. a\n2. b')
    expect(ordered).toContain('1. a')
    expect(ordered).toContain('2. b')

    const nested = roundTrip('- a\n  - b')
    expect(nested).toContain('- a')
    expect(nested).toContain('- b')
  })

  it('parses and round-trips task lists', () => {
    expect(parse('- [ ] todo\n- [x] done')[0]?.type).toBe('taskList')
    const out = roundTrip('- [ ] todo\n- [x] done')
    expect(out).toContain('[ ] todo')
    expect(out).toContain('[x] done')
  })

  it('round-trips fenced code with language and ~~~ fences', () => {
    const top = parse('```js\nconst a = 1\n```')[0]
    expect(top?.type).toBe('codeBlock')
    expect(top?.attrs?.language).toBe('js')

    const withLang = roundTrip('```js\nconst a = 1\n```')
    expect(withLang).toContain('```js')
    expect(withLang).toContain('const a = 1')

    expect(parse('~~~\nplain\n~~~')[0]?.type).toBe('codeBlock')
    expect(roundTrip('~~~\nplain\n~~~')).toContain('plain')
  })

  it('round-trips inline and block math', () => {
    expect(roundTrip('Inline $a + b$ math')).toContain('$a + b$')

    const block = make('$$\nx = y\n$$')
    expect(block.getJSON().content?.some((n) => n.type === 'blockMath')).toBe(true)
    expect(block.getMarkdown()).toContain('$$')
    expect(block.getMarkdown()).toContain('x = y')
  })

  it('round-trips GFM tables (regression: table-plus has no native markdown hooks)', () => {
    const src = '| a | b |\n| --- | --- |\n| 1 | 2 |'
    expect(parse(src)[0]?.type).toBe('table')

    const out = roundTrip(src)
    expect(out).toContain('| a | b |')
    expect(out).toContain('| --- | --- |')
    expect(out).toContain('| 1 | 2 |')
  })

  it('parses and round-trips YAML front matter', () => {
    const src = '---\ntitle: Hi\n---\n\nBody text'
    const top = parse(src)[0]
    expect(top?.type).toBe('yamlFrontMatter')
    expect(top?.attrs?.content).toContain('title: Hi')

    const out = roundTrip(src)
    expect(out).toContain('title: Hi')
    expect(out).toContain('Body text')
  })

  it('round-trips hard line breaks', () => {
    const top = parse('line1  \nline2')[0]
    expect(top?.content?.some((n) => n.type === 'hardBreak')).toBe(true)
  })

  it('keeps single line breaks as soft breaks inside paragraph text nodes', () => {
    // Single \n stays in the text node (rendered via white-space in production), so the
    // "line break mode" display toggle can switch it on without touching the file content.
    const top = parse('line1\nline2')[0]
    expect(top?.type).toBe('paragraph')
    const text = top?.content?.find((n) => n.type === 'text') as JSONContent
    expect(text?.text).toContain('\n')
    expect(roundTrip('line1\nline2')).toBe('line1\nline2')
  })

  it('serializes an empty document to an empty string', () => {
    expect(roundTrip('')).toBe('')
  })
})

describe('plain-text clipboard serialization', () => {
  it('copies inline and multiline block math as parseable LaTeX', () => {
    const e = make('')
    e.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Inline ' },
            { type: 'inlineMath', attrs: { latex: 'a + b' } },
            { type: 'text', text: ' math' }
          ]
        },
        { type: 'blockMath', attrs: { latex: 'x = y\ny = z' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'After' }] }
      ]
    })
    e.commands.selectAll()

    expect(copySelectionAsPlainText(e)).toBe('Inline $a + b$ math\n\n$$\nx = y\ny = z\n$$\n\nAfter')
  })

  it('does not copy delimiters for math nodes without LaTeX', () => {
    const e = make('')

    e.commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'inlineMath', attrs: { latex: '' } }] }]
    })
    e.commands.selectAll()
    const inlineText = copySelectionAsPlainText(e)
    expect(inlineText).not.toContain('$')
    expect(inlineText.trim()).toBe('')

    e.commands.setContent({
      type: 'doc',
      content: [{ type: 'blockMath', attrs: { latex: '' } }]
    })
    e.commands.selectAll()
    const blockText = copySelectionAsPlainText(e)
    expect(blockText).not.toContain('$')
    expect(blockText.trim()).toBe('')
  })
})

describe('jump-to-line resolver', () => {
  it('resolves a heading by its source line', () => {
    const instance = make('First paragraph\n\n## Second paragraph\n\nThird paragraph')
    expect(findElementByLine(instance, 3, '## Second paragraph')).toBe(instance.view.dom.children[1])
  })

  it('disambiguates duplicate text by the line position', () => {
    const instance = make('intro\n\nrepeat\n\nmiddle\n\nrepeat\n\nend')
    expect(findElementByLine(instance, 7, 'repeat')).toBe(instance.view.dom.children[3])
    expect(findElementByLine(instance, 3, 'repeat')).toBe(instance.view.dom.children[1])
  })

  it('locates a block by line number without a content hint', () => {
    const instance = make('a\n\nb\n\nc\n\nd')
    expect(findElementByLine(instance, 3)).toBe(instance.view.dom.children[1])
  })
})

describe('source block navigation', () => {
  const suffix = '\n\n```text\n' + Array.from({ length: 24 }, (_, index) => String(index)).join('\n') + '\n```'

  it.each([
    { block: '| 标题 |\n| --- |\n| 唯一目标 |', hit: '| 唯一目标 |', nodeType: 'table' },
    { block: '| 标题 |\n| --- |\n| 唯一目标 |', hit: '| 标题 |', nodeType: 'table' },
    { block: '| 标题 |\n| --- |\n| 唯一目标 |', hit: '| --- |', nodeType: 'table' },
    { block: '| A | B |\n| --- | --- |\n| `a\\|b` | **目标** |', hit: '| `a\\|b` | **目标** |', nodeType: 'table' },
    { block: '```text\n**原文**\n| 非表格 |\n```', hit: '**原文**', nodeType: 'codeBlock' },
    { block: '> - 第一项\n>   - **嵌套目标**', hit: '>   - **嵌套目标**', nodeType: 'blockquote' },
    {
      block: '<span><strong>注意：</strong>目标 &amp; **原文**</span>',
      hit: '<span><strong>注意：</strong>目标 &amp; **原文**</span>',
      nodeType: 'paragraph'
    }
  ])('locates $hit in its $nodeType block', ({ block, hit, nodeType }) => {
    const source = `前言\n\n${block}${suffix}`
    const instance = make(source)
    const lines = source.split('\n')
    const lineNumber = lines.indexOf(hit) + 1
    const targetNode = instance.state.doc.child(1)
    expect(targetNode.type.name).toBe(nodeType)
    const targetDom = instance.view.nodeDOM(instance.state.doc.child(0).nodeSize)
    expect(findElementByLine(instance, lineNumber, hit)).toBe(targetDom)
    expect(findElementByLine(instance, lineNumber)).toBe(targetDom)
  })

  it('distinguishes identical lines in a paragraph and a code block by source position', () => {
    const source = '重复目标\n\n```text\n重复目标\n```' + suffix
    const instance = make(source)
    expect(findElementByLine(instance, 4, '重复目标')).toBe(instance.view.nodeDOM(instance.state.doc.child(0).nodeSize))
  })
})
