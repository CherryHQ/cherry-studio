// @vitest-environment jsdom

import JSZip from 'jszip'
import MarkdownIt from 'markdown-it'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'

import type { DocumentBlock, DocumentTextRun } from '../documentModel'
import { convertDocx } from '../docx'
import { prepareStaticHtml } from '../html'
import { extractHtmlDocument } from '../htmlDocument'
import { parseMarkdown } from '../parseMarkdown'
import { convertPptx } from '../pptx'
import { documentToHtml, documentToMarkdown } from '../serializeDocument'

afterEach(() => {
  document.body.innerHTML = ''
})

function listShape(block: DocumentBlock) {
  if (block.type === 'columns') return { type: block.type }
  return {
    type: block.type,
    ...('text' in block ? { text: block.text } : {}),
    ...('rows' in block ? { rows: block.rows } : {}),
    ...('source' in block ? { source: block.source } : {}),
    bullet: 'bullet' in block ? block.bullet : undefined,
    orderedNumber: 'orderedNumber' in block ? block.orderedNumber : undefined,
    listDepth: 'listDepth' in block ? block.listDepth : undefined
  }
}

const nestedSource = `10. Parent

    ![chart](chart.png)

    More parent

    | A | B |
    | --- | --- |
    | 1 | 2 |

    \`\`\`
    line
    \`\`\`

    1. Child

        Child paragraph

11. Next

Outside

![plain](plain.png)

- Separate
`

