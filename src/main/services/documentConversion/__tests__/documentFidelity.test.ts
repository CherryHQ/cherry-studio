import JSZip from 'jszip'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { printService } from '../../PrintService'
import { convertDocumentBundle } from '../convertDocument'
import type { DocumentBlock } from '../documentModel'
import { convertDocx } from '../docx'
import { normalizeDocumentImage } from '../imageAssets'
import { parseMarkdown } from '../parseMarkdown'
import { documentToMarkdown } from '../serializeDocument'

afterEach(() => vi.restoreAllMocks())

function wordRuns(xml: string) {
  return [...xml.matchAll(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g)].map((match) => {
    const run = match[0]
    const marked = (tag: 'b' | 'i') =>
      new RegExp(`<w:${tag}(?:\\s[^>]*?)?(?:/>|>)`).test(run) &&
      !new RegExp(`<w:${tag}[^>]*w:val="(?:0|false|off)"`).test(run)
    return {
      text: [...run.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((part) => part[1]).join(''),
      bold: marked('b'),
      italic: marked('i')
    }
  })
}

describe('document conversion fidelity', () => {
  const literals = [
    '# keep the hash',
    '1. not a list',
    '1) not a list',
    '- plain',
    '> quote',
    '---',
    '~~literal~~',
    '<b>example</b>',
    '&amp; &copy;',
    'line\n# heading'
  ]

  it.each(literals)('preserves literal document text through Markdown parsing: %s', (text) => {
    const markdown = documentToMarkdown([{ type: 'text', text }], (source) => source)
    const blocks = parseMarkdown(markdown, true, { interpretSafeHtml: true })
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ type: 'text', text })
    expect(blocks[0]).not.toHaveProperty('bullet')
    if ('runs' in blocks[0]) {
      expect(blocks[0].runs?.some((run) => run.bold || run.italic || run.strike || run.link)).toBe(false)
    }
  })

  it.each([false, true])('preserves literal table cells with explicit runs: %s', (withRuns) => {
    const value = String.raw`a | b \ &amp; <b>literal</b> ~~text~~`
    const block: DocumentBlock = {
      type: 'table',
      title: '',
      rows: [['Header'], [value]],
      ...(withRuns ? { cells: [[{ runs: [{ text: 'Header' }] }], [{ runs: [{ text: value }] }]] } : {})
    }
    const blocks = parseMarkdown(
      documentToMarkdown([block], (source) => source),
      true,
      { interpretSafeHtml: true }
    )
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ type: 'table', rows: [['Header'], [value]] })
  })

  it('preserves model headings, lists, explicit styles and raw code', () => {
    const source: DocumentBlock[] = [
      { type: 'heading', level: 2, text: '# Heading' },
      { type: 'text', text: '- List', bullet: 1, orderedNumber: 3 },
      { type: 'text', text: 'bold', runs: [{ text: 'bold', bold: true }] },
      { type: 'text', text: 'italic', runs: [{ text: 'italic', italic: true }] },
      { type: 'text', text: 'removed', runs: [{ text: 'removed', strike: true }] },
      { type: 'text', text: 'Link', runs: [{ text: 'Link', link: 'https://example.org/docs' }] },
      { type: 'code', text: '<b># literal &amp;</b>' }
    ]
    const blocks = parseMarkdown(
      documentToMarkdown(source, (image) => image),
      true,
      { interpretSafeHtml: true }
    )
    expect(blocks).toMatchObject([
      { type: 'heading', level: 2, text: '# Heading' },
      { type: 'text', text: '- List', bullet: 1, orderedNumber: 3 },
      { type: 'text', text: 'bold', runs: [{ text: 'bold', bold: true }] },
      { type: 'text', text: 'italic', runs: [{ text: 'italic', italic: true }] },
      { type: 'text', text: 'removed', runs: [{ text: 'removed', strike: true }] },
      { type: 'text', text: 'Link', runs: [{ text: 'Link', link: 'https://example.org/docs' }] },
      { type: 'code', text: '<b># literal &amp;</b>\n' }
    ])
  })

  describe.each([{ bold: true }, { italic: true }, { bold: true, italic: true }, { strike: true }])(
    'boundary whitespace with %j',
    (style) => {
      it.each(['Styled ', ' Styled', ' Styled '])('keeps text and emphasis for %j', (text) => {
        const blocks = parseMarkdown(
          documentToMarkdown(
            [{ type: 'text', text: '', runs: [{ text: 'before' }, { text, ...style }, { text: 'after' }] }],
            (source) => source
          )
        )
        expect(blocks).toHaveLength(1)
        expect(blocks[0]).toMatchObject({
          type: 'text',
          text: `before${text}after`,
          runs: expect.arrayContaining([expect.objectContaining({ text: 'Styled', ...style })])
        })
      })

      it('keeps a whitespace-only run free of formatting markers', () => {
        const blocks = parseMarkdown(
          documentToMarkdown(
            [{ type: 'text', text: '', runs: [{ text: 'before' }, { text: '  ', ...style }, { text: 'after' }] }],
            (source) => source
          )
        )
        expect(blocks).toMatchObject([{ type: 'text', text: 'before  after' }])
      })
    }
  )

  it('preserves styled table text with boundary whitespace', () => {
    const blocks = parseMarkdown(
      documentToMarkdown(
        [
          {
            type: 'table',
            title: '',
            rows: [['Header'], ['before Styled after']],
            cells: [
              [{ runs: [{ text: 'Header' }] }],
              [{ runs: [{ text: 'before' }, { text: ' Styled ', bold: true, italic: true }, { text: 'after' }] }]
            ]
          }
        ],
        (source) => source
      )
    )
    expect(blocks).toMatchObject([
      {
        type: 'table',
        rows: [['Header'], ['before Styled after']],
        cells: [
          [expect.anything()],
          [{ runs: expect.arrayContaining([expect.objectContaining({ text: 'Styled', bold: true, italic: true })]) }]
        ]
      }
    ])
  })

  it.each([
    'before\n```\n# literal heading\nafter',
    'before\n````\n# literal heading\n```\nafter',
    'before\n  `````  \n# literal heading\nafter',
    'inline `````` backticks\n```\nafter',
    '```'
  ])('preserves embedded fences in one code block: %j', (text) => {
    const blocks = parseMarkdown(documentToMarkdown([{ type: 'code', text }], (source) => source))
    expect(blocks).toMatchObject([{ type: 'code', text: `${text}\n` }])
    expect(blocks).toHaveLength(1)
  })

  it.each(['md', 'pdf'] as const)(
    'preserves Office emphasis with trailing whitespace at the %s boundary',
    async (format) => {
      const sourceBytes = await convertDocx(
        [{ type: 'text', text: 'Bold plain', runs: [{ text: 'Bold ', bold: true }, { text: 'plain' }] }],
        new Map(),
        'Report'
      )
      const print = vi.spyOn(printService, 'toDocumentPdfBuffer').mockResolvedValue(Buffer.from('%PDF'))
      const result = await convertDocumentBundle({ filePath: 'emphasis.docx', sourceBytes, format })
      const markdown = format === 'md' ? Buffer.from(result.bytes).toString('utf8') : print.mock.calls[0][0].markdown
      expect(parseMarkdown(markdown)).toMatchObject([
        {
          type: 'text',
          text: 'Bold plain',
          runs: expect.arrayContaining([
            expect.objectContaining({ text: 'Bold', bold: true }),
            expect.objectContaining({ text: ' plain', bold: false })
          ])
        }
      ])
    }
  )

  it('keeps outer emphasis after a nested span in Markdown, a table cell, an image, and DOCX', async () => {
    const paragraphCases = [
      {
        source: '**outer __inner__ tail**',
        runs: [
          { text: 'outer ', bold: true },
          { text: 'inner', bold: true },
          { text: ' tail', bold: true }
        ]
      },
      {
        source: '*outer _inner_ tail*',
        runs: [
          { text: 'outer ', italic: true },
          { text: 'inner', italic: true },
          { text: ' tail', italic: true }
        ]
      }
    ] as const
    for (const { source, runs } of paragraphCases) {
      const blocks = parseMarkdown(source)
      expect(blocks).toMatchObject([{ type: 'text', text: 'outer inner tail', runs }])
      const xml = await JSZip.loadAsync(await convertDocx(blocks, new Map(), 'Emphasis')).then((zip) =>
        zip.file('word/document.xml')!.async('string')
      )
      const word = wordRuns(xml).filter((run) => run.text.trim())
      expect(word.map((run) => run.text)).toEqual(['outer ', 'inner', ' tail'])
      expect(word.every((run) => ('bold' in runs[0] ? run.bold : run.italic))).toBe(true)
    }

    const table = parseMarkdown('| H |\n| --- |\n| **outer __inner__ tail** |\n')
    expect(table).toMatchObject([
      {
        type: 'table',
        rows: [['H'], ['outer inner tail']],
        cells: [
          [{ runs: [{ text: 'H' }] }],
          [
            {
              runs: [
                { text: 'outer ', bold: true },
                { text: 'inner', bold: true },
                { text: ' tail', bold: true }
              ]
            }
          ]
        ]
      }
    ])
    const tableXml = await JSZip.loadAsync(await convertDocx(table, new Map(), 'Table')).then((zip) =>
      zip.file('word/document.xml')!.async('string')
    )
    const tableRuns = wordRuns(tableXml).filter((run) => /outer|inner|tail/.test(run.text))
    expect(tableRuns.map((run) => run.text)).toEqual(['outer ', 'inner', ' tail'])
    expect(tableRuns.every((run) => run.bold)).toBe(true)

    const imageBlocks = parseMarkdown('**outer __inner__ ![logo](logo.png) tail**')
    expect(imageBlocks.map((block) => block.type)).toEqual(['text', 'image', 'text'])
    expect(imageBlocks[0]).toMatchObject({
      text: 'outer inner ',
      runs: [
        { text: 'outer ', bold: true },
        { text: 'inner', bold: true },
        { text: ' ', bold: true }
      ]
    })
    expect(imageBlocks[1]).toMatchObject({ type: 'image', text: 'logo', source: 'logo.png' })
    expect(imageBlocks[2]).toMatchObject({ text: ' tail', runs: [{ text: ' tail', bold: true }] })
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
      .png()
      .toBuffer()
    const imageXml = await JSZip.loadAsync(await convertDocx(imageBlocks, new Map([['logo.png', png]]), 'Image')).then(
      (zip) => zip.file('word/document.xml')!.async('string')
    )
    expect(imageXml).toContain('descr="logo"')
    const imageRuns = wordRuns(imageXml).filter((run) => /outer|inner|tail/.test(run.text))
    expect(imageRuns.map((run) => run.text)).toEqual(['outer ', 'inner', ' tail'])
    expect(imageRuns.every((run) => run.bold)).toBe(true)
  })

  it.each([
    ['https://example.test/a)b', 'https://example.test/a)b'],
    ['https://example.test/a(b', 'https://example.test/a(b'],
    ['https://example.test/a b', 'https://example.test/a%20b'],
    ['https://example.test/a\\b', 'https://example.test/a%5Cb'],
    ['https://example.test/a<b>', 'https://example.test/a%3Cb%3E'],
    ['https://example.test/?q=&copy;#section', 'https://example.test/?q=&copy;#section'],
    ['https://example.test/a%20b?q=1#part', 'https://example.test/a%20b?q=1#part'],
    ['#section)', '#section)']
  ])('preserves Markdown link destinations: %s', (link, expected) => {
    const blocks = parseMarkdown(
      documentToMarkdown([{ type: 'text', text: 'Link', runs: [{ text: 'Link', link }] }], (source) => source)
    )
    expect(blocks).toMatchObject([{ type: 'text', text: 'Link', runs: [{ text: 'Link', link: expected }] }])
  })

  it('keeps an image asset reference intact for a Markdown filename containing a closing parenthesis', async () => {
    const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
      .png()
      .toBuffer()
    const document = await convertDocumentBundle({
      markdown: `![Chart](data:image/png;base64,${image.toString('base64')})`,
      format: 'md',
      outputName: 'report).md'
    })
    const blocks = parseMarkdown(document.bytes.toString())
    expect(blocks).toMatchObject([{ type: 'image', source: 'report).assets/image-1.png', text: 'Chart' }])
    expect(document.resourceDirectory).toBe('report).assets')
    expect(await sharp(document.assets.get('image-1.png')).metadata()).toMatchObject({ width: 2, height: 2 })
  })

  it.each(['md', 'pdf'] as const)('preserves Office literal text at the %s output boundary', async (format) => {
    const blocks: DocumentBlock[] = literals.map((text) => ({ type: 'text', text }))
    const sourceBytes = await convertDocx(blocks, new Map(), 'Report')
    const print = vi.spyOn(printService, 'toDocumentPdfBuffer').mockResolvedValue(Buffer.from('%PDF'))
    const result = await convertDocumentBundle({ filePath: 'literal.docx', sourceBytes, format })
    const markdown = format === 'md' ? Buffer.from(result.bytes).toString('utf8') : print.mock.calls[0][0].markdown
    const parsed = parseMarkdown(markdown, true, { interpretSafeHtml: true })
    expect(parsed.map((block) => ('text' in block ? block.text : undefined))).toEqual(literals)
    expect(parsed.every((block) => block.type === 'text' && !block.bullet)).toBe(true)
  })

  it('preserves table links and inline formatting in Word exports', async () => {
    const document = await convertDocumentBundle({
      markdown: '| Reference |\n| --- |\n| [Docs](https://example.org/docs) **bold** *italic* ~~removed~~ `code` |',
      format: 'docx'
    })
    const zip = await JSZip.loadAsync(document.bytes)
    const xml = await zip.file('word/document.xml')!.async('string')
    const relationships = await zip.file('word/_rels/document.xml.rels')!.async('string')
    expect(xml).toContain('<w:hyperlink')
    expect(relationships).toContain('Target="https://example.org/docs"')
    expect(xml).toContain('<w:b/>')
    expect(xml).toContain('<w:i/>')
    expect(xml).toContain('<w:strike/>')
    expect(xml).toContain('Consolas')
  })

  it.each(['url(#gradient)', "url('#gradient')", 'url("#gradient")', 'url( #gradient )'])(
    'rasterizes SVG local fragment references: %s',
    async (fill) => {
      const escaped = fill.replaceAll('"', '&quot;')
      const svg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><defs><linearGradient id="gradient"><stop stop-color="red"/></linearGradient></defs><rect width="2" height="2" fill="${escaped}"/></svg>`
      )
      const png = await normalizeDocumentImage(svg)
      expect(await sharp(png).metadata()).toMatchObject({ format: 'png', width: 2, height: 2 })
    }
  )

  it.each([
    'url(https://example.org/image.svg)',
    "url('file:///private/image.svg')",
    'url(#gradient) url(https://example.org/image.svg)'
  ])('rejects SVG external resources: %s', async (fill) => {
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="${fill}"/></svg>`
    )
    await expect(normalizeDocumentImage(svg)).rejects.toMatchObject({ code: 'INVALID_IMAGE' })
  })
})
