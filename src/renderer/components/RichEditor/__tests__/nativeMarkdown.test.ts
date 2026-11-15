import { createRequire } from 'node:module'

import type { JSONContent } from '@tiptap/core'
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRichEditorExtensions } from '../createExtensions'
import { findElementByLine } from '../helpers/jumpToLine'

// Resolve the parser already owned by @tiptap/markdown without adding a dependency.
const require = createRequire(import.meta.url)
const { Marked } = require(require.resolve('marked', { paths: [require.resolve('@tiptap/markdown')] }))

const isolatedMarked = () => {
  const instance = new Marked()
  // MarkdownManager constructs Lexer directly; bind it to this instance's registrations.
  instance.Lexer = class extends instance.Lexer {
    constructor() {
      super(instance.defaults)
    }
  }
  return instance
}

// Build a real editor from the SAME extension factory production uses, so the test schema can never
// silently drift from production (the drift that previously let GFM-table serialization break).
let editor: Editor | undefined

const make = (content: string): Editor => {
  editor?.destroy()
  editor = new Editor({
    element: document.createElement('div'),
    extensions: createRichEditorExtensions().map((extension) =>
      extension.name === 'markdown' ? extension.configure({ marked: isolatedMarked() }) : extension
    ),
    content,
    contentType: 'markdown'
  })
  editor.state.doc.check()
  return editor
}

const asNode = (node: JSONContent | undefined): JSONContent => node ?? {}

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

