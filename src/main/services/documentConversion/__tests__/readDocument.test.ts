// @vitest-environment jsdom

import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun
} from 'docx'
import JSZip from 'jszip'
import MarkdownIt from 'markdown-it'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { convertDocumentBundle } from '../convertDocument'
import type { DocumentBlock } from '../documentModel'
import { readDocument } from '../readDocument'
import { documentToHtml, documentToMarkdown } from '../serializeDocument'

function levels(starts: number[], formats: Array<'decimal' | 'bullet'> = []) {
  return starts.map((start, level) => ({
    level,
    format: (formats[level] ?? 'decimal') === 'bullet' ? LevelFormat.BULLET : LevelFormat.DECIMAL,
    text: (formats[level] ?? 'decimal') === 'bullet' ? '•' : `%${level + 1}.`,
    start,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } }
  }))
}

function numbered(reference: string, starts: number[], formats?: Array<'decimal' | 'bullet'>) {
  return { config: [{ reference, levels: levels(starts, formats) }] }
}

function shape(block: DocumentBlock) {
  if (block.type === 'columns') return { type: block.type }
  return {
    type: block.type,
    text: 'text' in block ? block.text : undefined,
    bullet: block.bullet,
    orderedNumber: block.orderedNumber,
    listDepth: block.listDepth
  }
}

async function docx(
  children: Paragraph[],
  reference = 'items',
  starts = [3, 4, 1],
  formats?: Array<'decimal' | 'bullet'>
) {
  return Packer.toBuffer(
    new Document({
      numbering: numbered(reference, starts, formats),
      sections: [{ children }]
    })
  )
}

const markdownDocument = new MarkdownIt()

function renderedMarkdownText(markdown: string): string {
  return new DOMParser().parseFromString(markdownDocument.render(markdown), 'text/html').body.textContent ?? ''
}

