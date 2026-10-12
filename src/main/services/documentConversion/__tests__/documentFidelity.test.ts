import JSZip from 'jszip'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DocumentBlock } from '@shared/types/documentModel'

import { printService } from '../../PrintService'
import { convertDocumentBundle } from '../convertDocument'
import { convertDocx } from '../docx'
import { normalizeDocumentImage } from '../imageAssets'
import { parseMarkdown } from '../parseMarkdown'
import { documentToMarkdown } from '../serializeDocument'

afterEach(() => vi.restoreAllMocks())

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
