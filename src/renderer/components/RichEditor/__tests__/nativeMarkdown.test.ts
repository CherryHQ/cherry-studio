import type { JSONContent } from '@tiptap/core'
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createRichEditorExtensions } from '../createExtensions'
import { findElementByLine, normalizeMarkdownLine } from '../helpers/jumpToLine'

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

  it('serializes an empty document to an empty string', () => {
    expect(roundTrip('')).toBe('')
  })
})

describe('jump-to-line resolver', () => {
  it('strips markdown markers when normalizing a source line', () => {
    expect(normalizeMarkdownLine('## A heading')).toBe('A heading')
    expect(normalizeMarkdownLine('> a quote')).toBe('a quote')
    expect(normalizeMarkdownLine('- [ ] a task')).toBe('a task')
    expect(normalizeMarkdownLine('1. an item')).toBe('an item')
    expect(normalizeMarkdownLine('text with **bold** and `code`')).toBe('text with bold and code')
    expect(normalizeMarkdownLine('see [the docs](https://x.com)')).toBe('see the docs')
  })

  const buildDom = (blocks: string[]): HTMLElement => {
    const root = document.createElement('div')
    for (const text of blocks) {
      const p = document.createElement('p')
      p.textContent = text
      root.appendChild(p)
    }
    return root
  }

  it('resolves a block by content match against the normalized source line', () => {
    const dom = buildDom(['First paragraph', 'Second paragraph', 'Third paragraph'])
    const el = findElementByLine(dom, 2, '## Second paragraph', 3)
    expect(el?.textContent).toBe('Second paragraph')
  })

  it('disambiguates duplicate text by the line position', () => {
    const dom = buildDom(['intro', 'repeat', 'middle', 'repeat', 'end']) // "repeat" at index 1 and 3
    // Line 8/10 -> estimated index floor(0.7 * 5) = 3 -> the second "repeat".
    expect(findElementByLine(dom, 8, 'repeat', 10)).toBe(dom.children[3])
    // Line 2/10 -> estimated index 0 -> nearest match is the first "repeat".
    expect(findElementByLine(dom, 2, 'repeat', 10)).toBe(dom.children[1])
  })

  it('falls back to a proportional block when no content matches', () => {
    const dom = buildDom(['a', 'b', 'c', 'd'])
    // line 10 of 20 -> ratio 0.45 -> block index floor(0.45 * 4) = 1
    const el = findElementByLine(dom, 10, '| --- | --- |', 20)
    expect(el?.textContent).toBe('b')
  })

  it('returns null when the editor has no blocks', () => {
    expect(findElementByLine(document.createElement('div'), 1, 'x', 10)).toBeNull()
  })
})