describe('Office document reading', () => {
  it('keeps nested table values, styles, links, and merge coverage from a real DOCX cell', async () => {
    const bytes = await Packer.toBuffer(
      new Document({
        sections: [
          {
            children: [
              new Table({
                rows: [
                  new TableRow({
                    children: [
                      new TableCell({
                        rowSpan: 2,
                        children: [
                          new Paragraph({ children: [new TextRun({ text: 'Invoice', bold: true })] }),
                          new Table({
                            rows: [
                              new TableRow({
                                children: [
                                  new TableCell({ children: [new Paragraph('Amount')] }),
                                  new TableCell({
                                    children: [
                                      new Paragraph({
                                        children: [
                                          new ExternalHyperlink({
                                            link: 'https://example.test/pay',
                                            children: [new TextRun({ text: '12345', italics: true })]
                                          })
                                        ]
                                      }),
                                      new Table({
                                        rows: [
                                          new TableRow({
                                            children: [
                                              new TableCell({ children: [new Paragraph('Deep')] }),
                                              new TableCell({ children: [new Paragraph('Leaf')] })
                                            ]
                                          })
                                        ]
                                      })
                                    ]
                                  })
                                ]
                              })
                            ]
                          }),
                          new Paragraph('Thanks')
                        ]
                      }),
                      new TableCell({ children: [new Paragraph('Side')] })
                    ]
                  }),
                  new TableRow({
                    children: [new TableCell({ children: [new Paragraph('Second column')] })]
                  })
                ]
              })
            ]
          }
        ]
      })
    )
    const anydoc = await import('@firecrawl/anydoc')
    const parsed = await anydoc.toDocument(bytes, anydoc.formatFromExtension('.docx'))
    const origin = parsed.blocks[0]?.table?.grid[0]?.[0]
    expect(origin?.cell?.blocks.map((block) => block.kind)).toEqual(['paragraph', 'table', 'paragraph'])
    expect(parsed.blocks[0]?.table?.grid[1]?.[0]?.kind).toBe('covered')

    const model = await readDocument({
      filePath: 'nested-cell.docx',
      sourceName: 'nested-cell.docx',
      sourceBytes: bytes
    })
    expect(model.warnings).toContain('complex_layout')
    const table = model.blocks[0]
    expect(table?.type).toBe('table')
    if (table?.type !== 'table') return
    const [invoice, side] = table.cells?.[0] ?? []
    const [covered, second] = table.cells?.[1] ?? []
    expect(invoice?.rowSpan).toBe(origin?.cell?.rowSpan)
    expect(covered?.covered).toBe(true)
    expect(covered?.runs.map((run) => run.text).join('')).toBe('')
    expect(side?.runs.map((run) => run.text).join('')).toBe('Side')
    expect(second?.runs.map((run) => run.text).join('')).toBe('Second column')
    expect(invoice?.runs.map((run) => run.text).join('')).toBe('Invoice\nAmount\n12345\nDeep\nLeaf\nThanks')
    expect(invoice?.runs.find((run) => run.text === 'Invoice')).toMatchObject({ bold: true })
    expect(invoice?.runs.find((run) => run.text === '12345')).toMatchObject({
      italic: true,
      link: 'https://example.test/pay'
    })
    expect(invoice?.runs.filter((run) => run.text === 'Invoice')).toHaveLength(1)
    expect(table.rows?.[0]?.[0]).toBe('Invoice\nAmount\n12345\nDeep\nLeaf\nThanks')
    expect(table.rows?.[1]?.[0]).toBe('')

    const html = documentToHtml(model.blocks, (source) => source, 'Invoice')
    const body = new DOMParser().parseFromString(html, 'text/html').body
    expect(body.querySelectorAll('table')).toHaveLength(1)
    expect(body.textContent).toContain('Invoice')
    expect(body.textContent).toContain('Amount')
    expect(body.textContent).toContain('12345')
    expect(body.textContent).toContain('Deep')
    expect(body.textContent).toContain('Leaf')
    expect(body.textContent).toContain('Thanks')
    expect(body.querySelector('a')?.getAttribute('href')).toBe('https://example.test/pay')

    const markdown = documentToMarkdown(model.blocks, (source) => source)
    const rendered = renderedMarkdownText(markdown)
    for (const value of ['Invoice', 'Amount', '12345', 'Deep', 'Leaf', 'Thanks', 'Side']) {
      expect(rendered).toContain(value)
    }

    const xlsx = await convertDocumentBundle({
      filePath: 'nested-cell.docx',
      sourceName: 'nested-cell.docx',
      sourceBytes: bytes,
      format: 'xlsx',
      title: 'Invoice'
    })
    const sheet = await JSZip.loadAsync(xlsx.bytes)
    const shared = await sheet.file('xl/sharedStrings.xml')!.async('string')
    for (const value of ['Invoice', 'Amount', '12345', 'Deep', 'Leaf', 'Thanks', 'Side', 'Second column']) {
      expect(shared).toContain(value)
    }
    expect(shared.match(/Invoice/g)).toHaveLength(1)
    expect(xlsx.warnings).toContain('complex_layout')

    const word = await convertDocumentBundle({
      filePath: 'nested-cell.docx',
      sourceName: 'nested-cell.docx',
      sourceBytes: bytes,
      format: 'docx',
      title: 'Invoice'
    })
    const exported = await JSZip.loadAsync(word.bytes)
    const documentXml = await exported.file('word/document.xml')!.async('string')
    for (const value of ['Invoice', 'Amount', '12345', 'Deep', 'Leaf', 'Thanks', 'Side']) {
      expect(documentXml).toContain(value)
    }
    expect(documentXml.match(/12345/g)).toHaveLength(1)
  })

  it('numbers an empty parent once before a leading nested list and keeps later siblings', async () => {
    const bytes = await docx([
      new Paragraph({ numbering: { reference: 'items', level: 0 } }),
      new Paragraph({ numbering: { reference: 'items', level: 1 }, children: [new TextRun('Child')] }),
      new Paragraph({ children: [new TextRun('More')] }),
      new Paragraph({ numbering: { reference: 'items', level: 0 } }),
      new Paragraph({ numbering: { reference: 'items', level: 0 }, children: [new TextRun('Next')] }),
      new Paragraph({ numbering: { reference: 'items', level: 0 } }),
      new Paragraph({ numbering: { reference: 'items', level: 1 } }),
      new Paragraph({ numbering: { reference: 'items', level: 2 }, children: [new TextRun('Deep')] }),
      new Paragraph({ children: [new TextRun('Later')] }),
      new Paragraph({ numbering: { reference: 'items', level: 0 }, children: [new TextRun('Tail')] })
    ])
    const anydoc = await import('@firecrawl/anydoc')
    const parsed = await anydoc.toDocument(bytes, anydoc.formatFromExtension('.docx'))
    const parent = parsed.blocks.find((block) => block.list?.start === 3)
    expect(parent?.list?.items[0]?.blocks.map((block) => block.kind)).toEqual(['list'])
    expect(parent?.list?.items[0]?.blocks[0]?.list?.start).toBe(4)

    const model = await readDocument({
      filePath: 'empty-parent.docx',
      sourceName: 'empty-parent.docx',
      sourceBytes: bytes
    })
    expect(model.blocks.map(shape)).toEqual([
      { type: 'text', text: '', bullet: 1, orderedNumber: 3, listDepth: 1 },
      { type: 'text', text: 'Child', bullet: 2, orderedNumber: 4, listDepth: 2 },
      { type: 'text', text: 'More', bullet: undefined, orderedNumber: undefined, listDepth: undefined },
      { type: 'text', text: '', bullet: 1, orderedNumber: 4, listDepth: 1 },
      { type: 'text', text: 'Next', bullet: 1, orderedNumber: 5, listDepth: 1 },
      { type: 'text', text: '', bullet: 1, orderedNumber: 6, listDepth: 1 },
      { type: 'text', text: '', bullet: 2, orderedNumber: 4, listDepth: 2 },
      { type: 'text', text: 'Deep', bullet: 3, orderedNumber: 1, listDepth: 3 },
      { type: 'text', text: 'Later', bullet: undefined, orderedNumber: undefined, listDepth: undefined },
      { type: 'text', text: 'Tail', bullet: 1, orderedNumber: 7, listDepth: 1 }
    ])

    const markdown = documentToMarkdown(model.blocks, (source) => source)
    expect(markdown).toContain('3.')
    expect(markdown).toContain('4. Child')
    expect(markdown).toContain('5. Next')
    expect(markdown).toContain('1. Deep')
    expect(markdown).toContain('7. Tail')
    expect(markdown.indexOf('3.')).toBeLessThan(markdown.indexOf('4. Child'))
    expect(markdown.indexOf('4. Child')).toBeLessThan(markdown.indexOf('More'))
    expect(markdown.indexOf('More')).toBeLessThan(markdown.indexOf('5. Next'))

    const html = documentToHtml(model.blocks, (source) => source, 'Lists')
    const body = new DOMParser().parseFromString(html, 'text/html').body
    const outer = body.querySelector('ol')
    expect(outer?.getAttribute('start')).toBe('3')
    const items = [...(outer?.children ?? [])]
    expect(items[0]?.querySelector('ol')?.getAttribute('start')).toBe('4')
    expect(items[0]?.querySelector('ol')?.textContent).toContain('Child')
    expect(items.map((item) => item.getAttribute('value'))).toEqual(['3'])
    expect(body.textContent).toContain('Next')
    expect(body.textContent).toContain('Deep')
    expect(body.textContent).toContain('Tail')

    const word = await convertDocumentBundle({
      filePath: 'empty-parent.docx',
      sourceName: 'empty-parent.docx',
      sourceBytes: bytes,
      format: 'docx',
      title: 'Lists'
    })
    const exported = await JSZip.loadAsync(word.bytes)
    const documentXml = await exported.file('word/document.xml')!.async('string')
    const numberingXml = await exported.file('word/numbering.xml')!.async('string')
    expect(documentXml.indexOf('Child')).toBeGreaterThan(-1)
    expect(documentXml.indexOf('Child')).toBeLessThan(documentXml.indexOf('Next'))
    expect(numberingXml).toContain('w:val="3"')
    expect(numberingXml).toContain('w:val="4"')
  })

  it('keeps a text-leading numbered item and a bullet parent around an ordered child', async () => {
    const textLeading = await docx(
      [
        new Paragraph({ numbering: { reference: 'items', level: 0 }, children: [new TextRun('Intro')] }),
        new Paragraph({ numbering: { reference: 'items', level: 1 }, children: [new TextRun('Child')] }),
        new Paragraph({ numbering: { reference: 'items', level: 0 }, children: [new TextRun('Next')] })
      ],
      'items',
      [8, 1]
    )
    const textModel = await readDocument({
      filePath: 'text-leading.docx',
      sourceName: 'text-leading.docx',
      sourceBytes: textLeading
    })
    expect(textModel.blocks.map(shape)).toEqual([
      { type: 'text', text: 'Intro', bullet: 1, orderedNumber: 8, listDepth: 1 },
      { type: 'text', text: 'Child', bullet: 2, orderedNumber: 1, listDepth: 2 },
      { type: 'text', text: 'Next', bullet: 1, orderedNumber: 9, listDepth: 1 }
    ])
    expect(textModel.blocks.filter((block) => block.type === 'text' && block.text === '')).toHaveLength(0)

    const mixed = await docx(
      [
        new Paragraph({ numbering: { reference: 'items', level: 0 } }),
        new Paragraph({ numbering: { reference: 'items', level: 1 }, children: [new TextRun('OrderedChild')] }),
        new Paragraph({ numbering: { reference: 'items', level: 0 }, children: [new TextRun('Sibling')] })
      ],
      'items',
      [1, 2],
      ['bullet', 'decimal']
    )
    const mixedModel = await readDocument({
      filePath: 'mixed-parent.docx',
      sourceName: 'mixed-parent.docx',
      sourceBytes: mixed
    })
    expect(mixedModel.blocks.map(shape)).toEqual([
      { type: 'text', text: '', bullet: 1, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'OrderedChild', bullet: 2, orderedNumber: 2, listDepth: 2 },
      { type: 'text', text: 'Sibling', bullet: 1, orderedNumber: undefined, listDepth: 1 }
    ])
    const markdown = documentToMarkdown(mixedModel.blocks, (source) => source)
    expect(markdown).toContain('OrderedChild')
    expect(markdown).toContain('2. OrderedChild')
    expect(markdown).toContain('Sibling')
    expect(markdown.indexOf('OrderedChild')).toBeLessThan(markdown.indexOf('Sibling'))
  })

  it('keeps consecutive empty bullet items ahead of the next item', async () => {
    const bytes = await Packer.toBuffer(
      new Document({
        sections: [
          {
            children: [
              new Paragraph({ bullet: { level: 0 } }),
              new Paragraph({ bullet: { level: 0 } }),
              new Paragraph({ bullet: { level: 0 }, children: [new TextRun('Next')] })
            ]
          }
        ]
      })
    )
    const anydoc = await import('@firecrawl/anydoc')
    const parsed = await anydoc.toDocument(bytes, anydoc.formatFromExtension('.docx'))
    const list = parsed.blocks.find((block) => block.kind === 'list')
    expect(list?.list?.marker).toBe('bullet')
    expect(list?.list?.items).toHaveLength(3)

    const model = await readDocument({
      filePath: 'empty-bullets.docx',
      sourceName: 'empty-bullets.docx',
      sourceBytes: bytes
    })
    expect(model.blocks.map(shape)).toEqual([
      { type: 'text', text: '', bullet: 1, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: '', bullet: 1, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Next', bullet: 1, orderedNumber: undefined, listDepth: 1 }
    ])
    const html = documentToHtml(model.blocks, (source) => source, 'Bullets')
    const items = [...new DOMParser().parseFromString(html, 'text/html').body.querySelectorAll('ul > li')]
    expect(items.map((item) => item.textContent?.trim())).toEqual(['', '', 'Next'])
    const rendered = new DOMParser().parseFromString(
      markdownDocument.render(documentToMarkdown(model.blocks, (source) => source)),
      'text/html'
    )
    expect([...rendered.body.querySelectorAll('ul > li')].map((item) => item.textContent?.trim())).toEqual([
      '',
      '',
      'Next'
    ])
  })

  it('keeps one image from a table nested in a cell', async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
      .png()
      .toBuffer()
    const bytes = await Packer.toBuffer(
      new Document({
        sections: [
          {
            children: [
              new Table({
                rows: [
                  new TableRow({
                    children: [
                      new TableCell({
                        children: [
                          new Table({
                            rows: [
                              new TableRow({
                                children: [
                                  new TableCell({
                                    children: [
                                      new Paragraph('Before'),
                                      new Paragraph({
                                        children: [
                                          new ImageRun({
                                            type: 'png',
                                            data: png,
                                            transformation: { width: 20, height: 20 },
                                            altText: { title: 'Chart', description: 'Chart', name: 'Chart' }
                                          })
                                        ]
                                      }),
                                      new Paragraph('After')
                                    ]
                                  })
                                ]
                              })
                            ]
                          })
                        ]
                      })
                    ]
                  })
                ]
              })
            ]
          }
        ]
      })
    )
    const model = await readDocument({
      filePath: 'nested-image.docx',
      sourceName: 'nested-image.docx',
      sourceBytes: bytes
    })
    const images = model.blocks.filter((block) => block.type === 'image')
    expect(images).toHaveLength(1)
    expect(images[0]).toMatchObject({ text: 'Chart' })
    expect(model.images.size).toBe(1)
    const table = model.blocks.find((block) => block.type === 'table')
    expect(table?.type === 'table' ? table.rows?.[0]?.[0] : '').toContain('Before')
    expect(table?.type === 'table' ? table.rows?.[0]?.[0] : '').toContain('After')
    const html = documentToHtml(model.blocks, (source) => source, 'Chart')
    expect(html.match(/<img /g)).toHaveLength(1)
    expect(documentToMarkdown(model.blocks, (source) => source).match(/!\[/g)).toHaveLength(1)
  })
})
