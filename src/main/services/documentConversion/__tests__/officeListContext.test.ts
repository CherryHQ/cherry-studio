// @vitest-environment jsdom

import type * as Anydoc from '@firecrawl/anydoc'
import {
  AlignmentType,
  Document,
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
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DocumentBlock } from '../documentModel'
import { convertDocx } from '../docx'
import { extractHtmlDocument } from '../htmlDocument'
import { parseMarkdown } from '../parseMarkdown'
import { convertPptx } from '../pptx'
import { readDocument } from '../readDocument'
import { documentToHtml, documentToMarkdown } from '../serializeDocument'

const { officeDocuments } = vi.hoisted(() => {
  const officeDocuments: Anydoc.Document[] = []
  return { officeDocuments }
})

vi.mock('@firecrawl/anydoc', async (importOriginal) => {
  const actual = await importOriginal<typeof Anydoc>()
  return {
    ...actual,
    toDocument: (bytes: Uint8Array, format?: Parameters<typeof actual.toDocument>[1]) => {
      const queued = officeDocuments.shift()
      return queued ? Promise.resolve(queued) : actual.toDocument(bytes, format)
    }
  }
})

const STEP = 228600

function listShape(block: DocumentBlock) {
  if (block.type === 'columns') return { type: block.type }
  return {
    type: block.type,
    text: 'text' in block ? block.text : undefined,
    ...(block.type === 'table' ? { rows: block.rows } : {}),
    bullet: block.bullet,
    orderedNumber: block.orderedNumber,
    listDepth: block.listDepth
  }
}

const blocks: DocumentBlock[] = [
  { type: 'text', text: 'Parent', bullet: 1, orderedNumber: 10, listDepth: 1 },
  { type: 'image', source: 'chart.png', text: 'chart', listDepth: 1 },
  { type: 'text', text: 'More parent', listDepth: 1 },
  { type: 'code', text: 'line', listDepth: 1 },
  { type: 'text', text: 'Child', bullet: 2, orderedNumber: 1, listDepth: 2 },
  { type: 'heading', level: 3, text: 'Subhead', listDepth: 2 },
  { type: 'image', source: 'only.png', text: 'only', bullet: 2, listDepth: 2 },
  {
    type: 'table',
    title: '',
    rows: [
      ['A', 'B'],
      ['1', '2']
    ],
    listDepth: 2
  },
  { type: 'text', text: 'Next', bullet: 1, orderedNumber: 11, listDepth: 1 },
  { type: 'text', text: 'Outside' }
]

async function imageMap() {
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
    .png()
    .toBuffer()
  return new Map([
    ['chart.png', image],
    ['only.png', image]
  ])
}

function paragraphs(xml: string) {
  return [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map((match) => {
    const paragraph = match[0]
    return {
      text: [...paragraph.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((part) => part[1]).join(''),
      ilvl: paragraph.match(/<w:ilvl w:val="(\d+)"/)?.[1],
      numId: paragraph.match(/<w:numId w:val="(\d+)"/)?.[1],
      left: paragraph.match(/<w:ind\b[^>]*w:left="(\d+)"/)?.[1],
      drawing: paragraph.includes('<w:drawing'),
      descr: paragraph.match(/descr="([^"]*)"/)?.[1]
    }
  })
}

function numberingLevel(numberingXml: string, numId: string | undefined, ilvl: string | undefined) {
  if (!numId || ilvl === undefined) return undefined
  const concrete = numberingXml.match(new RegExp(`<w:num [^>]*w:numId="${numId}"[\\s\\S]*?</w:num>`))?.[0] ?? ''
  const abstractId = concrete.match(/w:val="(\d+)"/)?.[1]
  const abstract =
    numberingXml.match(
      new RegExp(`<w:abstractNum [^>]*w:abstractNumId="${abstractId}"[\\s\\S]*?</w:abstractNum>`)
    )?.[0] ?? ''
  const level = abstract.match(new RegExp(`<w:lvl [^>]*w:ilvl="${ilvl}"[\\s\\S]*?</w:lvl>`))?.[0] ?? ''
  const override = concrete.match(new RegExp(`<w:lvlOverride [^>]*w:ilvl="${ilvl}"[\\s\\S]*?</w:lvlOverride>`))?.[0]
  return {
    start: override?.match(/<w:start w:val="(\d+)"/)?.[1] ?? level.match(/<w:start w:val="(\d+)"/)?.[1],
    indent: level.match(/w:left="(\d+)"/)?.[1]
  }
}

function expectStep(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThan(1500)
}

function tableIndents(xml: string) {
  return [...xml.matchAll(/<w:tblInd\b([^>]*)\/?>/g)].map((match) => ({
    width: match[1].match(/\bw:w="(\d+)"/)?.[1],
    type: match[1].match(/\bw:type="([^"]+)"/)?.[1]
  }))
}