const nestedShape = [
  { type: 'text', text: 'Parent', bullet: 1, orderedNumber: 10, listDepth: 1 },
  { type: 'image', text: 'chart', source: 'chart.png', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
  { type: 'text', text: 'More parent', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
  {
    type: 'table',
    rows: [
      ['A', 'B'],
      ['1', '2']
    ],
    bullet: undefined,
    orderedNumber: undefined,
    listDepth: 1
  },
  { type: 'code', text: 'line\n', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
  { type: 'text', text: 'Child', bullet: 2, orderedNumber: 1, listDepth: 2 },
  { type: 'text', text: 'Child paragraph', bullet: undefined, orderedNumber: undefined, listDepth: 2 },
  { type: 'text', text: 'Next', bullet: 1, orderedNumber: 11, listDepth: 1 },
  { type: 'text', text: 'Outside', bullet: undefined, orderedNumber: undefined, listDepth: undefined },
  {
    type: 'image',
    text: 'plain',
    source: 'plain.png',
    bullet: undefined,
    orderedNumber: undefined,
    listDepth: undefined
  },
  { type: 'text', text: 'Separate', bullet: 1, orderedNumber: undefined, listDepth: 1 }
]

describe('list container membership', () => {
  it('keeps nested images, tables, code, and continuation paragraphs inside the parent item', () => {
    const blocks = parseMarkdown(nestedSource)
    expect(blocks.map(listShape)).toEqual(nestedShape)

    const markdown = documentToMarkdown(blocks, (source) => source)
    expect(markdown).toContain('10. Parent')
    expect(markdown).toContain('\n    ![chart](<chart.png>)')
    expect(markdown).toContain('\n    More parent')
    expect(markdown).toContain('\n    | A | B |')
    expect(markdown).toContain('\n    ```')
    expect(markdown).toContain('\n    1. Child')
    expect(markdown).toContain('\n       Child paragraph')
    expect(markdown).toContain('\n11. Next')
    expect(markdown).toContain('\nOutside')
    expect(markdown).not.toContain('\n    Outside')
    expect(blocks.map(listShape)).toEqual(parseMarkdown(markdown).map(listShape))

    const html = documentToHtml(blocks, (source) => source, 'Nested')
    const body = new DOMParser().parseFromString(html, 'text/html').body
    const outer = body.querySelector('ol')
    expect(outer?.getAttribute('start')).toBe('10')
    const items = [...(outer?.children ?? [])]
    expect(items.map((item) => item.tagName)).toEqual(['LI', 'LI'])
    expect(items[0]?.textContent).toContain('Parent')
    expect(items[0]?.textContent).toContain('More parent')
    expect(items[0]?.querySelector('img')?.getAttribute('alt')).toBe('chart')
    expect(items[0]?.querySelector('table')?.textContent).toContain('A')
    expect(items[0]?.querySelector('pre')?.textContent).toContain('line')
    const child = items[0]?.querySelector('ol')
    expect(child?.getAttribute('start')).toBe('1')
    expect(child?.parentElement?.tagName).toBe('LI')
    expect(child?.textContent).toContain('Child paragraph')
    expect(items[1]?.textContent).toContain('Next')
    expect(items[1]?.querySelector('ol, ul')).toBeNull()
    const after = [...body.children].slice(1).map((element) => element.tagName)
    expect(after).toEqual(['P', 'P', 'UL'])
    expect(body.querySelector('ul')?.textContent).toContain('Separate')
    expect(body.querySelector('ul img')).toBeNull()
  })

  it('keeps a following list outside a standalone paragraph and image', () => {
    const markdown = 'Standalone\n\n![plain](plain.png)\n\n- First\n\nAnother\n\n- Second\n'
    const blocks = parseMarkdown(markdown)
    expect(blocks.map(listShape)).toEqual([
      { type: 'text', text: 'Standalone', bullet: undefined, orderedNumber: undefined, listDepth: undefined },
      {
        type: 'image',
        text: 'plain',
        source: 'plain.png',
        bullet: undefined,
        orderedNumber: undefined,
        listDepth: undefined
      },
      { type: 'text', text: 'First', bullet: 1, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Another', bullet: undefined, orderedNumber: undefined, listDepth: undefined },
      { type: 'text', text: 'Second', bullet: 1, orderedNumber: undefined, listDepth: 1 }
    ])
    const html = documentToHtml(blocks, (source) => source, 'Outside')
    const body = new DOMParser().parseFromString(html, 'text/html').body
    expect([...body.children].map((element) => element.tagName)).toEqual(['P', 'P', 'UL', 'P', 'UL'])
    expect(body.querySelectorAll('ul')).toHaveLength(2)
  })

  it('marks an image-only item and keeps the next child at that depth', () => {
    const markdown = '- Parent\n  - ![only](only.png)\n  - Next\n'
    const blocks = parseMarkdown(markdown)
    expect(blocks.map(listShape)).toEqual([
      { type: 'text', text: 'Parent', bullet: 1, orderedNumber: undefined, listDepth: 1 },
      { type: 'image', text: 'only', source: 'only.png', bullet: 2, orderedNumber: undefined, listDepth: 2 },
      { type: 'text', text: 'Next', bullet: 2, orderedNumber: undefined, listDepth: 2 }
    ])
    expect(parseMarkdown(documentToMarkdown(blocks, (source) => source)).map(listShape)).toEqual(blocks.map(listShape))
    expect(parseMarkdown('2. ![only](only.png)\n').map(listShape)).toEqual([
      { type: 'image', text: 'only', source: 'only.png', bullet: 1, orderedNumber: 2, listDepth: 1 }
    ])
  })
})

describe('HTML list parent content', () => {
  it('accumulates inline parent content into one item before a nested list', async () => {
    document.body.innerHTML = '<ul><li>Hello <strong>world</strong><ul><li>Child</li></ul></li></ul>'
    const { blocks } = extractHtmlDocument()
    const texts = blocks.filter((block) => block.type === 'text')
    expect(texts.map(listShape)).toEqual([
      { type: 'text', text: 'Hello world', bullet: 1, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Child', bullet: 2, orderedNumber: undefined, listDepth: 2 }
    ])
    expect(texts[0]?.type === 'text' && texts[0].runs?.some((run) => run.text.includes('world') && run.bold)).toBe(true)
    expect(texts).toHaveLength(2)

    const html = documentToHtml(blocks, (source) => source, 'Parent')
    const body = new DOMParser().parseFromString(html, 'text/html').body
    const topItems = body.querySelectorAll('body > ul > li')
    expect(topItems).toHaveLength(1)
    expect(topItems[0]?.textContent).toContain('Hello world')
    expect(topItems[0]?.querySelector('ul > li')?.textContent).toContain('Child')
    expect(parseMarkdown(documentToMarkdown(blocks, (source) => source)).map(listShape)).toEqual(texts.map(listShape))

    const word = await JSZip.loadAsync(await convertDocx(blocks, new Map(), 'Parent'))
    const documentXml = await word.file('word/document.xml')!.async('string')
    const paragraphs = [...documentXml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map((match) => match[0])
    const listed = paragraphs.flatMap((paragraph) => {
      const text = [...paragraph.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((part) => part[1]).join('')
      if (!text.trim()) return []
      return [{ text, ilvl: paragraph.match(/<w:ilvl w:val="(\d+)"/)?.[1] }]
    })
    expect(listed.map((item) => item.text)).toEqual(['Hello world', 'Child'])
    expect(Number(listed[1]?.ilvl)).toBeGreaterThan(Number(listed[0]?.ilvl))
  })

  it('treats a later paragraph as a continuation of the same item', () => {
    document.body.innerHTML = '<ul><li><p>Parent</p><p>More</p><ul><li>Child</li></ul></li></ul>'
    const { blocks } = extractHtmlDocument()
    expect(blocks.filter((block) => block.type === 'text').map(listShape)).toEqual([
      { type: 'text', text: 'Parent', bullet: 1, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'More', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Child', bullet: 2, orderedNumber: undefined, listDepth: 2 }
    ])
    const body = new DOMParser().parseFromString(
      documentToHtml(blocks, (source) => source, 'Continue'),
      'text/html'
    ).body
    const topItems = body.querySelectorAll('body > ul > li')
    expect(topItems).toHaveLength(1)
    expect(topItems[0]?.textContent).toContain('Parent')
    expect(topItems[0]?.textContent).toContain('More')
    expect(topItems[0]?.querySelector(':scope > ul > li')?.textContent).toContain('Child')
  })
})

describe('adjacent emphasis serialization', () => {
  it.each([
    ['<p><em>Alpha</em><em>Beta</em></p>', { italic: true }],
    ['<p><strong>Alpha</strong><strong>Beta</strong></p>', { bold: true }],
    ['<p><em>Alpha</em><strong>Beta</strong></p>', { italic: true, bold: true }]
  ])('serializes %s without literal emphasis markers', (html, marks) => {
    document.body.innerHTML = html
    const parsed = parseMarkdown(documentToMarkdown(extractHtmlDocument().blocks, (source) => source))
    expect(parsed).toMatchObject([{ type: 'text', text: 'AlphaBeta' }])
    expect(JSON.stringify(parsed)).not.toContain('**')
    const block = parsed[0]
    if (block?.type !== 'text') throw new Error('expected text')
    expect(block.runs?.map((run) => run.text).join('')).toBe('AlphaBeta')
    if ('italic' in marks && 'bold' in marks) {
      expect(block.runs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: 'Alpha', italic: true }),
          expect.objectContaining({ text: 'Beta', bold: true })
        ])
      )
    } else {
      const runs = (block.runs ?? []).filter((run) => run.text.length > 0)
      expect(runs.map((run) => run.text).join('')).toBe('AlphaBeta')
      for (const run of runs) {
        expect(run.text).not.toMatch(/[*~]/)
        if (run.text.trim()) expect(run).toMatchObject(marks)
      }
    }
  })

  it.each([
    [{ italic: true }, { italic: true }],
    [{ bold: true }, { bold: true }],
    [{ strike: true }, { strike: true }],
    [
      { bold: true, italic: true },
      { bold: true, italic: true }
    ]
  ])('joins compatible runs without literal delimiter text: %j + %j', (left, right) => {
    const parsed = parseMarkdown(
      documentToMarkdown(
        [
          {
            type: 'text',
            text: 'AlphaBeta',
            runs: [
              { text: 'Alpha', ...left },
              { text: 'Beta', ...right }
            ]
          }
        ],
        (source) => source
      )
    )
    expect(parsed).toMatchObject([{ type: 'text', text: 'AlphaBeta' }])
    const block = parsed[0]
    if (block?.type !== 'text') throw new Error('expected text')
    const runs = (block.runs ?? []).filter((run) => run.text.length > 0)
    expect(runs.map((run) => run.text).join('')).toBe('AlphaBeta')
    for (const run of runs) {
      expect(run.text).not.toMatch(/[*~]/)
      if (run.text.trim()) expect(run).toMatchObject(left)
    }
  })

  it('omits unsupported links without leaving literal emphasis between the same style', () => {
    const parsed = parseMarkdown(
      documentToMarkdown(
        [
          {
            type: 'text',
            text: 'AlphaBeta',
            runs: [
              { text: 'Alpha', italic: true, link: 'javascript:alert(1)' },
              { text: 'Beta', italic: true, link: '/relative' }
            ]
          }
        ],
        (source) => source
      )
    )
    expect(parsed).toMatchObject([{ type: 'text', text: 'AlphaBeta' }])
    const block = parsed[0]
    if (block?.type !== 'text') throw new Error('expected text')
    const runs = (block.runs ?? []).filter((run) => run.text.length > 0)
    expect(runs.map((run) => run.text).join('')).toBe('AlphaBeta')
    for (const run of runs) {
      expect(run.text).not.toMatch(/[*]/)
      expect(run.link).toBeUndefined()
      if (run.text.trim()) expect(run.italic).toBe(true)
    }
  })

  it('keeps emphasis across style transitions and preserves whitespace and escapes', () => {
    const parsed = parseMarkdown(
      documentToMarkdown(
        [
          {
            type: 'text',
            text: '',
            runs: [
              { text: 'Alpha', bold: true },
              { text: 'Beta', italic: true },
              { text: 'Gamma', strike: true }
            ]
          },
          {
            type: 'text',
            text: '',
            runs: [
              { text: 'A&', italic: true },
              { text: 'B', italic: true }
            ]
          },
          {
            type: 'text',
            text: '',
            runs: [{ text: 'Keep', bold: true }, { text: '  ' }, { text: 'space', italic: true }]
          }
        ],
        (source) => source
      )
    )
    expect(parsed.map((block) => (block.type === 'text' ? block.text : ''))).toEqual([
      'AlphaBetaGamma',
      'A&B',
      'Keep  space'
    ])
    expect(parsed[0]).toMatchObject({
      runs: expect.arrayContaining([
        expect.objectContaining({ text: 'Alpha', bold: true }),
        expect.objectContaining({ text: 'Beta', italic: true }),
        expect.objectContaining({ text: 'Gamma', strike: true })
      ])
    })
    expect(parsed[1]).toMatchObject({ runs: [expect.objectContaining({ text: 'A&B', italic: true })] })
    expect(parsed[2]).toMatchObject({
      runs: expect.arrayContaining([
        expect.objectContaining({ text: 'Keep', bold: true }),
        expect.objectContaining({ text: 'space', italic: true })
      ])
    })
  })

  it('splits prepared pre-wrap paragraph boundaries before styled Markdown wrapping', async () => {
    const source = '<p style="white-space:pre-wrap;font-weight:bold">First\n\nSecond</p>'
    const prepared = await prepareStaticHtml(source, {})
    expect(prepared.html).toContain('First')
    document.body.innerHTML = prepared.html
    const blocks = extractHtmlDocument().blocks
    const sourceRun = blocks
      .flatMap((block) => ('runs' in block ? (block.runs ?? []) : []))
      .find((run) => run.text.includes('First'))
    expect(sourceRun?.text).toContain('First')
    expect(sourceRun?.text).toContain('Second')
    expect(sourceRun?.bold).toBe(true)

    const markdown = documentToMarkdown(blocks, (source) => source)
    const parsed = parseMarkdown(markdown)
    expect(
      parsed.filter((block) => block.type === 'text').map((block) => (block.type === 'text' ? block.text : ''))
    ).toEqual(['First', 'Second'])
    for (const block of parsed) {
      if (block.type !== 'text') continue
      expect(block.runs?.some((run) => run.text.includes('First') || run.text.includes('Second'))).toBe(true)
      for (const run of block.runs ?? []) {
        if (run.text.trim()) expect(run.bold).toBe(true)
        expect(run.text).not.toMatch(/\*\*/)
      }
    }
  })

  it('splits blank lines inside and across styled runs without splitting a soft break', () => {
    const cases: Array<{ runs: DocumentTextRun[]; texts: string[]; marks: Array<Partial<DocumentTextRun>> }> = [
      {
        runs: [{ text: 'First\r\n \r\nSecond', bold: true, italic: true, strike: true }],
        texts: ['First', 'Second'],
        marks: [
          { bold: true, italic: true, strike: true },
          { bold: true, italic: true, strike: true }
        ]
      },
      {
        runs: [
          { text: 'First\n', bold: true },
          { text: '\nSecond', italic: true }
        ],
        texts: ['First', 'Second'],
        marks: [{ bold: true }, { italic: true }]
      },
      {
        runs: [
          { text: 'First\n\n', bold: true, link: 'https://example.com/a' },
          { text: 'Second', bold: true, link: 'https://example.com/a' }
        ],
        texts: ['First', 'Second'],
        marks: [
          { bold: true, link: 'https://example.com/a' },
          { bold: true, link: 'https://example.com/a' }
        ]
      },
      {
        runs: [{ text: 'First\nSecond', bold: true }],
        texts: ['First\nSecond'],
        marks: [{ bold: true }]
      },
      {
        runs: [{ text: 'First\n\u00a0\nSecond', bold: true }],
        texts: ['First\n\u00a0\nSecond'],
        marks: [{ bold: true }]
      }
    ]
    for (const item of cases) {
      const markdown = documentToMarkdown([{ type: 'text', text: '', runs: item.runs }], (source) => source)
      const parsed = parseMarkdown(markdown).filter((block) => block.type === 'text')
      expect(parsed.map((block) => (block.type === 'text' ? block.text : ''))).toEqual(item.texts)
      parsed.forEach((block, index) => {
        if (block.type !== 'text') return
        const visible = (block.runs ?? []).filter((run) => run.text.trim())
        expect(visible.length).toBeGreaterThan(0)
        for (const run of visible) {
          expect(run).toMatchObject(item.marks[index] ?? {})
          expect(run.text).not.toMatch(/\*\*|~~/)
        }
      })
    }
  })

  it('keeps bold-to-italic punctuation, strike punctuation, and emoji through Markdown reimport', () => {
    const cases = [
      [{ text: 'pre' }, { text: 'word', bold: true }, { text: '(punct)', italic: true }, { text: 'post' }],
      [{ text: 'pre' }, { text: 'word' }, { text: '(punct)', strike: true }, { text: 'post' }],
      [{ text: 'pre' }, { text: '😀' }, { text: '(punct)', bold: true }, { text: 'post' }]
    ]
    for (const runs of cases) {
      const markdown = documentToMarkdown([{ type: 'text', text: '', runs }], (source) => source)
      const parsed = parseMarkdown(markdown)
      const output = parsed.flatMap((block) => ('runs' in block ? (block.runs ?? []) : []))
      const visible = (value: { text: string; bold?: boolean; italic?: boolean; strike?: boolean }[]) =>
        value.flatMap((run) =>
          [...run.text]
            .filter((char) => !/\s/u.test(char))
            .map((char) => ({ char, bold: !!run.bold, italic: !!run.italic, strike: !!run.strike }))
        )
      expect(visible(output)).toEqual(visible(runs))
      expect(markdown).not.toContain('\u200b')
      expect(markdown).not.toContain('<strong>')
    }
  })

  it('keeps punctuation-bound emphasis as styled text after Markdown reimport', () => {
    const markdown = documentToMarkdown(
      [
        {
          type: 'text',
          text: 'before(bold)after',
          runs: [{ text: 'before' }, { text: '(bold)', bold: true }, { text: 'after' }]
        },
        {
          type: 'text',
          text: 'before(italic)after',
          runs: [{ text: 'before' }, { text: '(italic)', italic: true }, { text: 'after' }]
        },
        {
          type: 'text',
          text: 'bolditalic',
          runs: [
            { text: 'bold', bold: true },
            { text: 'italic', italic: true }
          ]
        },
        {
          type: 'text',
          text: 'before(styled)after',
          runs: [{ text: 'before' }, { text: '(styled)', bold: true, italic: true, strike: true }, { text: 'after' }]
        },
        {
          type: 'text',
          text: 'see(docs)',
          runs: [{ text: 'see' }, { text: '(docs)', bold: true, link: 'https://example.org/docs' }, { text: 'now' }]
        },
        {
          type: 'table',
          title: '',
          rows: [['a | (cell)']],
          cells: [[{ runs: [{ text: 'a | ' }, { text: '(cell)', bold: true }] }]]
        }
      ],
      (source) => source
    )
    const rendered = new MarkdownIt({ html: false }).render(markdown)
    expect(rendered).toContain('<strong>(bold)</strong>')
    expect(rendered).toContain('<em>(italic)</em>')
    expect(rendered).toContain('<strong>bold</strong>')
    expect(rendered).toContain('<em>italic</em>')
    expect(rendered).toContain('(styled)')
    expect(rendered).not.toContain('**(')
    const parsed = parseMarkdown(markdown)
    expect(parsed.map((block) => (block.type === 'text' || block.type === 'table' ? block : {}))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: 'before(bold)after',
          runs: expect.arrayContaining([expect.objectContaining({ text: '(bold)', bold: true })])
        })
      ])
    )
    const blocks = parsed.filter((block) => block.type === 'text' || block.type === 'table')
    expect(blocks[0]).toMatchObject({ type: 'text', text: 'before(bold)after' })
    expect(blocks[1]).toMatchObject({
      type: 'text',
      text: 'before(italic)after',
      runs: expect.arrayContaining([expect.objectContaining({ text: '(italic)', italic: true })])
    })
    expect(blocks[2]).toMatchObject({
      runs: [
        expect.objectContaining({ text: 'bold', bold: true }),
        expect.objectContaining({ text: 'italic', italic: true })
      ]
    })
    expect(blocks[3]).toMatchObject({
      text: 'before(styled)after',
      runs: expect.arrayContaining([
        expect.objectContaining({ text: '(styled)', bold: true, italic: true, strike: true })
      ])
    })
    expect(blocks[4]).toMatchObject({
      text: 'see(docs)now',
      runs: expect.arrayContaining([
        expect.objectContaining({ text: '(docs)', bold: true, link: 'https://example.org/docs' })
      ])
    })
    expect(blocks[5]).toMatchObject({ type: 'table', rows: [['a | (cell)']] })
    const cellRuns = blocks[5].type === 'table' ? blocks[5].cells?.[0]?.[0]?.runs : undefined
    expect(cellRuns).toEqual(expect.arrayContaining([expect.objectContaining({ text: '(cell)', bold: true })]))
  })
})