describe('backslash math markdown contract', () => {
  const math = (e: Editor) => {
    const nodes: JSONContent[] = []
    e.state.doc.descendants((node) => {
      if (node.type.name === 'inlineMath' || node.type.name === 'blockMath') nodes.push(node.toJSON())
    })
    e.state.doc.check()
    return nodes
  }

  it.each([
    [String.raw`\[a\]`, 'a'],
    [String.raw`\(a\)`, 'a'],
    [String.raw`\[ f[x] \]`, 'f[x]'],
    [String.raw`\[ a \[b\] c \]`, 'a b c'],
    [String.raw`\( a \(b\) c \)`, 'a b c'],
    [String.raw`\[\tag{1}a\]`, String.raw`\tag{1}a`]
  ])('loads %s inside one paragraph', (source, latex) => {
    const e = make(source)
    expect(e.getJSON().content?.[0]?.type).toBe('paragraph')
    expect(math(e).map((n) => [n.type, n.attrs?.latex])).toEqual([['inlineMath', latex]])
    expect(e.getMarkdown()).toBe(source)
  })

  it('does not reuse block pairs for a different lazy blockquote continuation', () => {
    const e = make('> \\[\n> a\n> \\]\nlazy text\n> \\[\n> bbbb')
    expect(math(e).map((node) => [node.type, node.attrs?.latex])).toEqual([['blockMath', 'a']])
    expect(e.state.doc.textContent).toContain('bbbb')
    expect(e.state.doc.lastChild?.type.name).toBe('blockquote')
  })

  it('rejects an escaped block opener before a lazy blockquote continuation', () => {
    const e = make('> \\[\n> a\n> \\]\n> \\\\[\n> b\n> \\]\nlazy text\n> \\[\n> b\n> \\]')
    expect(math(e).map((node) => [node.type, node.attrs?.latex])).toEqual([
      ['blockMath', 'a'],
      ['blockMath', 'b']
    ])
    expect(math(e).at(-1)?.attrs?.latex).toBe('b')
  })

  const sequence = (nodes: JSONContent[]): unknown[] =>
    nodes.map((node) => [node.type, node.text ?? node.attrs?.latex ?? sequence(node.content ?? [])])

  it.each([
    ['x\\[\na\n\\]', [['paragraph', [['text', 'x[\na\n]']]]], 'x\\[\na\n]'],
    [
      '$$a$$\\[\nb\n\\]',
      [
        ['blockMath', 'a'],
        ['paragraph', [['text', '[\nb\n]']]]
      ],
      '$$\na\n$$\n\n\\[\nb\n]'
    ],
    ['\\\\[\na\n\\]', [['paragraph', [['text', '\\[\na\n]']]]], '\\\\\\[\na\n]']
  ])('rejects block openers outside a real line start: %s', (source, expected, saved) => {
    const instance = make(source)
    const nodes = sequence(instance.getJSON().content ?? [])
    const markdown = instance.getMarkdown()
    process.stdout.write(`line-start rejection: ${JSON.stringify({ source, nodes, saved: markdown })}\n`)
    expect(nodes).toEqual(expected)
    // The dollar prefix is a block itself; the rejected backslash candidate must add none.
    expect(math(instance).filter((node) => node.type === 'blockMath')).toHaveLength(source.startsWith('$$') ? 1 : 0)
    expect(markdown).toBe(saved)
  })

  it.each([
    ['- [ ] task\n  foo\n$$a$$\\[\nb\n\\]', ['a']],
    ['- [ ] task\n  123456789012345\n\\[\nb\n\\]', ['b']]
  ])('uses trustworthy line context after task-list nesting: %s', (source, expected) => {
    expect(math(make(source)).map((n) => n.attrs?.latex)).toEqual(expected)
  })

  it('shares lexer wrapping across editor registrations and unwinds on exceptions', () => {
    const source = '\\[\na\n\\]\\[\nb\n\\]'
    const instances: Editor[] = []
    try {
      for (let i = 0; i < 2; i++) {
        const e = new Editor({
          element: document.createElement('div'),
          extensions: createRichEditorExtensions(),
          content: source,
          contentType: 'markdown'
        })
        instances.push(e)
        expect(sequence(e.getJSON().content ?? [])).toEqual([
          ['blockMath', 'a'],
          ['paragraph', [['text', '[\nb\n]']]]
        ])
      }
      const tokenize = instances[0].extensionManager.extensions.find((e) => e.name === 'backslashBlockMath')!.config
        .markdownTokenizer!.tokenize
      const lexer = {
        blockTokens: (_source: string) => {
          void _source
          throw new Error('tokenizer failure')
        }
      }
      const helper = { lexer } as never
      tokenize('plain', [], helper)
      const wrapper = lexer.blockTokens
      expect(() => lexer.blockTokens('\\[\nb\n\\]')).toThrow('tokenizer failure')
      expect(tokenize('\\[\nb\n\\]', [{ raw: 'same line' }] as never, helper)).toBeUndefined()
      const second = instances[1].extensionManager.extensions.find((e) => e.name === 'backslashBlockMath')!.config
        .markdownTokenizer!.tokenize
      second('plain', [], helper)
      expect(lexer.blockTokens).toBe(wrapper)
    } finally {
      instances.forEach((e) => e.destroy())
    }
  })

  it.each([String.raw`[a] [x\]y](url)`, '[a] `\\]`', '[a] ``\\]``'])(
    'keeps lexical boundaries through two reloads: %s',
    (source) => {
      const initial = make(source)
      const expected = initial.getJSON()
      let saved = initial.getMarkdown()
      for (let i = 0; i < 2; i++) {
        const loaded = make(saved)
        expect(math(loaded)).toEqual([])
        expect(loaded.getJSON()).toEqual(expected)
        expect(loaded.getMarkdown()).toBe(saved)
        saved = loaded.getMarkdown()
      }
    }
  )

  it('records upstream blank-line loss when an ordered-list formula reloads as text', () => {
    const initial = make('1. before\n\n  \\[\n  a\n  \\]')
    expect(sequence(initial.getJSON().content ?? [])).toEqual([
      [
        'orderedList',
        [
          [
            'listItem',
            [
              ['paragraph', [['text', 'before']]],
              ['blockMath', 'a']
            ]
          ]
        ]
      ]
    ])
    const firstSave = initial.getMarkdown()
    expect(firstSave).toBe('1. before\n  \\[\n  a\n  \\]')

    const reloaded = make(firstSave)
    expect(sequence(reloaded.getJSON().content ?? [])).toEqual([
      ['orderedList', [['listItem', [['paragraph', [['text', 'before\n[\na\n]']]]]]]]
    ])
    const secondSave = reloaded.getMarkdown()
    // Upstream drops the blank line, so reloading degrades the formula to plain text.
    expect(secondSave).toBe('1. before\n\\[\na\n]')
    const third = make(secondSave)
    expect(third.state.doc.textContent).toBe('before\n[\na\n]')
    expect(third.getMarkdown()).toBe(secondSave)
    process.stdout.write(
      `ordered-list saves: ${JSON.stringify({ firstSave, secondSave, thirdSave: third.getMarkdown() })}\n`
    )
  })

  it.each([
    ['plain [a] text', 'plain \\[a] text', 'plain [a] text'],
    ['[1]', '\\[1]', '[1]'],
    ['[x][id]', '\\[x]\\[id]', '[x][id]'],
    [String.raw`[x\]y](url)`, String.raw`[x\]y](url)`, 'x]y']
  ])('preserves single-line brackets through repeated saves: %s', (source, expectedSave, text) => {
    const initial = make(source)
    expect(math(initial)).toEqual([])
    expect(initial.state.doc.textContent).toBe(text)
    const saved = initial.getMarkdown()
    expect(saved).toBe(expectedSave)
    const reloaded = make(saved)
    expect(math(reloaded)).toEqual([])
    expect(reloaded.state.doc.textContent).toBe(text)
    expect(reloaded.getMarkdown()).toBe(saved)
    process.stdout.write(
      `single-line brackets: ${JSON.stringify({ source, nodes: sequence(reloaded.getJSON().content ?? []), saved })}\n`
    )
  })

  // A reused token array must not hide a new call whose source collides with an earlier suffix.
  it.each([
    ['> a\\[\n> b\n> \\]\n\\[\nb\n\\]', 1],
    ['> > a\\[\n> > b\n> > \\]\n> \\[\n> b\n> \\]', 2]
  ])('recognizes suffix collisions across blockTokens calls: %s', (source, depth) => {
    let expected: unknown[] = [
      ['paragraph', [['text', 'a[\nb\n]']]],
      ['blockMath', 'b']
    ]
    for (let i = 0; i < Number(depth); i++) expected = [['blockquote', expected]]
    const initial = make(String(source))
    expect(sequence(initial.getJSON().content ?? [])).toEqual(expected)
    const saved = initial.getMarkdown()
    const reloaded = make(saved)
    expect(sequence(reloaded.getJSON().content ?? [])).toEqual(expected)
    expect(reloaded.getMarkdown()).toBe(saved)
    expect(make(saved).getMarkdown()).toBe(saved)
    process.stdout.write(`suffix collision: ${JSON.stringify({ source, nodes: expected, saved })}\n`)
  })

  // Escaping plain closing brackets would turn these texts into inline or block formulas on reload.
  it.each([
    ['array[0]\nand[1]', 'array\\[0]\nand\\[1]'],
    ['[\na\n]', '\\[\na\n]']
  ])('keeps multiline plain brackets as text: %s', (source, saved) => {
    const expected = [['paragraph', [['text', source]]]]
    const initial = make(source)
    expect(sequence(initial.getJSON().content ?? [])).toEqual(expected)
    expect(initial.getMarkdown()).toBe(saved)
    const reloaded = make(saved)
    expect(sequence(reloaded.getJSON().content ?? [])).toEqual(expected)
    expect(reloaded.state.doc.textContent).toBe(source)
    expect(reloaded.getMarkdown()).toBe(saved)
    expect(make(saved).getMarkdown()).toBe(saved)
    process.stdout.write(`multiline brackets: ${JSON.stringify({ source, nodes: expected, saved })}\n`)
  })

  it.each([0, 1, 2, 3])('accepts a line-start block with %i spaces', (indent) => {
    expect(sequence(parse(`${' '.repeat(indent)}\\[\na\n\\]`))).toEqual([['blockMath', 'a']])
  })

  it.each([
    [
      'lazy quote',
      '> before\n\\[\nb\n\\]',
      [
        [
          'blockquote',
          [
            ['paragraph', [['text', 'before']]],
            ['blockMath', 'b']
          ]
        ]
      ],
      '> before\n>\n> \\[\n> b\n> \\]'
    ],
    [
      'lazy list',
      '- before\n  \\[\n  a\n  \\]',
      [
        [
          'bulletList',
          [
            [
              'listItem',
              [
                ['paragraph', [['text', 'before']]],
                ['blockMath', 'a']
              ]
            ]
          ]
        ]
      ],
      '- before\n  \\[\n  a\n  \\]'
    ],
    ['document start', '\\[\na\n\\]', [['blockMath', 'a']], '\\[\na\n\\]'],
    [
      'paragraph',
      'para\n\\[\na\n\\]',
      [
        ['paragraph', [['text', 'para']]],
        ['blockMath', 'a']
      ],
      'para\n\n\\[\na\n\\]'
    ],
    [
      'heading',
      '# h\n\\[\na\n\\]',
      [
        ['heading', [['text', 'h']]],
        ['blockMath', 'a']
      ],
      '# h\n\n\\[\na\n\\]'
    ],
    ['quote', '> \\[\n> a\n> \\]', [['blockquote', [['blockMath', 'a']]]], '> \\[\n> a\n> \\]'],
    [
      'dollar block',
      '$$\na\n$$\n\\[\nb\n\\]',
      [
        ['blockMath', 'a'],
        ['blockMath', 'b']
      ],
      '$$\na\n$$\n\n\\[\nb\n\\]'
    ],
    [
      'fenced code',
      '```\ncode\n```\n\\[\nb\n\\]',
      [
        ['codeBlock', [['text', 'code']]],
        ['blockMath', 'b']
      ],
      '```\ncode\n```\n\n\\[\nb\n\\]'
    ],
    [
      'thematic break',
      '---\n\\[\nb\n\\]',
      [
        ['horizontalRule', []],
        ['blockMath', 'b']
      ],
      '---\n\n\\[\nb\n\\]'
    ],
    [
      'unindented list continuation',
      '- item\n\\[\nb\n\\]',
      [
        [
          'bulletList',
          [
            [
              'listItem',
              [
                ['paragraph', [['text', 'item']]],
                ['blockMath', 'b']
              ]
            ]
          ]
        ]
      ],
      '- item\n  \\[\n  b\n  \\]'
    ],
    [
      'nested quote',
      '> > \\[\n> > a\n> > \\]',
      [['blockquote', [['blockquote', [['blockMath', 'a']]]]]],
      '> > \\[\n> > a\n> > \\]'
    ]
  ])('preserves line-start block structure and delimiters after %s', (name, source, expected, expectedSaved) => {
    const instance = make(source)
    const nodes = sequence(instance.getJSON().content ?? [])
    const saved = instance.getMarkdown()
    process.stdout.write(`line-start round trip: ${JSON.stringify({ name, source, nodes, saved })}\n`)
    expect(nodes).toEqual(expected)
    expect(saved).toBe(expectedSaved)
    const reloaded = make(saved)
    const reloadedNodes = sequence(reloaded.getJSON().content ?? [])
    expect(reloadedNodes).toEqual(expected)
    expect(reloaded.getMarkdown()).toBe(saved)
    process.stdout.write(
      `line-start reload: ${JSON.stringify({ name, nodes: reloadedNodes, saved: reloaded.getMarkdown(), check: 'passed' })}\n`
    )
  })

  it.each([
    [
      '- $a$\n$$\nb\n$$\nc',
      [
        ['paragraph', [['inlineMath', 'a']]],
        ['blockMath', 'b'],
        ['text', 'c']
      ]
    ],
    [
      '- $$\nb\n$$\nc',
      [
        ['blockMath', 'b'],
        ['text', 'c']
      ]
    ]
  ])('reproduces the upstream listItem defect with dollar blocks: %s', (source, children) => {
    const instance = make('')
    const doc = instance.schema.nodeFromJSON(instance.markdown!.parse(source))
    expect(sequence(doc.toJSON().content ?? [])).toEqual([['bulletList', [['listItem', children]]]])
    // 该缺陷在美元块公式上同样复现，属上游 listItem markdown 解析，与本 PR 的 `\[` 语法无关。
    expect(() => doc.check()).toThrow('Invalid content for node listItem')
  })

  // 块定界符在行首时优先于跨行美元行内公式；列表、引用、跨候选代码也遵循同一契约。
  it.each([
    [
      '$a\n\\[\nb\n\\]\nc$',
      [
        ['paragraph', [['text', '$a']]],
        ['blockMath', 'b'],
        ['paragraph', [['text', 'c$']]]
      ]
    ],
    [
      '- $a\n  \\[\n  b\n  \\]\n  c$',
      [
        [
          'bulletList',
          [
            [
              'listItem',
              [
                ['paragraph', [['text', '$a']]],
                ['blockMath', 'b'],
                ['text', 'c$']
              ]
            ]
          ]
        ]
      ]
    ],
    [
      '> $a\n> \\[\n> b\n> \\]\n> c$',
      [
        [
          'blockquote',
          [
            ['paragraph', [['text', '$a']]],
            ['blockMath', 'b'],
            ['paragraph', [['text', 'c$']]]
          ]
        ]
      ]
    ],
    [
      '`text $x\n\\[\na\n\\]\ny$`',
      [
        ['paragraph', [['text', '`text $x']]],
        ['blockMath', 'a'],
        ['paragraph', [['text', 'y$`']]]
      ]
    ]
  ])('prioritizes line-start block delimiters: %s', (source, expected) => {
    const instance = make('')
    const doc = instance.schema.nodeFromJSON(instance.markdown!.parse(source))
    expect(sequence(doc.toJSON().content ?? [])).toEqual(expected)
    if (source.startsWith('- ')) {
      // 上游紧凑列表解析会把块后的文本直接放进 listItem，仍属已知结构限制。
      expect(() => doc.check()).toThrow('Invalid content for node listItem')
    } else {
      doc.check()
    }
  })

  it.each(['`$literal`', '``$literal`text``', '`$literal``text`'])('skips dollars inside code spans: %s', (code) => {
    const source = `${code}\n\\[\na\n\\]\n$after`
    const instance = make(source)
    expect(sequence(instance.getJSON().content ?? [])).toEqual([
      ['paragraph', [['text', code.slice(code.startsWith('``') ? 2 : 1, code.startsWith('``') ? -2 : -1)]]],
      ['blockMath', 'a'],
      ['paragraph', [['text', '$after']]]
    ])
    expect(instance.getJSON().content?.[0]?.content?.[0]?.marks).toEqual([{ type: 'code' }])
    if (code === '`$literal`') {
      expect(instance.getMarkdown()).toBe('`$literal`\n\n\\[\na\n\\]\n\n$after')
    }
    expect(instance.getMarkdown()).toContain('\\[\na\n\\]')
    process.stdout.write(
      `code span: ${JSON.stringify({ nodes: sequence(instance.getJSON().content ?? []), saved: instance.getMarkdown(), marks: instance.getJSON().content?.[0]?.content?.[0]?.marks })}\n`
    )
  })

  it.each([
    ['para\n\\[\na\n\\]\npara', 'parapara'],
    ['Price $5\n\\[\na\n\\]', 'Price $5'],
    ['Price \\$5\n\\[\na\n\\]\nend$', 'Price $5end$'],
    ['$old$\n\npara\n\\[\na\n\\]\nend$', 'paraend$']
  ])('keeps an independent block candidate in %s', (source, text) => {
    const e = make(source)
    expect(
      math(e)
        .filter((node) => node.type === 'blockMath')
        .map((node) => node.attrs?.latex)
    ).toEqual(['a'])
    expect(e.state.doc.textContent).toContain(text)
    process.stdout.write(
      `block candidate regression: ${JSON.stringify({ source, nodes: math(e).map((node) => [node.type, node.attrs?.latex]), text: e.state.doc.textContent })}\n`
    )
  })

  it('builds pairs once for two valid formulas in the same paragraph', () => {
    const set = vi.spyOn(WeakMap.prototype, 'set')
    const get = vi.spyOn(WeakMap.prototype, 'get')
    try {
      const e = make(String.raw`\(a\) text \(b\)`)
      expect(math(e).map((node) => node.attrs?.latex)).toEqual(['a', 'b'])
      const builds = set.mock.calls.filter(([, value]) => value?.pairs instanceof Map).length
      const hits = get.mock.results.filter((result) => result.value?.pairs instanceof Map).length
      expect(builds).toBe(1)
      expect(hits).toBe(1)
      process.stdout.write(`two-formula cache: builds=${builds}, hits=${hits}\n`)
    } finally {
      set.mockRestore()
      get.mockRestore()
    }
  })

  it('preserves a closing bracket in a link label through two round trips', () => {
    let saved = String.raw`[x\]y](https://example.com)`
    for (let round = 0; round < 2; round++) {
      const e = make(saved)
      expect(e.getJSON().content?.[0]?.content).toEqual([
        {
          type: 'text',
          text: 'x]y',
          marks: [{ type: 'enhancedLink', attrs: { href: 'https://example.com', title: null } }]
        }
      ])
      saved = e.getMarkdown()
      expect(saved).toBe(String.raw`[x\]y](https://example.com)`)
    }
  })

  it('keeps ordinary [x] escaped only at the opening bracket', () => {
    const saved = make('[x]').getMarkdown()
    expect(saved).toBe(String.raw`\[x]`)
    const e = make(saved)
    expect(math(e)).toEqual([])
    expect(e.state.doc.textContent).toBe('[x]')
  })

  it.each([String.raw`before \(a\) after`, String.raw`> before \(a\) after`, String.raw`- \(a\)`])(
    'keeps an edited formula inline in a restricted container: %s',
    (source) => {
      const e = make(source)
      let pos = 0
      e.state.doc.descendants((node, position) => {
        if (node.type.name === 'inlineMath') pos = position
      })
      e.commands.updateInlineMath({ pos, latex: String.raw`x\)y` })
      const saved = e.getMarkdown()
      expect(saved).toContain(String.raw`\(x\)y\)`)
      for (let round = 0; round < 2; round++) {
        const loaded = make(round === 0 ? saved : editor!.getMarkdown())
        expect(math(loaded).map((node) => [node.type, node.attrs?.latex])).toEqual([['inlineMath', 'x']])
        expect(loaded.state.doc.textContent).toContain('y)')
        if (source.includes('before')) expect(loaded.state.doc.textContent).toContain('before ')
        if (source.includes('after')) expect(loaded.state.doc.textContent).toContain(' after')
      }
    }
  )

  it('retains inline delimiters for multiline latex in a compact list', () => {
    const e = make(String.raw`- \(a\)`)
    e.commands.updateInlineMath({ pos: 3, latex: 'x\ny' })
    const saved = e.getMarkdown()
    expect(saved).toContain('\\(x\ny\\)')
    const loaded = make(saved)
    expect(loaded.state.doc.firstChild?.type.name).toBe('bulletList')
    expect(loaded.state.doc.textContent).toContain('(x\ny)')
  })

  it('keeps cell math inline when table serialization flattens its newline', () => {
    const e = make('| H |\n| --- |\n| \\(a\\) |')
    let pos = 0
    e.state.doc.descendants((node, position) => {
      if (node.type.name === 'inlineMath') pos = position
    })
    e.commands.updateInlineMath({ pos, latex: 'x\ny' })
    const saved = e.getMarkdown()
    expect(saved).toContain(String.raw`\(x y\)`)
    const loaded = make(saved)
    expect(math(loaded).map((node) => [node.type, node.attrs?.latex])).toEqual([['inlineMath', 'x y']])
  })

  it.each([
    ['[a] [b](c)', '[a] b', 'b', String.raw`\[a] [b](c)`],
    ['[a][b](c)', '[a]b', 'b', String.raw`\[a][b](c)`],
    [String.raw`[x\][y\]z]`, '[x][y]z]', '', String.raw`\[x]\[y]z]`]
  ])('retains existing bracket/link semantics over two reloads: %s', (input, text, link, expected) => {
    let source = input
    for (let round = 0; round < 3; round++) {
      const e = make(source)
      expect(math(e)).toEqual([])
      expect(e.state.doc.textContent).toBe(text)
      const links = e.getJSON().content?.[0]?.content?.filter((n) => n.marks?.some((m) => m.type === 'enhancedLink'))
      expect(links).toEqual(
        link ? [{ type: 'text', text: link, marks: [{ type: 'enhancedLink', attrs: { href: 'c', title: null } }] }] : []
      )
      source = e.getMarkdown()
      expect(source).toBe(expected)
    }
  })

  // A trailing escape must not turn an unclosed reference ID into a protected range.
  it.each([
    [String.raw`\[[a][b\]c`, ['[a][b'], 'c', String.raw`\[[a][b\]c`],
    [String.raw`\[[a][b\]c` + '\\', ['[a][b'], 'c\\', String.raw`\[[a][b\]c` + '\\\\']
  ])('pairs math only outside a closed reference ID: %s', (input, latex, text, expected) => {
    let source = input
    for (let round = 0; round < 3; round++) {
      const e = make(source)
      expect(math(e).map((n) => [n.type, n.attrs?.latex])).toEqual(latex.map((value) => ['inlineMath', value]))
      expect(e.state.doc.textContent).toBe(text)
      source = e.getMarkdown()
      expect(source).toBe(expected)
    }
  })

  // Marked links stay protected even without reference definitions.
  it.each([
    [
      String.raw`\[a] [a][b](url\]url)` + '\n\n[b]: /x',
      [],
      '[a] a(url]url)',
      [{ type: 'text', text: 'a', marks: [{ type: 'enhancedLink', attrs: { href: '/x', title: null } }] }],
      String.raw`\[a] [a](/x)(url]url)`,
      '5c5b615d205b615d282f78292875726c5d75726c29'
    ],
    [
      String.raw`\[a] [a][b](url\]url)`,
      [],
      '[a] [a]b',
      [{ type: 'text', text: 'b', marks: [{ type: 'enhancedLink', attrs: { href: 'url]url', title: null } }] }],
      String.raw`\[a] \[a][b](url]url)`,
      '5c5b615d205c5b615d5b625d2875726c5d75726c29'
    ],
    [String.raw`\[[a][b\]c]`, ['[a][b'], 'c]', [], String.raw`\[[a][b\]c]`, '5c5b5b615d5b625c5d635d']
  ] as const)(
    'uses stable Marked reference boundaries over three rounds: %s',
    (input, latex, text, links, saved, bytes) => {
      let source: string = input
      const observations: Array<{ round: number; nodes: JSONContent[] | undefined; saved: string; bytes: string; check: string }> = []
      for (let round = 0; round < 3; round++) {
        const e = make(source)
        expect(math(e).map((node) => [node.type, node.attrs?.latex])).toEqual(
          latex.map((value) => ['inlineMath', value])
        )
        expect(e.state.doc.textContent).toBe(text)
        expect(
          e.getJSON().content?.[0]?.content?.filter((node) => node.marks?.some((m) => m.type === 'enhancedLink'))
        ).toEqual(links)
        source = e.getMarkdown()
        expect(source).toBe(saved)
        expect(Buffer.from(source).toString('hex')).toBe(bytes)
        observations.push({ round, nodes: e.getJSON().content, saved: source, bytes, check: 'passed' })
        expect(observations[round].nodes).toEqual(observations[0].nodes)
      }
      process.stdout.write(`Marked reference boundary: ${JSON.stringify({ input, observations })}\n`)
    }
  )

  it.each([
    ['\\[a `` b `` \\]', '\\[a `b` ]', '[a b ]', 'code'],
    [String.raw`\[a [b](/x) c\]`, String.raw`\[a [b](/x) c]`, '[a b c]', 'enhancedLink'],
    [String.raw`\(a [b](/x) c\)`, '(a [b](/x) c)', '(a b c)', 'enhancedLink'],
    [String.raw`\[a ` + '`b`' + String.raw` c\]`, String.raw`\[a ` + '`b` c]', '[a b c]', 'code'],
    [String.raw`\(a ` + '`b`' + String.raw` c\)`, '(a `b` c)', '(a b c)', 'code']
  ])('rejects math spanning protected content over three rounds: %s', (input, saved, text, mark) => {
    let source = input
    const observations: Array<{ nodes: JSONContent[] | undefined; saved: string; bytes: string }> = []
    for (let round = 0; round < 3; round++) {
      const e = make(source)
      expect(math(e)).toEqual([])
      expect(e.state.doc.textContent).toBe(text)
      expect(e.getJSON().content?.[0]?.content).toContainEqual({
        type: 'text',
        text: 'b',
        marks: mark === 'code' ? [{ type: 'code' }] : [{ type: mark, attrs: { href: '/x', title: null } }]
      })
      source = e.getMarkdown()
      expect(source).toBe(saved)
      const bytes = Buffer.from(source).toString('hex')
      expect(bytes).toBe(Buffer.from(saved).toString('hex'))
      observations.push({ nodes: e.getJSON().content, saved: source, bytes })
      expect(observations[round]).toEqual(observations[0])
    }
    process.stdout.write(`Protected span boundary: ${JSON.stringify({ input, observations })}\n`)
  })

  it.each([
    [String.raw`\[a $x$ b\]`, ['a $x$ b'], '', String.raw`\[a $x$ b\]`],
    [String.raw`\(a $x$ b\)`, ['a $x$ b'], '', String.raw`\(a $x$ b\)`],
    [
      String.raw`\[a ` + '`b`' + String.raw` c\] \[ok\]`,
      ['ok'],
      '[a b c] ',
      String.raw`\[a ` + '`b` c] ' + String.raw`\[ok\]`
    ]
  ])('keeps dollar spans and later formula pairing over three rounds: %s', (input, latex, text, saved) => {
    let source = input
    const observations: Array<{ nodes: JSONContent[] | undefined; saved: string; bytes: string }> = []
    for (let round = 0; round < 3; round++) {
      const e = make(source)
      expect(math(e).map((node) => node.attrs?.latex)).toEqual(latex)
      expect(e.state.doc.textContent).toBe(text)
      source = e.getMarkdown()
      expect(source).toBe(saved)
      observations.push({ nodes: e.getJSON().content, saved: source, bytes: Buffer.from(source).toString('hex') })
      expect(observations[round]).toEqual(observations[0])
    }
    process.stdout.write(`Span continuation: ${JSON.stringify({ input, observations })}\n`)
  })

  it('excludes an escaped reference ID from formula pairing over two reloads', () => {
    let saved = String.raw`\[a] [x][b\]c]` + '\n\n' + String.raw`[b\]c]: /url`
    for (let round = 0; round < 3; round++) {
      const e = make(saved)
      expect(math(e)).toEqual([])
      expect(e.getJSON().content?.[0]?.content).toContainEqual({
        type: 'text',
        text: 'x',
        marks: [{ type: 'enhancedLink', attrs: { href: '/url', title: null } }]
      })
      saved = e.getMarkdown()
    }
  })

  it('allows a formula closer after an unclosed link target', () => {
    const e = make(String.raw`\[[a](b\]`)
    expect(math(e).map((node) => node.attrs?.latex)).toEqual(['[a](b'])
    expect(e.getMarkdown()).toBe(String.raw`\[[a](b\]`)
  })

  // These edits previously lost newlines, whitespace or text following a delimiter on reload.
  it.each([
    [String.raw`\(a\)`, 'x\ny'],
    [String.raw`\(a\)`, String.raw`x\)y`],
    [String.raw`\(a\)`, ' a '],
    [String.raw`\[a\]`, 'x\ny'],
    [String.raw`\(a\)`, 'x\n\\[\ny'],
    [String.raw`\[a\]`, String.raw`x\]y`],
    [String.raw`\(a\)`, 'x\n \ny\\)z'],
    [String.raw`\(a\)`, 'x\n# y\\)z']
  ])('promotes unrepresentable inline latex without loss: %s %s', (source, latex) => {
    const e = make(source)
    e.commands.updateInlineMath({ pos: 1, latex })
    const first = e.getMarkdown()
    expect(first).toBe(`\\[\n${latex}\n\\]`)
    const loaded = make(first)
    expect(math(loaded).map((n) => [n.type, n.attrs?.latex])).toEqual([['blockMath', latex]])
    expect(loaded.getMarkdown()).toBe(first)
    process.stdout.write(`promotion: ${JSON.stringify({ source, latex, first, second: loaded.getMarkdown() })}\n`)
  })

  it.each([
    ['x\n`y`', '5c5b0a780a6079600a5c5d'],
    ['x\n[a](u)', '5c5b0a780a5b615d2875290a5c5d'],
    ['x\n<b>x</b>', '5c5b0a780a3c623e783c2f623e0a5c5d'],
    ['x\n<https://example.net/q>', '5c5b0a780a3c68747470733a2f2f6578616d706c652e6e65742f713e0a5c5d'],
    ['x\n<https://example.com>', '5c5b0a780a3c68747470733a2f2f6578616d706c652e636f6d3e0a5c5d'],
    ['x\nhttps://example.com', '5c5b0a780a68747470733a2f2f6578616d706c652e636f6d0a5c5d']
  ])('preserves promoted latex across Marked spans over three reloads: %s', (latex, hex) => {
    const e = make(String.raw`\(a\)`)
    e.commands.updateInlineMath({ pos: 1, latex })
    e.state.doc.check()
    const saved = `\\[\n${latex}\n\\]`
    let source = e.getMarkdown()
    expect(source).toBe(saved)
    expect(Buffer.from(source).toString('hex')).toBe(hex)
    const observations: Array<{ nodes: JSONContent; latex: string; saved: string; hex: string }> = []
    for (let round = 0; round < 3; round++) {
      const loaded = make(source)
      loaded.state.doc.check()
      expect(math(loaded).map((node) => [node.type, node.attrs?.latex])).toEqual([['blockMath', latex]])
      source = loaded.getMarkdown()
      expect(source).toBe(saved)
      expect(Buffer.from(source).toString('hex')).toBe(hex)
      observations.push({ nodes: loaded.getJSON(), latex, saved: source, hex: Buffer.from(source).toString('hex') })
      expect(observations[round]).toEqual(observations[0])
    }
    process.stdout.write(`promotion across protected spans: ${JSON.stringify({ observations })}\n`)
  })

  it.each([
    {
      name: 'A',
      input: '\\(a\\)',
      latex: 'x\n`foo\n\\]\\[q\nbar`',
      saved: '(x\n`foo \\]\\[q bar`)',
      hex: '28780a60666f6f205c5d5c5b71206261726029',
      formulas: [],
      text: '(x\nfoo \\]\\[q bar)'
    },
    {
      name: 'B',
      input: '\\(a\\)\n\nq $p$',
      latex: 'x\n\\verb|$z| `y`',
      saved: '(x\n\\\\verb|$z| `y`)\n\nq $p$',
      hex: '28780a5c5c766572627c247a7c20607960290a0a7120247024',
      formulas: [['inlineMath', 'p']],
      text: '(x\n\\verb|$z| y)'
    }
  ])(
    'rejects unsafe block promotion over three reloads: $name',
    ({ name, input, latex, saved, hex, formulas, text }) => {
      const e = make(input)
      e.commands.updateInlineMath({ pos: 1, latex })
      e.state.doc.check()
      expect(math(e)[0]).toMatchObject({ type: 'inlineMath', attrs: { latex } })
      const paragraphs = e.getJSON().content?.map((node) => node.type)
      expect(paragraphs).toEqual(name === 'A' ? ['paragraph'] : ['paragraph', 'paragraph'])
      const first = e.getMarkdown()
      expect(first).toBe(`\\(${latex}\\)${name === 'B' ? '\n\nq $p$' : ''}`)
      let source = first
      const observations: Array<{ nodes: JSONContent; formulas: JSONContent[]; saved: string; hex: string }> = []
      // Both edited formulas reload as text: inline pairing cannot cross the LF/code span.
      // A has no remaining latex; B retains only the external dollar formula's latex "p".
      for (let round = 0; round < 3; round++) {
        const loaded = make(source)
        loaded.state.doc.check()
        expect(loaded.getJSON().content?.map((node) => node.type)).toEqual(paragraphs)
        expect(loaded.state.doc.firstChild?.textContent).toBe(text)
        expect(math(loaded).map((node) => [node.type, node.attrs?.latex])).toEqual(formulas)
        source = loaded.getMarkdown()
        expect(source).toBe(saved)
        expect(Buffer.from(source)).toEqual(Buffer.from(hex, 'hex'))
        expect(Buffer.from(source).toString('hex')).toBe(hex)
        observations.push({
          nodes: loaded.getJSON(),
          formulas: math(loaded),
          saved: source,
          hex: Buffer.from(source).toString('hex')
        })
        expect(observations[round]).toEqual(observations[0])
      }
      process.stdout.write(`rejected promotion ${name}: ${JSON.stringify({ first, observations })}\n`)
    }
  )

  it.each(['', ' ', '  ', '   '])('does not promote a block closer prefix after %s indentation', (indent) => {
    for (const tail of ['', '\\[q', ' text', 'y']) {
      const e = make(String.raw`\(a\)`)
      const latex = `x\n\`y\n${indent}\\]${tail}\nz\``
      e.commands.updateInlineMath({ pos: 1, latex })
      e.state.doc.check()
      expect(e.getJSON().content?.map((node) => node.type)).toEqual(['paragraph'])
      expect(e.getMarkdown()).toBe(`\\(${latex}\\)`)
    }
  })

  it('does not promote a standalone block closer even inside a code span', () => {
    const e = make(String.raw`\(a\)`)
    const latex = 'x\n`y\n\\]\nz`'
    e.commands.updateInlineMath({ pos: 1, latex })
    e.state.doc.check()
    expect(math(e).map((node) => [node.type, node.attrs?.latex])).toEqual([['inlineMath', latex]])
    expect(e.getMarkdown()).toBe(`\\(${latex}\\)`)
  })

  it('pairs the first standalone block closer even inside a multiline code span', () => {
    let source = '\\[\n`x\n\\]\ny`\n\\]'
    const observations: Array<{ nodes: JSONContent; saved: string; hex: string }> = []
    for (let round = 0; round < 3; round++) {
      const e = make(source)
      e.state.doc.check()
      source = e.getMarkdown()
      expect(math(e).map((node) => [node.type, node.attrs?.latex])).toEqual([['blockMath', '`x']])
      expect(e.state.doc.textContent).toBe('y`\n]')
      expect(source).toBe('\\[\n`x\n\\]\n\ny\\`\n]')
      expect(Buffer.from(source).toString('hex')).toBe('5c5b0a60780a5c5d0a0a795c600a5d')
      observations.push({ nodes: e.getJSON(), saved: source, hex: Buffer.from(source).toString('hex') })
      expect(observations[round]).toEqual(observations[0])
    }
    process.stdout.write(`block closer probe: ${JSON.stringify(observations)}\n`)
  })

  it('retains the original delimiter when latex contains a standalone block closer', () => {
    const e = make(String.raw`\(a\)`)
    e.commands.updateInlineMath({ pos: 1, latex: 'x\n\\]\ny' })
    expect(e.getMarkdown()).toBe('\\(x\n\\]\ny\\)')
  })

  it('excludes the separator LF from block raw and saves idempotently', () => {
    const e = make('\\[\na\n\\]\nparagraph')
    expect(math(e)[0]?.attrs?.markdownSource.raw).toBe('\\[\na\n\\]')
    const first = e.getMarkdown()
    const second = make(first).getMarkdown()
    expect(first).toBe('\\[\na\n\\]\n\nparagraph')
    expect(second).toBe(first)
    process.stdout.write(`block raw idempotence: ${JSON.stringify(first)} === ${JSON.stringify(second)}\n`)
  })

  it('preserves surrounding text and adjacent short formulas', () => {
    const e = make(String.raw`text \[a\]\(b\) tail`)
    expect(e.getJSON().content?.[0]?.content?.map((n) => asNode(n).text ?? asNode(n).attrs?.latex)).toEqual([
      'text ',
      'a',
      'b',
      ' tail'
    ])
    expect(math(e)).toHaveLength(2)
  })

  it.each(['', ' ', '   '])('protects multiline blocks with %s indentation from markdown rules', (indent) => {
    const source = `${indent}\\[ \t\na\n\n=\n-\nb\n\\]`
    const e = make(source)
    expect(math(e).map((n) => [n.type, n.attrs?.latex])).toEqual([['blockMath', 'a\n\n=\n-\nb']])
    expect(e.getMarkdown()).toBe(source)
  })

  it.each([
    [String.raw`\\[a\\]`, String.raw`\[a\]`],
    [String.raw`\[ a`, '[ a'],
    [String.raw`some \( text`, 'some ( text'],
    ['\\[a\nb\\]', '[a\nb]'],
    ['[a', '[a']
  ])('falls back without consuming unmatched or escaped input %s', (source, text) => {
    const e = make(source)
    expect(math(e)).toHaveLength(0)
    expect(e.state.doc.textContent).toBe(text)
  })

  it.each([
    ['\\[a ` b\\]', 'a ` b'],
    ['\\[a `` b ` \\]', 'a `` b `']
  ])('keeps formula closers around backtick runs across reloads: %s', (input, latex) => {
    let source = input
    for (let round = 0; round < 3; round++) {
      const e = make(source)
      expect(math(e).map((node) => [node.type, node.attrs?.latex])).toEqual([['inlineMath', latex]])
      expect(e.getMarkdown()).toBe(input)
      e.state.doc.check()
      source = e.getMarkdown()
    }
  })

  it.each([
    {
      name: 'plain bracket text before a paren formula',
      input: String.raw`[x] \(a\verb|\]|b\)`,
      saved: String.raw`\[x] \(a\verb|\]|b\)`,
      expected: [
        [
          'paragraph',
          [
            ['text', '[x] '],
            ['inlineMath', String.raw`a\verb|\]|b`]
          ]
        ]
      ],
      delimiters: ['paren']
    },
    {
      name: 'paren interval inside bracket math',
      input: String.raw`\[ a \(b\) \]`,
      saved: String.raw`\[ a \(b\) \]`,
      expected: [['paragraph', [['inlineMath', String.raw`a \(b\)`]]]],
      delimiters: ['bracket']
    },
    {
      name: 'adjacent bracket and paren formulas',
      input: String.raw`\[ a \] \(b\)`,
      saved: String.raw`\[ a \] \(b\)`,
      expected: [
        [
          'paragraph',
          [
            ['inlineMath', 'a'],
            ['text', ' '],
            ['inlineMath', 'b']
          ]
        ]
      ],
      delimiters: ['bracket', 'paren']
    },
    {
      name: 'plain bracket paragraph before a paren paragraph',
      input: '[x]\n\n' + String.raw`\(a\verb|\]|b\)`,
      saved: '\\[x]\n\n' + String.raw`\(a\verb|\]|b\)`,
      expected: [
        ['paragraph', [['text', '[x]']]],
        ['paragraph', [['inlineMath', String.raw`a\verb|\]|b`]]]
      ],
      delimiters: ['paren']
    },
    {
      name: 'block bracket formula containing a paren interval',
      input: '\\[\na \\(b\\)\n\\]',
      saved: '\\[\na \\(b\\)\n\\]',
      expected: [['blockMath', String.raw`a \(b\)`]],
      delimiters: ['bracket']
    },
    {
      name: 'paren closer on another line does not shield a block closer',
      input: '\\[\n\\(a\n\\]\n\\)',
      saved: '\\[\n\\(a\n\\]\n\n)',
      expected: [
        ['blockMath', String.raw`\(a`],
        ['paragraph', [['text', ')']]]
      ],
      delimiters: ['bracket']
    },
    {
      name: 'unpaired paren opener before a bracket closer',
      input: String.raw`\[ a \(b \]`,
      saved: String.raw`\[ a \(b \]`,
      expected: [['paragraph', [['inlineMath', String.raw`a \(b`]]]],
      delimiters: ['bracket']
    },
    {
      name: 'escaped paren closer does not pair',
      input: String.raw`\[ a \(b\\) \]`,
      saved: String.raw`\[ a \(b\\) \]`,
      expected: [['paragraph', [['inlineMath', String.raw`a \(b\\)`]]]],
      delimiters: ['bracket']
    }
  ])('keeps paren intervals out of bracket pairing: $name', ({ name, input, saved, expected, delimiters }) => {
    let source = input
    const observations: Array<{ round: number; nodes: unknown[]; math: JSONContent['attrs'][]; saved: string; bytes: string; check: string }> = []
    for (let round = 0; round < 3; round++) {
      const e = make(source)
      e.state.doc.check()
      source = e.getMarkdown()
      observations.push({
        round,
        nodes: sequence(e.getJSON().content ?? []),
        math: math(e).map((node) => node.attrs),
        saved: source,
        bytes: Buffer.from(source).toString('hex'),
        check: 'passed'
      })
    }
    process.stdout.write(`paren interval probe: ${JSON.stringify({ name, observations })}\n`)
    for (const observation of observations) {
      expect(observation.nodes).toEqual(expected)
      expect(observation.math.map((attrs) => attrs?.delimiter)).toEqual(delimiters)
      expect(observation.math).toEqual(observations[0].math)
      expect(observation.saved).toBe(saved)
    }
  })

  // Multiline exclusions must preserve dollar math, code and links without extending math scope.
  it.each([
    {
      input: '\\[a $b\nc$\\]',
      formulas: [['inlineMath', null, 'b\nc']],
      text: '[a ]',
      saved: '\\[a $b\nc$]'
    },
    {
      input: '\\[a] `first \\]\nsecond`',
      formulas: [],
      text: '[a] first \\] second',
      code: ['first \\] second'],
      saved: '\\[a] `first \\] second`'
    },
    {
      input: '\\[a] [first \\]\nsecond](url)',
      formulas: [],
      text: '[a] first ]\nsecond',
      links: [['first ]\nsecond', 'url']],
      saved: '\\[a] [first \\]\nsecond](url)'
    },
    {
      input: '\\[a] `first \\]\nsecond` \\[c\\]',
      formulas: [['inlineMath', 'bracket', 'c']],
      text: '[a] first \\] second ',
      code: ['first \\] second'],
      saved: '\\[a] `first \\] second` \\[c\\]'
    },
    {
      input: '\\[a] [first \\]\nsecond](url) \\[c\\]',
      formulas: [['inlineMath', 'bracket', 'c']],
      text: '[a] first ]\nsecond ',
      links: [['first ]\nsecond', 'url']],
      saved: '\\[a] [first \\]\nsecond](url) \\[c\\]'
    },
    {
      input: '\\[a] `first \\]\nsecond',
      formulas: [['inlineMath', 'bracket', 'a] `first']],
      text: '\nsecond',
      saved: '\\[a] `first \\]\nsecond'
    },
    {
      input: '\\[a] [first\n\nsecond](url) \\[c\\]',
      formulas: [['inlineMath', 'bracket', 'c']],
      text: '[a] [firstsecond](url) ',
      saved: '\\[a] \\[first\n\nsecond](url) \\[c\\]'
    },
    {
      input: '\\[a] [first \\]\n \t\nsecond](url) \\[c\\]',
      formulas: [['inlineMath', 'bracket', 'c']],
      text: '[a] first ]\n \t\nsecond ',
      links: [['first ]\n \t\nsecond', 'url']],
      saved: '\\[a] [first \\]\n \t\nsecond](url) \\[c\\]'
    }
  ])(
    'protects multiline exclusions within their boundaries: $input',
    ({ input, formulas, text, code, links, saved }) => {
      let source = input
      const observations: Array<{ round: number; nodes: JSONContent[] | undefined; saved: string; bytes: string; check: string }> = []
      for (let round = 0; round < 3; round++) {
        const e = make(source)
        e.state.doc.check()
        source = e.getMarkdown()
        const markedText: { code: string[]; links: unknown[] } = { code: [], links: [] }
        e.state.doc.descendants((node) => {
          if (node.marks.some((mark) => mark.type.name === 'code')) markedText.code.push(node.text ?? '')
          const link = node.marks.find((mark) => mark.type.name === 'enhancedLink')
          if (link) markedText.links.push([node.text, link.attrs.href])
        })
        observations.push({
          round,
          nodes: e.getJSON().content,
          saved: source,
          bytes: Buffer.from(source).toString('hex'),
          check: 'passed'
        })
        expect(math(e).map((node) => [node.type, node.attrs?.delimiter, node.attrs?.latex])).toEqual(formulas)
        expect(e.state.doc.textContent).toBe(text)
        expect(markedText.code).toEqual(code ?? [])
        expect(markedText.links).toEqual(links ?? [])
        expect(source).toBe(saved)
        expect(Buffer.from(source).toString('hex')).toBe(Buffer.from(saved).toString('hex'))
      }
      process.stdout.write(`multiline boundary contract: ${JSON.stringify({ input, observations })}\n`)
    }
  )

  // Accepted inner spans must not discard earlier openers; newlines still end their scope.
  it.each([
    {
      input: String.raw`[x] \($b$\]\)`,
      formulas: [['inlineMath', 'paren', String.raw`$b$\]`]],
      text: '[x] ',
      saved: String.raw`\[x] \($b$\]\)`
    },
    {
      input: String.raw`\[x] [a $b$](url\]z)`,
      formulas: [['inlineMath', null, 'b']],
      text: '[x] a ',
      href: 'url]z',
      saved: String.raw`\[x] [a](url]z) $b$`
    },
    {
      input: '\\[a ``b\\]c`',
      formulas: [['inlineMath', 'bracket', 'a ``b']],
      text: 'c`',
      saved: '\\[a ``b\\]c\\`'
    },
    {
      input: '\\[a ``b\\]c`` ',
      formulas: [],
      text: '[a b\\]c ',
      code: ['b\\]c'],
      saved: '\\[a `b\\]c` '
    },
    {
      input: '\\[a \\(`x`\\]\\)',
      formulas: [],
      text: '[a (x])',
      code: ['x'],
      saved: '\\[a (`x`])'
    },
    {
      input: '\\[a [x $$b\nc$$[y](u\\]z)',
      formulas: [['blockMath', null, 'b\nc']],
      text: '[a [x y',
      href: 'u]z',
      saved: '\\[a \\[x \n\n$$\nb\nc\n$$\n\n[y](u]z)'
    },
    {
      input: '\\[a \\(x $$b\nc$$\\(y\\]\\)',
      formulas: [
        ['blockMath', null, 'b\nc'],
        ['inlineMath', 'paren', 'y\\]']
      ],
      text: '[a (x ',
      saved: '\\[a (x \n\n$$\nb\nc\n$$\n\n\\(y\\]\\)'
    },
    {
      input: '\\[a [x $$b\nc$$](u\\]z)',
      formulas: [['blockMath', null, 'b\nc']],
      text: '[a [x ](u]z)',
      saved: '\\[a \\[x \n\n$$\nb\nc\n$$\n\n](u]z)'
    },
    {
      input: '\\[a \\(x $$b\nc$$\\]\\)',
      formulas: [['blockMath', null, 'b\nc']],
      text: '[a (x ])',
      saved: '\\[a (x \n\n$$\nb\nc\n$$\n\n])'
    },
    {
      input: '\\[a ``b `x`\\]c',
      formulas: [],
      text: '[a ``b x]c',
      code: ['x'],
      saved: '\\[a \\`\\`b `x`]c'
    },
    {
      input: '\\[x] a ``b `x`',
      formulas: [],
      text: '[x] a ``b x',
      code: ['x'],
      saved: '\\[x] a \\`\\`b `x`'
    },
    {
      input: '\\[x] a `b ``c`` then ``x``',
      formulas: [],
      text: '[x] a `b c then x',
      code: ['c', 'x'],
      saved: '\\[x] a \\`b `c` then `x`'
    },
    {
      input: '`$` `\\[a\\]` $z$',
      formulas: [['inlineMath', null, 'z']],
      text: '$ \\[a\\] ',
      code: ['$', '\\[a\\]'],
      saved: '`$` `\\[a\\]` $z$'
    }
  ])('preserves earlier openers and whole backtick runs: $input', ({ input, formulas, text, saved, href, code }) => {
    let source = input
    const observations: Array<{ round: number; nodes: JSONContent[] | undefined; math: unknown[]; text: string; saved: string; bytes: string; check: string }> = []
    for (let round = 0; round < 3; round++) {
      const e = make(source)
      e.state.doc.check()
      source = e.getMarkdown()
      observations.push({
        round,
        nodes: e.getJSON().content,
        math: math(e).map((node) => [node.type, node.attrs?.delimiter, node.attrs?.latex]),
        text: e.state.doc.textContent,
        saved: source,
        bytes: Buffer.from(source).toString('hex'),
        check: 'passed'
      })
    }
    process.stdout.write(`retained opener probe: ${JSON.stringify({ input, observations })}\n`)
    for (const observation of observations) {
      expect(observation.math).toEqual(formulas)
      expect(observation.text).toBe(text)
      expect(observation.saved).toBe(saved)
      expect(observation.bytes).toBe(Buffer.from(saved).toString('hex'))
      const inline = observation.nodes?.flatMap((node) => node.content ?? []) ?? []
      expect(
        inline.flatMap(
          (node) => node.marks?.filter((mark) => mark.type === 'enhancedLink').map((mark) => mark.attrs?.href) ?? []
        )
      ).toEqual(href ? [href] : [])
      if (code)
        expect(
          inline.filter((node) => node.marks?.some((mark) => mark.type === 'code')).map((node) => node.text)
        ).toEqual(code)
    }
    expect(observations[2].nodes).toEqual(observations[1].nodes)
    if (!href) expect(observations[1].nodes).toEqual(observations[0].nodes)
  })

  // Upstream multi-backtick serialization normalizes the first parse; base reproduces this too:
  // round 0: nodes [text "a ", code "b ``c`` ", text "x`"], saved "a `b ``c``` x\`"
  // round 1: nodes [text "a ", code "b ``c``` x\", text "`"], saved "a `b ``c``` x\`"
  // round 2: 同 round 1
  it('keeps math absent while upstream multi-backtick nodes stabilize after the first reload', () => {
    let source = '\\[a `b ``c`` `x`\\]d'
    const saved = '\\[a `b ``c``` x\\`]d'
    const bytes = '5c5b612060622060606360606020785c605d64'
    const observations: Array<{ nodes: JSONContent[] | undefined; saved: string; bytes: string }> = []
    for (let round = 0; round < 3; round++) {
      const e = make(source)
      e.state.doc.check()
      expect(math(e)).toEqual([])
      expect(e.getJSON().content).toEqual([
        {
          type: 'paragraph',
          content:
            round === 0
              ? [
                  { type: 'text', text: '[a ' },
                  { type: 'text', marks: [{ type: 'code' }], text: 'b ``c`` ' },
                  { type: 'text', text: 'x`]d' }
                ]
              : [
                  { type: 'text', text: '[a ' },
                  { type: 'text', marks: [{ type: 'code' }], text: 'b ``c``` x\\' },
                  { type: 'text', text: ']d' }
                ]
        }
      ])
      expect(e.state.doc.textContent).toBe(round === 0 ? '[a b ``c`` x`]d' : '[a b ``c``` x\\]d')
      source = e.getMarkdown()
      expect(source).toBe(saved)
      expect(Buffer.from(source).toString('hex')).toBe(bytes)
      observations.push({ nodes: e.getJSON().content, saved: source, bytes: Buffer.from(source).toString('hex') })
    }
    expect(observations[2]).toEqual(observations[1])
    expect(observations.map((observation) => observation.bytes)).toEqual([bytes, bytes, bytes])
    process.stdout.write(`Multi-backtick normalization: ${JSON.stringify({ observations })}\n`)
  })

  // A backtick inside dollar math must not consume the next real code opener.
  it.each([
    {
      name: 'dollar then real code',
      input: '[x] $a `b$ `\\]`',
      saved: '\\[x] $a `b$ `\\]`',
      expected: [
        { type: 'text', text: '[x] ' },
        { type: 'inlineMath', latex: 'a `b' },
        { type: 'text', text: ' ' },
        { type: 'text', text: '\\]', marks: [{ type: 'code' }] }
      ]
    },
    {
      name: 'code then real dollar',
      input: '`$` $z$',
      saved: '`$` $z$',
      expected: [
        { type: 'text', text: '$', marks: [{ type: 'code' }] },
        { type: 'text', text: ' ' },
        { type: 'inlineMath', latex: 'z' }
      ]
    },
    {
      name: 'link target then real dollar',
      input: String.raw`[x] [price](url$\]) $z$ \[w\]`,
      saved: String.raw`\[x] [price](url$]) $z$ \[w\]`,
      expected: [
        { type: 'text', text: '[x] ' },
        { type: 'text', text: 'price', marks: [{ type: 'enhancedLink', attrs: { href: 'url$]', title: null } }] },
        { type: 'text', text: ' ' },
        { type: 'inlineMath', latex: 'z' },
        { type: 'text', text: ' ' },
        { type: 'inlineMath', latex: 'w' }
      ]
    },
    {
      name: 'dollar with code and bracket closer then real code and bracket math',
      input: '[x] $a `b\\]$ `\\]`\\[c\\]',
      saved: '\\[x] $a `b\\]$ `\\]`\\[c\\]',
      expected: [
        { type: 'text', text: '[x] ' },
        { type: 'inlineMath', latex: 'a `b\\]' },
        { type: 'text', text: ' ' },
        { type: 'text', text: '\\]', marks: [{ type: 'code' }] },
        { type: 'inlineMath', latex: 'c' }
      ]
    }
  ])('preserves interleaved exclusions over two reloads: $name', ({ name, input, saved, expected }) => {
    let source = input
    const observations: Array<{ round: number; nodes: unknown[] | undefined; saved: string; bytes: string; check: string }> = []
    for (let round = 0; round < 3; round++) {
      const e = make(source)
      e.state.doc.check()
      source = e.getMarkdown()
      observations.push({
        round,
        nodes: e
          .getJSON()
          .content?.[0]?.content?.map(asNode).map((node) =>
            node.type === 'inlineMath'
              ? { type: node.type, latex: node.attrs?.latex }
              : { type: node.type, text: node.text, ...(node.marks ? { marks: node.marks } : {}) }
          ),
        saved: source,
        bytes: Buffer.from(source).toString('hex'),
        check: 'passed'
      })
    }
    process.stdout.write(`interleaved interval probe: ${JSON.stringify({ name, observations })}\n`)
    for (const observation of observations) {
      expect(observation.nodes).toEqual(expected)
      expect(observation.saved).toBe(saved)
      expect(observation.bytes).toBe(Buffer.from(saved).toString('hex'))
    }
  })

  it.each([
    {
      name: 'code consumes a dollar before bracket and dollar math',
      input: '[x] `$` ' + String.raw`\[a\] $z$`,
      saved: String.raw`\[x] ` + '`$` ' + String.raw`\[a\] $z$`,
      expected: [
        [
          'paragraph',
          [
            ['text', '[x] '],
            ['text', '$'],
            ['text', ' '],
            ['inlineMath', 'a'],
            ['text', ' '],
            ['inlineMath', 'z']
          ]
        ]
      ]
    },
    {
      name: 'link target consumes a dollar before bracket and dollar math',
      input: String.raw`[x] [price](url$) \[a\] $z$`,
      saved: String.raw`\[x] [price](url$) \[a\] $z$`,
      expected: [
        [
          'paragraph',
          [
            ['text', '[x] '],
            ['text', 'price'],
            ['text', ' '],
            ['inlineMath', 'a'],
            ['text', ' '],
            ['inlineMath', 'z']
          ]
        ]
      ]
    },
    {
      name: 'dollar math starts before a code opener',
      input: String.raw`$a \verb|` + '`' + String.raw`| b$ \[c\]`,
      saved: String.raw`$a \verb|` + '`' + String.raw`| b$ \[c\]`,
      expected: [
        [
          'paragraph',
          [
            ['inlineMath', String.raw`a \verb|` + '`| b'],
            ['text', ' '],
            ['inlineMath', 'c']
          ]
        ]
      ]
    },
    {
      name: 'dollar math starts before a link',
      input: String.raw`$x [y](z) $ \[w\]`,
      saved: String.raw`$x [y](z)$ \[w\]`,
      expected: [
        [
          'paragraph',
          [
            ['inlineMath', 'x [y](z)'],
            ['text', ' '],
            ['inlineMath', 'w']
          ]
        ]
      ]
    },
    {
      name: 'parens in separate dollar formulas',
      input: String.raw`[x] $a \verb|\(| b$ \[a\] $c \verb|\)| d$`,
      saved: String.raw`\[x] $a \verb|\(| b$ \[a\] $c \verb|\)| d$`,
      expected: [
        [
          'paragraph',
          [
            ['text', '[x] '],
            ['inlineMath', String.raw`a \verb|\(| b`],
            ['text', ' '],
            ['inlineMath', 'a'],
            ['text', ' '],
            ['inlineMath', String.raw`c \verb|\)| d`]
          ]
        ]
      ]
    },
    {
      name: 'bracket closer inside dollar math',
      input: String.raw`[x] $a\verb|\]|b$`,
      saved: String.raw`\[x] $a\verb|\]|b$`,
      expected: [
        [
          'paragraph',
          [
            ['text', '[x] '],
            ['inlineMath', String.raw`a\verb|\]|b`]
          ]
        ]
      ]
    },
    {
      name: 'escaped dollar still closes upstream inline math',
      input: String.raw`[x] $a\$ \[b\]`,
      saved: String.raw`\[x] $a\$ \[b\]`,
      expected: [
        [
          'paragraph',
          [
            ['text', '[x] '],
            ['inlineMath', 'a\\'],
            ['text', ' '],
            ['inlineMath', 'b']
          ]
        ]
      ]
    },
    {
      name: 'multiline dollar block next to bracket math',
      input: '$$\na\\verb|\\]|b\n$$\n\n\\[b\\]',
      saved: '$$\na\\verb|\\]|b\n$$\n\n\\[b\\]',
      expected: [
        ['blockMath', String.raw`a\verb|\]|b`],
        ['paragraph', [['inlineMath', 'b']]]
      ]
    },
    {
      name: 'compact dollar block immediately before bracket math',
      input: String.raw`$$a$$\[b\]`,
      saved: '$$\na\n$$\n\n\\[b\\]',
      expected: [
        ['blockMath', 'a'],
        ['paragraph', [['inlineMath', 'b']]]
      ]
    },
    {
      name: 'inline dollar immediately before bracket math',
      input: String.raw`$a$\[b\]`,
      saved: String.raw`$a$\[b\]`,
      expected: [
        [
          'paragraph',
          [
            ['inlineMath', 'a'],
            ['inlineMath', 'b']
          ]
        ]
      ]
    },
    {
      name: 'paren closer inside dollar math does not shield bracket math',
      input: String.raw`[x] \(a $b\verb|\)|c$ \[d\]`,
      saved: String.raw`\[x] (a $b\verb|\)|c$ \[d\]`,
      expected: [
        [
          'paragraph',
          [
            ['text', '[x] (a '],
            ['inlineMath', String.raw`b\verb|\)|c`],
            ['text', ' '],
            ['inlineMath', 'd']
          ]
        ]
      ]
    },
    {
      name: 'dollar spans overlap code and link exclusions',
      input: String.raw`[x] $a ` + '`x`' + String.raw` [label](https://example.com) \verb|\]|b$ \[c\]`,
      saved: String.raw`\[x] $a ` + '`x`' + String.raw` [label](https://example.com) \verb|\]|b$ \[c\]`,
      expected: [
        [
          'paragraph',
          [
            ['text', '[x] '],
            ['inlineMath', String.raw`a ` + '`x`' + String.raw` [label](https://example.com) \verb|\]|b`],
            ['text', ' '],
            ['inlineMath', 'c']
          ]
        ]
      ]
    }
  ])('excludes dollar math from delimiter pairing: $name', ({ name, input, saved, expected }) => {
    let source = input
    const observations: Array<{ round: number; nodes: unknown[]; math: JSONContent['attrs'][]; saved: string; bytes: string; check: string }> = []
    for (let round = 0; round < 3; round++) {
      const e = make(source)
      e.state.doc.check()
      source = e.getMarkdown()
      observations.push({
        round,
        nodes: sequence(e.getJSON().content ?? []),
        math: math(e).map((node) => node.attrs),
        saved: source,
        bytes: Buffer.from(source).toString('hex'),
        check: 'passed'
      })
    }
    process.stdout.write(`dollar interval probe: ${JSON.stringify({ name, observations })}\n`)
    for (const observation of observations) {
      expect(observation.nodes).toEqual(expected)
      expect(observation.saved).toBe(saved)
      expect(observation.math).toEqual(observations[0].math)
    }
  })

  it('keeps a formula closer inside paired code separate from plain brackets', () => {
    let source = '[a] `\\]`'
    for (let round = 0; round < 3; round++) {
      const e = make(source)
      expect(math(e)).toEqual([])
      expect(e.getJSON().content?.[0]?.content).toEqual([
        { type: 'text', text: '[a] ' },
        { type: 'text', text: '\\]', marks: [{ type: 'code' }] }
      ])
      expect(e.getMarkdown()).toBe('\\[a] `\\]`')
      e.state.doc.check()
      source = e.getMarkdown()
    }
  })

  it.each([
    ['`\\[a\\]`', String.raw`\[a\]`],
    ['```\n\\[a\\]\n```', String.raw`\[a\]`],
    ['    \\[a\\]', String.raw`\[a\]`],
    ['\t\\[a\\]', String.raw`\[a\]`],
    ['`[a]`', '[a]']
  ])('isolates code %s', (source, text) => {
    const e = make(source)
    expect(math(e)).toHaveLength(0)
    expect(e.state.doc.textContent).toBe(text)
  })

  it('isolates YAML and preserves table, list and quote containers', () => {
    const e = make('---\nformula: \\[a\\]\n---\n\n| A |\n| --- |\n| \\[a\\] |\n\n- \\(b\\)\n\n> \\[c\\]')
    expect(e.getJSON().content?.map((n) => n.type)).toEqual(['yamlFrontMatter', 'table', 'bulletList', 'blockquote'])
    expect(math(e).map((n) => [n.type, n.attrs?.latex])).toEqual([
      ['inlineMath', 'a'],
      ['inlineMath', 'b'],
      ['inlineMath', 'c']
    ])
    expect(asNode(asNode(asNode(e.getJSON().content?.[1]?.content?.[1]).content?.[0]).content?.[0]).type).toBe('paragraph')
  })

  it.each([String.raw`\[ a^2+b^2=c^2 \]`, String.raw`\( a \)`, '\\[\na\n\nb\n\\]'])(
    'keeps raw layout until edited, and restores it on undo: %s',
    (source) => {
      const e = make(source)
      const node = math(e)[0]
      expect(e.getMarkdown()).toBe(source)
      let pos = 0
      e.state.doc.descendants((n, p) => {
        if (n.type.name === node.type) pos = p
      })
      const update = node.type === 'blockMath' ? e.commands.updateBlockMath : e.commands.updateInlineMath
      update({ pos, latex: 'new' })
      expect(e.getMarkdown()).toBe(
        node.type === 'blockMath' ? '\\[\nnew\n\\]\n\n' : node.attrs?.delimiter === 'paren' ? '\\(new\\)' : '\\[new\\]'
      )
      e.commands.undo()
      expect(e.getMarkdown()).toBe(source + (node.type === 'blockMath' ? '\n\n' : ''))
      const changeLatex = (latex: string) =>
        node.type === 'blockMath'
          ? e.commands.updateBlockMath({ pos, latex })
          : e.commands.updateInlineMath({ pos, latex })
      changeLatex('new')
      changeLatex(node.attrs!.latex)
      expect(e.getMarkdown()).toBe(source + (node.type === 'blockMath' ? '\n\n' : ''))
      e.state.doc.check()
    }
  )

  it.each([String.raw`\[ a \]`, '\\[\na\n\\]'])('retains math metadata through HTML and clipboard: %s', (source) => {
    const e = make(source)
    const before = math(e)
    e.commands.selectAll()
    const clipboard = new Map<string, string>()
    const event = new Event('copy', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: { clearData: () => clipboard.clear(), setData: (t: string, v: string) => clipboard.set(t, v) }
    })
    e.view.dom.dispatchEvent(event)
    for (const html of [e.getHTML(), clipboard.get('text/html')!]) {
      expect(html).toContain('data-math-delimiter="bracket"')
      expect(html).toContain('data-math-source=')
      e.commands.setContent(html)
      expect(math(e)).toEqual(before)
    }
  })

  it('escapes HTML attributes and retains the original snapshot after a latex edit', () => {
    const e = make(String.raw`\[ a"<& \]`)
    e.commands.updateInlineMath({ pos: 1, latex: 'edited' })
    const before = math(e)
    const html = e.getHTML()
    expect(html).toContain('&quot;')
    expect(html).toContain('&amp;')
    const element = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-math-source]')
    expect(element?.getAttribute('data-math-source')).toBe(before[0].attrs?.markdownSource.raw)
    e.commands.setContent(html)
    expect(math(e)).toEqual(before)
    expect(e.getMarkdown()).toBe(String.raw`\[edited\]`)
  })

  it('defaults legacy JSON math to dollar serialization including empty latex', () => {
    const e = make('')
    e.commands.setContent({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'inlineMath', attrs: { latex: '' } }] },
        { type: 'blockMath', attrs: { latex: '' } }
      ]
    })
    expect(math(e).every((n) => n.attrs?.delimiter === null && n.attrs?.markdownSource === null)).toBe(true)
    expect(e.getMarkdown()).toBe('$$\n\n$$\n\n$$\n\n')
  })

  it('recognizes math on paragraph continuation lines but not across escaped LF', () => {
    for (const source of ['text\n    \\[a\\]', 'text\n\t\\(a\\)', '\\(a\\\nb\\)']) {
      expect(math(make(source)).map((node) => node.attrs?.latex)).toEqual(source.startsWith('text') ? ['a'] : [])
    }
    const e = make('text    \n' + String.raw`\(a\)`)
    expect(math(e).map((node) => node.attrs?.latex)).toEqual(['a'])
    expect(e.getJSON().content?.[0]?.content?.some((node) => node.type === 'hardBreak')).toBe(true)
  })

  it('keeps empty backslash formulas empty in plain text copy', () => {
    const e = make(String.raw`\[\]\(\)`)
    expect(math(e)).toHaveLength(2)
    expect(e.getMarkdown()).toBe(String.raw`\[\]\(\)`)
    e.commands.selectAll()
    expect(copySelectionAsPlainText(e)).toBe('')
  })

  it('keeps plain brackets as text across repeated saves', () => {
    const e = make('[a]')
    expect(math(e)).toHaveLength(0)
    const saved = e.getMarkdown()
    expect(saved).toBe(String.raw`\[a]`)
    const reloaded = make(saved)
    expect(math(reloaded)).toHaveLength(0)
    expect(reloaded.state.doc.textContent).toBe('[a]')
    expect(reloaded.getMarkdown()).toBe(saved)
  })

  it.each(['[1]', '[x]', '[ ]', '[a](u)', String.raw`C:\Users\x [x]`])(
    'preserves visible text %s without math through two round trips',
    (text) => {
      const initial = make('')
      initial.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
      let saved = initial.getMarkdown()
      for (let round = 0; round < 2; round++) {
        const reloaded = make(saved)
        expect(math(reloaded)).toHaveLength(0)
        expect(reloaded.state.doc.textContent).toBe(text)
        expect(reloaded.getJSON().content?.[0]?.content).toEqual([{ type: 'text', text }])
        expect(reloaded.getMarkdown()).toBe(saved)
        saved = reloaded.getMarkdown()
      }
    }
  )

  it('preserves a parsed reference link through two round trips without math', () => {
    const initial = make('[x][id]\n\n[id]: https://example.com')
    let saved = initial.getMarkdown()
    for (let round = 0; round < 2; round++) {
      const reloaded = make(saved)
      expect(math(reloaded)).toHaveLength(0)
      expect(reloaded.state.doc.textContent).toBe('x')
      expect(reloaded.getJSON().content?.[0]?.content?.[0]?.marks).toEqual([
        expect.objectContaining({
          type: 'enhancedLink',
          attrs: expect.objectContaining({ href: 'https://example.com' })
        })
      ])
      expect(reloaded.getMarkdown()).toBe(saved)
      saved = reloaded.getMarkdown()
    }
  })

  it.each([
    ['[link](https://example.com)', 'enhancedLink', 'link'],
    ['**bold**', 'bold', 'bold']
  ])('retains %s after nested ordinary spans across reloads', (markdown, mark, text) => {
    let source = `Z <span>outer <span>inner</span> ${markdown}</span> Q`
    for (let round = 0; round < 3; round++) {
      const e = make(source)
      expect(math(e)).toEqual([])
      expect(e.state.doc.textContent).toBe(`Z outer inner ${text} Q`)
      expect(e.getJSON().content?.[0]?.content).toContainEqual(
        expect.objectContaining({ text, marks: [expect.objectContaining({ type: mark })] })
      )
      source = e.getMarkdown()
      expect(source).toBe(`Z outer inner ${markdown} Q`)
    }
  })

  it.each([
    '\u00a0data-type="inline-math" data-latex="c"',
    'data-type=inline-math\u00a0 data-latex="c"',
    'data-latex="example"',
    'data-type="ordinary" data-type="inline-math" data-latex="c"',
    'DATA-TYPE="ordinary" data-type="inline-math" data-latex="c"',
    'data-type data-type="inline-math" data-latex="c"',
    ...['&amp;', '&quot;', '&apos;', '&lt;', '&gt;', '&nbsp;', '&amp;#45;'].map(
      (entity) => `data-type="inline${entity}math" data-type="inline-math" data-latex="c"`
    ),
    'data-type="inline-math-extra" data-latex="c"',
    'data-type="block-math" data-latex="c"',
    'data-type="INLINE-MATH" data-latex="c"',
    'title="a &quot; data-latex=x"',
    'title="keep data-latex=example"',
    "title='keep data-latex=example'",
    'title="data-type=inline-math"',
    `title='keep data-type="inline-math"'`
  ])('retains Markdown in spans outside the math schema across reloads: %s', (attribute) => {
    let source = `<span ${attribute}>outer <span>inner</span> [link](https://example.com) **bold**</span>`
    for (let round = 0; round < 3; round++) {
      const e = make(source)
      expect(math(e)).toEqual([])
      expect(e.getJSON().content?.[0]?.content).toEqual([
        { type: 'text', text: 'outer inner ' },
        {
          type: 'text',
          text: 'link',
          marks: [{ type: 'enhancedLink', attrs: { href: 'https://example.com', title: null } }]
        },
        { type: 'text', text: ' ' },
        { type: 'text', text: 'bold', marks: [{ type: 'bold' }] }
      ])
      expect(e.getMarkdown()).toBe('outer inner [link](https://example.com) **bold**')
      e.state.doc.check()
      source = e.getMarkdown()
    }
  })

  it.each([
    ...[' ', '\t', '\n', '\r', '\f'].map((space) => [
      `<span title="x" data-type="inline-math"${space}data-latex="c">outer <span>inner</span></span>`,
      'c'
    ]),
    ['<span\tdata-type="inline-math"\ndata-latex="c">c</span>', 'c'],
    ['<span title="a\u00a0b" data-type="inline-math" data-latex="a\u00a0b"><span>c</span></span>', 'a\u00a0b'],
    [
      '<span title=a\u00a0data-type="ordinary" data-type="inline-math" data-latex="a\u00a0b"><span>c</span></span>',
      'a\u00a0b'
    ]
  ])('uses only HTML ASCII whitespace for attribute boundaries: %s', (input, latex) => {
    const dom = new DOMParser().parseFromString(input, 'text/html').querySelector('span')
    expect(dom?.getAttribute('data-type')).toBe('inline-math')
    expect(dom?.getAttribute('data-latex')).toBe(latex)
    let source = input
    for (let round = 0; round < 3; round++) {
      const e = make(source)
      expect(math(e).map((node) => [node.type, node.attrs?.latex])).toEqual([['inlineMath', latex]])
      expect(e.getMarkdown()).toBe(`$${latex}$`)
      e.state.doc.check()
      source = e.getMarkdown()
    }
  })

  it.each([
    'data-type="inline-math" data-type="ordinary"',
    'data-type="inline&#45;math"',
    'data-type="inline&#x2D;math"',
    'data-type="inline&#45math"',
    "data-type='inline&#x2d;math'",
    'data-type=inline&#45;math',
    'title="data-type=ordinary" data-type="inline&#45;math"'
  ])('uses the first DOM-decoded math type across reloads: %s', (attributes) => {
    let source = `<span ${attributes} data-latex="c">outer <span>inner</span> [link](https://example.com) **bold**</span>`
    expect(new DOMParser().parseFromString(source, 'text/html').querySelector('span')?.getAttribute('data-type')).toBe(
      'inline-math'
    )
    for (let round = 0; round < 3; round++) {
      const e = make(source)
      expect(math(e).map((node) => [node.type, node.attrs?.latex])).toEqual([['inlineMath', 'c']])
      expect(e.state.doc.textContent).toBe('')
      expect(e.getMarkdown()).toBe('$c$')
      e.state.doc.check()
      source = e.getMarkdown()
    }
  })

  it.each([false, true])(
    'pairs nested math spans with an ordinary wrapper=%s and retains source metadata',
    (wrapped) => {
      const raw = String.raw`\[ a \]`
      const span = `<span data-type="inline-math" data-latex="a" data-math-delimiter="bracket" data-math-source="${raw}" data-math-source-latex="a"><span>a</span></span>`
      let source = wrapped ? `<span>outer ${span} [link](https://example.com) **bold**</span>` : span
      for (let round = 0; round < 3; round++) {
        const e = make(source)
        expect(math(e)).toEqual([
          { type: 'inlineMath', attrs: { latex: 'a', delimiter: 'bracket', markdownSource: { raw, latex: 'a' } } }
        ])
        expect(e.getHTML()).toContain('data-math-delimiter="bracket"')
        expect(e.getHTML()).toContain(`data-math-source="${raw}"`)
        expect(e.getHTML()).toContain('data-math-source-latex="a"')
        expect(e.getMarkdown()).toBe(wrapped ? `outer ${raw} [link](https://example.com) **bold**` : raw)
        e.state.doc.check()
        source = e.getMarkdown()
      }
    }
  )

  it('retains block math HTML and its source metadata across reloads', () => {
    const raw = String.raw`\[
b
\]`
    let source = `<div data-type="block-math" data-latex="b" data-math-delimiter="bracket" data-math-source="${raw}" data-math-source-latex="b"><div>b</div></div>`
    for (let round = 0; round < 3; round++) {
      const e = make(source)
      expect(math(e)).toEqual([
        { type: 'blockMath', attrs: { latex: 'b', delimiter: 'bracket', markdownSource: { raw, latex: 'b' } } }
      ])
      const element = new DOMParser()
        .parseFromString(e.getHTML(), 'text/html')
        .querySelector('div[data-type="block-math"]')
      expect(element?.getAttribute('data-math-delimiter')).toBe('bracket')
      expect(element?.getAttribute('data-math-source')).toBe(raw)
      expect(element?.getAttribute('data-math-source-latex')).toBe('b')
      expect(e.getMarkdown()).toBe(raw)
      e.state.doc.check()
      source = e.getMarkdown()
    }
  })

  // Ordinary wrappers must leave Markdown after a child math span available to the lexer.
  it.each([
    ['[link](https://example.com)', 'enhancedLink', 'link'],
    ['**bold**', 'bold', 'bold']
  ])('retains %s after a math span inside an ordinary span', (markdown, mark, text) => {
    let source = `Z <span>outer <span data-type="inline-math" data-latex="a">a</span> ${markdown}</span> Q`
    for (let round = 0; round < 3; round++) {
      const e = make(source)
      expect(math(e).map((n) => [n.type, n.attrs?.latex])).toEqual([['inlineMath', 'a']])
      expect(e.getJSON().content).toHaveLength(1)
      expect(e.state.doc.textContent).toBe(`Z outer  ${text} Q`)
      expect(e.getJSON().content?.[0]?.content).toContainEqual(
        expect.objectContaining({
          text,
          marks: [
            expect.objectContaining({
              type: mark,
              ...(mark === 'enhancedLink' ? { attrs: { href: 'https://example.com', title: null } } : {})
            })
          ]
        })
      )
      source = e.getMarkdown()
      expect(source).toBe(`Z outer $a$ ${markdown} Q`)
    }
  })

  it.each([
    ['<span><span data-type="inline-math" data-latex="a">a</span></span>', '$a$', ''],
    ['<span data-type="inline-math" data-latex="a"/> tail', '$a$ tail', ' tail']
  ])('retains math spans and adjacent text over two reloads: %s', (input, expected, text) => {
    let source = input
    for (let round = 0; round < 3; round++) {
      const e = make(source)
      expect(math(e).map((n) => [n.type, n.attrs?.latex])).toEqual([['inlineMath', 'a']])
      expect(e.getJSON().content).toHaveLength(1)
      expect(e.state.doc.textContent).toBe(text)
      source = e.getMarkdown()
      expect(source).toBe(expected)
    }
  })

  it('keeps math spans next to ordinary spans in a valid inline fragment', () => {
    const formulaEditor = make(String.raw`\[a\]`)
    const formula = math(formulaEditor)[0]
    const html = formulaEditor.getHTML().replace(/^<p>|<\/p>$/g, '')
    let source = `<span><span>before</span>${html}</span><span>after</span>`
    for (let round = 0; round < 3; round++) {
      const e = make(source)
      expect(math(e)).toEqual([formula])
      expect(e.state.doc.textContent).toBe('beforeafter')
      expect(e.getJSON().content).toHaveLength(1)
      source = e.getMarkdown()
      expect(source).toBe(String.raw`before\[a\]after`)
    }
  })

  // Nested spans used to truncate HTML fragments and discard the math source attributes.
  it.each([
    [
      { type: 'text', text: 'a' },
      { type: 'text', text: '*', marks: [{ type: 'bold' }] }
    ],
    [
      { type: 'text', text: 'word' },
      { type: 'text', text: '_', marks: [{ type: 'bold' }] }
    ],
    [
      { type: 'text', text: 'a' },
      { type: 'text', text: '_', marks: [{ type: 'italic' }] }
    ]
  ])('preserves source metadata and bytes in emphasis HTML fallback: %j', (...prefix) => {
    const e = make(String.raw`\[a\]`)
    const formula = math(e)[0]
    e.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [...prefix, formula] }] })
    const first = e.getMarkdown()
    expect(first).toContain('<span>')
    for (let round = 0; round < 2; round++) {
      const loaded = make(first)
      expect(math(loaded)).toEqual([formula])
      expect(loaded.getMarkdown()).toBe(first)
    }
  })

  it.each([String.raw`\[a\]`, '$a$'])('keeps markdown attribute defaults: %s', (source) => {
    const e = make(source)
    expect(math(e)[0]?.attrs).toEqual(
      source.startsWith('$')
        ? { latex: 'a', delimiter: null, markdownSource: null }
        : { latex: 'a', delimiter: 'bracket', markdownSource: { raw: source, latex: 'a' } }
    )
  })

  it('preserves only LF-normalized raw and stops exactly at the block closer', () => {
    const e = make('\\[\r\na\r\n\\]tail')
    expect(math(e)[0]?.attrs?.markdownSource.raw).toBe('\\[\na\n\\]')
    expect(e.state.doc.lastChild?.textContent).toBe('tail')
  })

  it.each([
    ['$ a $', '$a$'],
    ['$a\nb$', '$a\nb$'],
    ['$a$$b$', '$a\n$$b$'],
    ['$$ a $$', '$$\na\n$$'],
    ['$$\na\nb\n$$', '$$\na\nb\n$$'],
    ['$ a', '$ a'],
    ['$$ a', '$$ a']
  ])('keeps existing dollar parsing and serialization: %s', (source, saved) => {
    const e = make(source)
    expect(e.getMarkdown()).toBe(saved)
    e.state.doc.check()
  })
})