function pptxMarker(xml: string) {
  if (/<a:buAutoNum\b/.test(xml)) return 'number'
  if (/<a:buChar\b/.test(xml)) return 'bullet'
  if (/<a:buNone\b/.test(xml)) return 'none'
  return 'absent'
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Office list membership', () => {
  it('writes DOCX markers, continuation indents, and image-before-text order', async () => {
    const images = await imageMap()
    const word = await JSZip.loadAsync(await convertDocx(blocks, images, 'Lists'))
    const documentXml = await word.file('word/document.xml')!.async('string')
    const numberingXml = await word.file('word/numbering.xml')!.async('string')
    const items = paragraphs(documentXml)
    const text = (value: string) => items.find((item) => item.text === value)
    const drawing = (value: string) => items.find((item) => item.drawing && item.descr === value)
    const parent = text('Parent')
    const more = text('More parent')
    const code = text('line')
    const child = text('Child')
    const subhead = text('Subhead')
    const next = text('Next')
    const outside = text('Outside')
    const chart = drawing('chart')
    const only = drawing('only')

    expect(
      items
        .map((item) => item.text || item.descr)
        .filter((value) => value && value !== 'A' && value !== 'B' && value !== '1' && value !== '2')
    ).toEqual(['Parent', 'chart', 'More parent', 'line', 'Child', 'Subhead', 'only', 'Next', 'Outside'])
    expect(numberingLevel(numberingXml, parent?.numId, parent?.ilvl)).toEqual({ start: '10', indent: '720' })
    expect(numberingLevel(numberingXml, child?.numId, child?.ilvl)).toEqual({ start: '1', indent: '1440' })
    expect(numberingLevel(numberingXml, next?.numId, next?.ilvl)).toEqual({ start: '11', indent: '720' })
    expect(more).toMatchObject({ ilvl: undefined, left: '720' })
    expect(code).toMatchObject({ ilvl: undefined, left: '720' })
    expect(chart).toMatchObject({ ilvl: undefined, left: '720' })
    expect(subhead).toMatchObject({ ilvl: undefined, left: '1440' })
    expect(only).toMatchObject({ ilvl: '1' })
    expect(only?.left).toBeUndefined()
    expect(outside?.ilvl).toBeUndefined()
    expect(outside?.left).toBeUndefined()
    expect(tableIndents(documentXml)).toContainEqual({ width: '1440', type: 'dxa' })
    expect(documentXml.indexOf('descr="chart"')).toBeLessThan(documentXml.indexOf('>More parent<'))
    expect(documentXml.indexOf('descr="only"')).toBeLessThan(documentXml.indexOf('>Next<'))
  })

  it('places nested PowerPoint text, images, and tables by list depth', async () => {
    const images = await imageMap()
    const zip = await JSZip.loadAsync(await convertPptx(blocks, images, 'Lists'))
    const slides = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort()
    const items = (
      await Promise.all(
        slides.map(async (name, slide) => {
          const xml = await zip.file(name)!.async('string')
          return [...xml.matchAll(/<p:(sp|pic|graphicFrame)\b[\s\S]*?<\/p:\1>/g)].map((match) => {
            const body = match[0]
            const off = body.match(/<a:off x="(-?\d+)" y="(-?\d+)"/)
            return {
              kind: match[1],
              text: [...body.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((part) => part[1]).join(''),
              descr: body.match(/\bdescr="([^"]*)"/)?.[1] ?? '',
              x: Number(off?.[1]),
              y: Number(off?.[2]),
              xml: body,
              slide
            }
          })
        })
      )
    ).flat()
    const text = (value: string) => items.find((item) => item.text.includes(value))
    const pic = (value: string) => items.find((item) => item.kind === 'pic' && item.descr === value)
    const table = items.find((item) => item.kind === 'graphicFrame')
    const parent = text('Parent')
    const more = text('More parent')
    const code = text('line')
    const child = text('Child')
    const subhead = text('Subhead')
    const next = text('Next')
    const outside = text('Outside')
    const chart = pic('chart')
    const only = pic('only')
    const marker = items[items.indexOf(only!) - 1]

    expect([parent, more, code, child, subhead, next, outside, chart, only, table, marker].every(Boolean)).toBe(true)
    const order = ['Parent', 'chart', 'More parent', 'line', 'Child', 'Subhead', 'only', 'Next', 'Outside']
    const positions = order.map((label) => items.findIndex((item) => item.text.includes(label) || item.descr === label))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((left, right) => left - right)).toEqual(positions)
    expect(positions[1]).toBeLessThan(positions[2])
    expect(marker?.kind).toBe('sp')
    expect(pptxMarker(marker.xml)).toBe('bullet')
    expect(pptxMarker(parent!.xml)).toBe('number')
    expect(pptxMarker(child!.xml)).toBe('number')
    expect(pptxMarker(next!.xml)).toBe('number')
    expect(parent?.xml).toContain('startAt="10"')
    expect(child?.xml).toContain('startAt="1"')
    expect(next?.xml).toContain('startAt="11"')
    expect([more, code, subhead, outside].map((item) => pptxMarker(item!.xml))).toEqual([
      'none',
      'none',
      'none',
      'none'
    ])
    expectStep(more!.x - parent!.x, STEP)
    expectStep(chart!.x - parent!.x, STEP)
    expectStep(code!.x - parent!.x, STEP)
    expectStep(child!.x - parent!.x, STEP)
    expectStep(subhead!.x - parent!.x, STEP * 2)
    expectStep(only!.x - parent!.x, STEP * 2)
    expectStep(table!.x - parent!.x, STEP * 2)
    expectStep(marker.x - parent!.x, STEP)
    expectStep(next!.x - parent!.x, 0)
    expectStep(outside!.x - parent!.x, 0)
    expect(chart!.slide < more!.slide || (chart!.slide === more!.slide && chart!.y <= more!.y)).toBe(true)
  })

  it('reads a numbered Word paragraph with an inline image, a nested child, and the next item', async () => {
    const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
      .png()
      .toBuffer()
    const bytes = await Packer.toBuffer(
      new Document({
        numbering: {
          config: [
            {
              reference: 'items',
              levels: [0, 1].map((level) => ({
                level,
                format: LevelFormat.DECIMAL,
                text: `%${level + 1}.`,
                start: 1,
                alignment: AlignmentType.LEFT,
                style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } }
              }))
            }
          ]
        },
        sections: [
          {
            children: [
              new Paragraph({
                numbering: { reference: 'items', level: 0 },
                children: [
                  new TextRun('Before'),
                  new ImageRun({
                    type: 'png',
                    data: image,
                    transformation: { width: 2, height: 2 },
                    altText: { title: 'chart', description: 'chart', name: 'chart' }
                  }),
                  new TextRun('after')
                ]
              }),
              new Paragraph({
                numbering: { reference: 'items', level: 1 },
                children: [new TextRun('Child')]
              }),
              new Paragraph({
                numbering: { reference: 'items', level: 0 },
                children: [new TextRun('Next')]
              })
            ]
          }
        ]
      })
    )
    const model = await readDocument({ filePath: 'inline-list.docx', sourceBytes: bytes })
    const expected = [
      { type: 'text', text: 'Before', bullet: 1, orderedNumber: 1, listDepth: 1 },
      { type: 'image', text: 'chart', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'after', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Child', bullet: 2, orderedNumber: 1, listDepth: 2 },
      { type: 'text', text: 'Next', bullet: 1, orderedNumber: 2, listDepth: 1 }
    ]
    expect(model.blocks.map(listShape)).toEqual(expected)
    expect([...model.images.values()][0]?.subarray(0, 8)).toEqual(image.subarray(0, 8))

    const markdown = documentToMarkdown(model.blocks, (source) => source)
    expect(parseMarkdown(markdown).map(listShape)).toEqual(expected)
    expect(markdown.indexOf('Before')).toBeLessThan(markdown.indexOf('![chart]'))
    expect(markdown.indexOf('![chart]')).toBeLessThan(markdown.indexOf('after'))

    const html = documentToHtml(model.blocks, (source) => source, 'Inline')
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML
    expect(extractHtmlDocument().blocks.map(listShape)).toEqual(expected)
    const body = document.body
    const outer = body.querySelector('ol')
    const items = [...(outer?.children ?? [])]
    expect(items.map((item) => item.tagName)).toEqual(['LI', 'LI'])
    expect(items[0]?.textContent).toContain('Before')
    expect(items[0]?.textContent).toContain('after')
    expect(items[0]?.querySelector('img')?.getAttribute('alt')).toBe('chart')
    expect(items[0]?.textContent?.indexOf('Before')).toBeLessThan(items[0]?.textContent?.indexOf('after') ?? -1)
    expect(items[0]?.querySelector('ol')?.textContent).toContain('Child')
    expect(items[1]?.textContent).toContain('Next')
    expect(items[1]?.querySelector('ol, ul, img')).toBeNull()
  })

  it('keeps table-cell images inside the list item that owns the table', async () => {
    const lead = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
      .png()
      .toBuffer()
    const trail = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'blue' } })
      .png()
      .toBuffer()
    const bytes = await Packer.toBuffer(
      new Document({
        numbering: {
          config: [
            {
              reference: 'items',
              levels: [
                {
                  level: 0,
                  format: LevelFormat.DECIMAL,
                  text: '%1.',
                  start: 10,
                  alignment: AlignmentType.LEFT,
                  style: { paragraph: { indent: { left: 720, hanging: 360 } } }
                }
              ]
            }
          ]
        },
        sections: [
          {
            children: [
              new Paragraph({ numbering: { reference: 'items', level: 0 }, children: [new TextRun('Parent')] }),
              new Table({
                rows: [
                  new TableRow({
                    children: [
                      new TableCell({
                        children: [
                          new Paragraph({
                            children: [
                              new TextRun('A'),
                              new ImageRun({
                                type: 'png',
                                data: lead,
                                transformation: { width: 2, height: 2 },
                                altText: { title: 'lead', description: 'lead', name: 'lead' }
                              }),
                              new ImageRun({
                                type: 'png',
                                data: trail,
                                transformation: { width: 2, height: 2 },
                                altText: { title: 'trail', description: 'trail', name: 'trail' }
                              })
                            ]
                          })
                        ]
                      })
                    ]
                  })
                ]
              }),
              new Paragraph({ children: [new TextRun('More')] }),
              new Paragraph({ numbering: { reference: 'items', level: 0 }, children: [new TextRun('Next')] })
            ]
          }
        ]
      })
    )
    // Real bytes leave the table outside the list. Nest the parsed table to model that upstream container.
    const actual = await vi.importActual<typeof Anydoc>('@firecrawl/anydoc')
    const parsed = await actual.toDocument(bytes)
    const paragraphText = (block: Anydoc.Block) => block.content?.map((inline) => inline.text ?? '').join('')
    const paragraphBlocks = parsed.blocks.flatMap((block) => [
      block,
      ...(block.list?.items.flatMap((item) => item.blocks) ?? [])
    ])
    const listBlock = parsed.blocks.find((block) => block.list?.start === 10)
    const tableBlock = parsed.blocks.find((block) => block.table)
    const parent = paragraphBlocks.find((block) => paragraphText(block) === 'Parent')
    const more = paragraphBlocks.find((block) => paragraphText(block) === 'More')
    const parentInline = parent?.content?.[0]
    const tableInlines = (tableBlock?.table?.grid ?? []).flatMap((row) =>
      row.flatMap((slot) => (slot.cell?.blocks ?? []).flatMap((block) => block.content ?? []))
    )
    const leadInline = tableInlines.find((inline) => inline.alt === 'lead')
    const trailInline = tableInlines.find((inline) => inline.alt === 'trail')
    const leadId = leadInline?.source?.assetId
    const trailId = trailInline?.source?.assetId
    const firstItem = listBlock?.list?.items[0]
    const nextItem = parsed.blocks
      .find((block) => block.list?.items.some((item) => item.blocks.some((child) => paragraphText(child) === 'Next')))
      ?.list?.items.find((item) => item.blocks.some((child) => paragraphText(child) === 'Next'))
    if (
      !listBlock?.list ||
      !firstItem ||
      !tableBlock?.table ||
      !parent ||
      !parentInline ||
      !more ||
      !nextItem ||
      leadId === undefined ||
      trailId === undefined
    ) {
      throw new Error('parsed document is missing the numbered list, table images, or paragraphs')
    }
    expect(listBlock.list.start).toBe(10)
    expect(tableBlock.table.grid).toHaveLength(1)
    expect(parentInline.text).toBe('Parent')
    expect(paragraphText(more)).toBe('More')
    expect(nextItem.blocks.map((block) => paragraphText(block))).toEqual(['Next'])
    expect(leadInline?.alt).toBe('lead')
    expect(trailInline?.alt).toBe('trail')
    const child: Anydoc.Block = { ...parent, content: [{ ...parentInline, text: 'Child' }] }
    const childList: Anydoc.Block = {
      ...listBlock,
      list: { ...listBlock.list, start: 1, items: [{ ...firstItem, blocks: [child] }] }
    }
    const officeDocument: Anydoc.Document = {
      ...parsed,
      blocks: [
        {
          ...listBlock,
          list: {
            ...listBlock.list,
            items: [{ ...firstItem, blocks: [tableBlock, more, childList] }, nextItem]
          }
        }
      ]
    }
    officeDocuments.push(officeDocument)
    try {
      const model = await readDocument({ filePath: 'nested-table.docx', sourceBytes: new Uint8Array() })
      const expected = [
        {
          type: 'table',
          text: undefined,
          rows: [['A']],
          bullet: 1,
          orderedNumber: 10,
          listDepth: 1
        },
        { type: 'image', text: 'lead', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
        { type: 'image', text: 'trail', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
        { type: 'text', text: 'More', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
        { type: 'text', text: 'Child', bullet: 2, orderedNumber: 1, listDepth: 2 },
        { type: 'text', text: 'Next', bullet: 1, orderedNumber: 11, listDepth: 1 }
      ]
      expect(model.blocks.map(listShape)).toEqual(expected)
      expect(model.blocks.flatMap((block) => (block.type === 'image' ? [block.source] : []))).toEqual([
        `embedded:${leadId}`,
        `embedded:${trailId}`
      ])
      expect(model.images.get(`embedded:${leadId}`)?.subarray(0, 8)).toEqual(lead.subarray(0, 8))
      expect(model.images.get(`embedded:${trailId}`)?.subarray(0, 8)).toEqual(trail.subarray(0, 8))

      const html = documentToHtml(model.blocks, (source) => source, 'Table')
      const body = new DOMParser().parseFromString(html, 'text/html').body
      const items = [...(body.querySelector('ol')?.children ?? [])]
      expect(body.querySelector('ol')?.getAttribute('start')).toBe('10')
      expect(items.map((item) => item.tagName)).toEqual(['LI', 'LI'])
      const [item, next] = items
      const images = [...(item?.querySelectorAll('img') ?? [])]
      const [firstImage] = images
      expect(images.map((image) => image.getAttribute('alt'))).toEqual(['lead', 'trail'])
      expect(firstImage).toBeDefined()
      expect(item?.querySelector('table')?.compareDocumentPosition(firstImage ?? item)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING
      )
      expect(item?.textContent).toContain('More')
      expect(item?.querySelector('ol')?.textContent).toContain('Child')
      expect(next?.textContent).toContain('Next')
      expect(next?.querySelector('table, img, ol')).toBeNull()
      expect(parseMarkdown(documentToMarkdown(model.blocks, (source) => source)).map(listShape)).toEqual(expected)
    } finally {
      officeDocuments.length = 0
    }
  })
})