describe('inline image order', () => {
  it('keeps a heading image between its surrounding text and consumes the list marker once', () => {
    const blocks = parseMarkdown('10. # **Before** ![chart](chart.png) *after*\n')
    expect(blocks.map(listShape)).toEqual([
      { type: 'heading', text: 'Before ', bullet: 1, orderedNumber: 10, listDepth: 1 },
      { type: 'image', text: 'chart', source: 'chart.png', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: ' after', bullet: undefined, orderedNumber: undefined, listDepth: 1 }
    ])
    expect(blocks[0]).toMatchObject({
      level: 1,
      runs: expect.arrayContaining([expect.objectContaining({ text: 'Before', bold: true })])
    })
    expect(blocks[2]).toMatchObject({
      runs: expect.arrayContaining([expect.objectContaining({ text: 'after', italic: true })])
    })
    expect(blocks.filter((block) => 'bullet' in block && block.bullet).map(listShape)).toEqual([
      { type: 'heading', text: 'Before ', bullet: 1, orderedNumber: 10, listDepth: 1 }
    ])
  })

  it('keeps an image between the text that surrounds it and inside its list item', async () => {
    const blocks = parseMarkdown('- **Before** ![chart](chart.png) *after*\n')
    expect(blocks.map(listShape)).toEqual([
      { type: 'text', text: 'Before ', bullet: 1, orderedNumber: undefined, listDepth: 1 },
      { type: 'image', text: 'chart', source: 'chart.png', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: ' after', bullet: undefined, orderedNumber: undefined, listDepth: 1 }
    ])
    expect(blocks[0]).toMatchObject({
      runs: expect.arrayContaining([expect.objectContaining({ text: 'Before', bold: true })])
    })
    expect(blocks[2]).toMatchObject({
      runs: expect.arrayContaining([expect.objectContaining({ text: 'after', italic: true })])
    })
    expect(parseMarkdown(documentToMarkdown(blocks, (source) => source)).map(listShape)).toEqual([
      { type: 'text', text: 'Before', bullet: 1, orderedNumber: undefined, listDepth: 1 },
      { type: 'image', text: 'chart', source: 'chart.png', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'after', bullet: undefined, orderedNumber: undefined, listDepth: 1 }
    ])

    document.body.innerHTML = '<p>Before <strong>styled</strong> <img alt="chart" src="chart.png"> <em>after</em></p>'
    const extracted = extractHtmlDocument().blocks
    expect(extracted.map(listShape)).toEqual([
      { type: 'text', text: 'Before styled', bullet: undefined, orderedNumber: undefined, listDepth: undefined },
      {
        type: 'image',
        text: 'chart',
        source: expect.stringContaining('chart.png'),
        bullet: undefined,
        orderedNumber: undefined,
        listDepth: undefined
      },
      { type: 'text', text: 'after', bullet: undefined, orderedNumber: undefined, listDepth: undefined }
    ])
    expect(extracted[0]).toMatchObject({
      runs: expect.arrayContaining([expect.objectContaining({ text: 'styled', bold: true })])
    })
    expect(extracted[2]).toMatchObject({
      runs: expect.arrayContaining([expect.objectContaining({ text: 'after', italic: true })])
    })

    const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
      .png()
      .toBuffer()
    const images = new Map([['chart.png', image]])
    const prose = parseMarkdown('**Before** ![chart](chart.png) *after*\n')
    const word = await JSZip.loadAsync(await convertDocx(prose, images, 'Order'))
    const documentXml = await word.file('word/document.xml')!.async('string')
    const before = documentXml.indexOf('>Before<')
    const drawing = documentXml.indexOf('<w:drawing')
    const after = documentXml.indexOf('>after<')
    expect(before).toBeGreaterThan(-1)
    expect(before).toBeLessThan(drawing)
    expect(drawing).toBeLessThan(after)

    const slides = await JSZip.loadAsync(await convertPptx(prose, images, 'Order'))
    const slideXml = (
      await Promise.all(
        Object.keys(slides.files)
          .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
          .sort()
          .map((name) => slides.file(name)!.async('string'))
      )
    ).join('\n')
    const slideStructure = slideXml.replace(/<p:pic[\s\S]*?<\/p:pic>/g, '<p:pic/>')
    const slideBefore = slideStructure.indexOf('>Before<')
    const slideImage = slideStructure.indexOf('<p:pic')
    const slideAfter = slideStructure.indexOf('>after<')
    expect(slideBefore).toBeGreaterThan(-1)
    expect(slideBefore).toBeLessThan(slideImage)
    expect(slideImage).toBeLessThan(slideAfter)
  })
})