// Closing delimiters in Marked-owned spans must never consume the surrounding text as math.
describe('Marked protected math boundaries', () => {
  it.each([
    ['autolink', String.raw`\[x] <https://example.com/\]>`, 'https://example.com/\\]', ''],
    ['html anchor', String.raw`\[x] <a href="https://example.com/\]">hi</a>`, 'hi', ''],
    ['adjacent autolink', String.raw`\[x] <https://example.com/\]>\[c\]`, 'https://example.com/\\]', String.raw`\[c\]`]
  ])('preserves %s through two reloads', (name, input, label, tail) => {
    let source = input
    const observations: Array<{ round: number; nodes: JSONContent[] | undefined; saved: string; bytes: string; check: string }> = []
    for (let round = 0; round < 3; round++) {
      const e = make(source)
      const href = round === 0 ? 'https://example.com/\\]' : 'https://example.com/]'
      expect(e.getJSON().content?.[0]?.content).toContainEqual({
        type: 'text',
        text: label,
        marks: [{ type: 'enhancedLink', attrs: { href, title: null } }]
      })
      const formulas: string[] = []
      e.state.doc.descendants((node) => {
        if (node.type.name === 'inlineMath') formulas.push(node.attrs.latex)
      })
      expect(formulas).toEqual(tail ? ['c'] : [])
      e.state.doc.check()
      source = e.getMarkdown()
      const escapedLabel = label.replace(/\\/g, '\\\\').replace(/]/g, '\\]')
      expect(source).toBe(`\\[x] [${escapedLabel}](${href})${tail}`)
      observations.push({
        round,
        nodes: e.getJSON().content,
        saved: source,
        bytes: Buffer.from(source).toString('hex'),
        check: 'passed'
      })
    }
    process.stdout.write(`Marked boundary contract: ${JSON.stringify({ name, input, observations })}\n`)
  })

  it.each([
    [String.raw`\[x] <!-- \] --> \[c\]`, String.raw`\[x]  \[c\]`],
    [String.raw`\[x] <img alt="\]" /> \[c\]`, String.raw`\[x]  \[c\]`]
  ])('protects HTML syntax that the editor discards: %s', (input, saved) => {
    let source = input
    for (let round = 0; round < 3; round++) {
      const e = make(source)
      expect(e.state.doc.textContent).toBe('[x]  ')
      expect(e.getJSON().content?.[0]?.content?.map(asNode).at(-1)?.attrs?.latex).toBe('c')
      e.state.doc.check()
      source = e.getMarkdown()
      expect(source).toBe(saved)
    }
  })

  it('uses the closer in an invalid space-containing link destination', () => {
    const input = String.raw`\[a] [b](a b \] end)`
    let source = input
    for (let round = 0; round < 3; round++) {
      const e = make(source)
      expect(e.getJSON().content?.[0]?.content?.map(asNode).map((node) => node.attrs?.latex ?? node.text)).toEqual([
        'a] [b](a b',
        ' end)'
      ])
      expect(e.state.doc.textContent).toBe(' end)')
      e.state.doc.check()
      source = e.getMarkdown()
      expect(source).toBe(input)
    }
  })

  it.each([
    [
      '\\[a] [first \\]\nsecond][id] \\[c\\]\n\n[id]: /url',
      '\\[a] [first \\]\nsecond](/url) \\[c\\]',
      'first ]\nsecond',
      '/url'
    ],
    ['\\[a] `first \\]\nsecond`\\[c\\]', '\\[a] `first \\] second`\\[c\\]', 'first \\] second', null]
  ])('preserves reference links and adjacent multiline code: %s', (input, saved, text, href) => {
    let source = input
    for (let round = 0; round < 3; round++) {
      const e = make(source)
      expect(e.getJSON().content?.[0]?.content).toContainEqual({
        type: 'text',
        text,
        marks: href ? [{ type: 'enhancedLink', attrs: { href, title: null } }] : [{ type: 'code' }]
      })
      expect(e.getJSON().content?.[0]?.content?.map(asNode).at(-1)?.attrs?.latex).toBe('c')
      e.state.doc.check()
      source = e.getMarkdown()
      expect(source).toBe(saved)
    }
  })
})