describe('table images inside a list item', () => {
  function listTree(blocks: DocumentBlock[]) {
    const body = new DOMParser().parseFromString(
      documentToHtml(blocks, (source) => source, 'Tables'),
      'text/html'
    ).body
    const items = [...(body.querySelector('ol')?.children ?? [])]
    return {
      start: body.querySelector('ol')?.getAttribute('start'),
      items: items.map((item) => item.tagName),
      images: [...(items[0]?.querySelectorAll('img') ?? [])].map((image) => image.getAttribute('alt')),
      tableBeforeImage: (() => {
        const table = items[0]?.querySelector('table')
        const image = items[0]?.querySelector('img')
        return !!table && !!image && table.compareDocumentPosition(image) === Node.DOCUMENT_POSITION_FOLLOWING
      })(),
      more: items[0]?.textContent?.includes('More') ?? false,
      child: items[0]?.querySelector('ol')?.textContent?.includes('Child') ?? false,
      next: items[1]?.textContent?.includes('Next') ?? false,
      nextClosed: items[1]?.querySelector('table, img, ol') === null
    }
  }

  it('puts the ordered marker on a first-item table and continues cell images in that item', () => {
    const blocks = parseMarkdown(
      '10. | A ![lead](lead.png) | B |\n    | --- | --- |\n    | C ![trail](trail.png) | D |\n\n    More\n\n    1. Child\n\n11. Next\n'
    )
    expect(blocks.map(listShape)).toEqual([
      {
        type: 'table',
        rows: [
          ['A lead', 'B'],
          ['C trail', 'D']
        ],
        bullet: 1,
        orderedNumber: 10,
        listDepth: 1
      },
      { type: 'image', text: 'lead', source: 'lead.png', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'image', text: 'trail', source: 'trail.png', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'More', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Child', bullet: 2, orderedNumber: 1, listDepth: 2 },
      { type: 'text', text: 'Next', bullet: 1, orderedNumber: 11, listDepth: 1 }
    ])
    expect(listTree(blocks)).toEqual({
      start: '10',
      items: ['LI', 'LI'],
      images: ['lead', 'trail'],
      tableBeforeImage: true,
      more: true,
      child: true,
      next: true,
      nextClosed: true
    })
  })

  it('keeps a continuation table and its images inside the open item', () => {
    const blocks = parseMarkdown(
      '10. Parent\n\n    | A ![chart](chart.png) |\n    | --- |\n\n    More\n\n    1. Child\n\n11. Next\n'
    )
    expect(blocks.map(listShape)).toEqual([
      { type: 'text', text: 'Parent', bullet: 1, orderedNumber: 10, listDepth: 1 },
      {
        type: 'table',
        rows: [['A chart']],
        bullet: undefined,
        orderedNumber: undefined,
        listDepth: 1
      },
      { type: 'image', text: 'chart', source: 'chart.png', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'More', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Child', bullet: 2, orderedNumber: 1, listDepth: 2 },
      { type: 'text', text: 'Next', bullet: 1, orderedNumber: 11, listDepth: 1 }
    ])
    expect(listTree(blocks)).toEqual({
      start: '10',
      items: ['LI', 'LI'],
      images: ['chart'],
      tableBeforeImage: true,
      more: true,
      child: true,
      next: true,
      nextClosed: true
    })
  })
})

describe('HTML table width reduction', () => {
  it('pads every row to the longest row', () => {
    document.body.innerHTML = '<table><tr><td>A</td></tr><tr><td>B</td><td>C</td><td>D</td></tr></table>'
    const table = extractHtmlDocument().blocks[0]
    expect(table).toMatchObject({
      type: 'table',
      rows: [
        ['A', '', ''],
        ['B', 'C', 'D']
      ]
    })
  })
})