it('keeps reference definitions current when reusing a Marked instance and source suffix', () => {
  const e = make('')
  for (const href of ['/first', '/second', '/first']) {
    e.commands.setContent(String.raw`\[a] [first \] second][id] \[c\]` + `\n\n[id]: ${href}`, {
      contentType: 'markdown'
    })
    expect(e.getJSON().content?.[0]?.content).toContainEqual({
      type: 'text',
      text: 'first ] second',
      marks: [{ type: 'enhancedLink', attrs: { href, title: null } }]
    })
    expect(e.getJSON().content?.[0]?.content?.map(asNode).at(-1)?.attrs?.latex).toBe('c')
    e.state.doc.check()
  }
})

// Mask probe: additional inline lexing was 0 calls for \[a\], 1 for \[a\] `x` (impl-33-probe.log).
it.each([String.raw`\[a\]`, String.raw`\[a\] ` + '`x`'])(
  'keeps math with and without protected syntax: %s',
  (input) => {
    const e = make(input)
    expect(e.getJSON().content?.[0]?.content?.[0]).toEqual({
      type: 'inlineMath',
      attrs: { latex: 'a', delimiter: 'bracket', markdownSource: { raw: String.raw`\[a\]`, latex: 'a' } }
    })
    expect(e.getMarkdown()).toBe(input)
    if (input.includes('`')) {
      expect(e.getJSON().content?.[0]?.content?.at(-1)).toEqual({ type: 'text', text: 'x', marks: [{ type: 'code' }] })
    }
  }
)
