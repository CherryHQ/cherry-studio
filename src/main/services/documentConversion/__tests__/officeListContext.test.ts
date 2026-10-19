// @vitest-environment jsdom

import type * as Anydoc from '@firecrawl/anydoc'
import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
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

type PptxChunkShape = {
  text: string
  x: number
  slide: number
  marker: 'number' | 'bullet' | 'none' | 'absent'
  startAt: string | undefined
}

async function listChunkShapes(markdown: string) {
  const blocks = parseMarkdown(markdown)
  const zip = await JSZip.loadAsync(await convertPptx(blocks, new Map(), 'Chunks'))
  const slides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort()
  const items: PptxChunkShape[] = []
  for (const [slide, name] of slides.entries()) {
    const xml = await zip.file(name)!.async('string')
    for (const match of xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)) {
      const body = match[0]
      const off = body.match(/<a:off x="(-?\d+)" y="(-?\d+)"/)
      items.push({
        text: [...body.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((part) => part[1]).join(''),
        x: Number(off?.[1]),
        slide,
        marker: pptxMarker(body),
        startAt: body.match(/startAt="(\d+)"/)?.[1]
      })
    }
  }
  return { blocks, items }
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

  it('numbers only the first PowerPoint chunk when an ordered item wraps onto another slide', async () => {
    const long = 'longtext '.repeat(120)
    const { blocks, items } = await listChunkShapes(`1. ${long}\n    1. Child\n2. Next\n`)
    const parent = blocks.find((block) => block.type === 'text' && block.text.startsWith('longtext'))
    if (!parent || parent.type !== 'text') throw new Error('expected the long ordered item')
    const content = items.filter((item) => item.text && item.text !== 'Chunks')
    const chunks = content.filter((item) => parent.text.includes(item.text))
    const child = content.find((item) => item.text === 'Child')
    const next = content.find((item) => item.text === 'Next')
    expect(chunks.map((item) => item.text).join('')).toBe(parent.text)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]).toMatchObject({ marker: 'number', startAt: '1' })
    expect(chunks.slice(1).every((item) => item.marker !== 'number' && item.marker !== 'bullet')).toBe(true)
    expectStep(chunks[1].x - chunks[0].x, STEP)
    expect(child).toMatchObject({ marker: 'number', startAt: '1' })
    expect(next).toMatchObject({ marker: 'number', startAt: '2' })
    expectStep(child!.x - chunks[0].x, STEP)

    const wide = 'longtext '.repeat(200)
    const spanned = await listChunkShapes(`1. ${wide}\n2. Next\n`)
    const wideParent = spanned.blocks.find((block) => block.type === 'text' && block.text.startsWith('longtext'))
    if (!wideParent || wideParent.type !== 'text') throw new Error('expected the multi-slide ordered item')
    const wideChunks = spanned.items.filter((item) => item.text && wideParent.text.includes(item.text))
    const wideNext = spanned.items.find((item) => item.text === 'Next')
    expect(wideChunks.map((item) => item.text).join('')).toBe(wideParent.text)
    expect(new Set(wideChunks.map((item) => item.slide)).size).toBeGreaterThan(1)
    expect(wideChunks[0]).toMatchObject({ marker: 'number', startAt: '1' })
    expect(wideChunks.slice(1).every((item) => item.marker !== 'number' && item.marker !== 'bullet')).toBe(true)
    expect(wideNext).toMatchObject({ marker: 'number', startAt: '2' })
  })

  it('bullets only the first PowerPoint chunk when an unordered item wraps', async () => {
    const long = 'longtext '.repeat(120)
    const { blocks, items } = await listChunkShapes(`- ${long}\n    - Child\n- Next\n`)
    const parent = blocks.find((block) => block.type === 'text' && block.text.startsWith('longtext'))
    if (!parent || parent.type !== 'text') throw new Error('expected the long unordered item')
    const content = items.filter((item) => item.text && item.text !== 'Chunks')
    const chunks = content.filter((item) => parent.text.includes(item.text))
    const child = content.find((item) => item.text === 'Child')
    const next = content.find((item) => item.text === 'Next')
    expect(chunks.map((item) => item.text).join('')).toBe(parent.text)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]).toMatchObject({ marker: 'bullet' })
    expect(chunks[0].startAt).toBeUndefined()
    expect(chunks.slice(1).every((item) => item.marker !== 'bullet' && item.marker !== 'number')).toBe(true)
    expectStep(chunks[1].x - chunks[0].x, STEP)
    expect(child).toMatchObject({ marker: 'bullet' })
    expect(next).toMatchObject({ marker: 'bullet' })
    expectStep(child!.x - chunks[0].x, STEP)
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

  it('does not append a blank line after the last block in a real Office cell', async () => {
    const sourceBytes = await Packer.toBuffer(
      new Document({
        sections: [
          {
            children: [
              new Table({
                rows: [
                  new TableRow({
                    children: [
                      new TableCell({ children: [new Paragraph('One')] }),
                      new TableCell({ children: [new Paragraph('First'), new Paragraph('Second')] })
                    ]
                  })
                ]
              })
            ]
          }
        ]
      })
    )
    const model = await readDocument({ filePath: 'cells.docx', sourceBytes })
    const table = model.blocks.find((block) => block.type === 'table')
    if (!table || table.type !== 'table') throw new Error('expected a table')
    expect(table.cells?.map((row) => row.map((cell) => cell.runs.map((run) => run.text).join('')))).toEqual([
      ['One', 'First\nSecond']
    ])
    const xml = await JSZip.loadAsync(await convertDocx(model.blocks, new Map(), 'Cells')).then((zip) =>
      zip.file('word/document.xml')!.async('string')
    )
    const cells = [...xml.matchAll(/<w:tc[ >][\s\S]*?<\/w:tc>/g)].map((match) => ({
      breaks: match[0].match(/<w:br[ />]/g)?.length ?? 0,
      text: [...match[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((part) => part[1]).join('')
    }))
    expect(cells.map((cell) => cell.breaks)).toEqual([0, 1])
    expect(cells.map((cell) => cell.text)).toEqual(['One', 'FirstSecond'])
    const html = documentToHtml(model.blocks, (source) => source, 'Cells')
    expect(html).toContain('One')
    expect(html).toContain('First')
    expect(html).toContain('Second')
    expect(html).not.toContain('First<br><br>')
  })

  it('reads a hyperlinked picture beside a plain picture, in list order, and inside a heading', async () => {
    const plain = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
      .png()
      .toBuffer()
    const linked = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'blue' } })
      .png()
      .toBuffer()
    const lead = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'green' } })
      .png()
      .toBuffer()
    const follow = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'yellow' } })
      .png()
      .toBuffer()
    const picture = (data: Buffer, name: string) =>
      new ImageRun({
        type: 'png',
        data,
        transformation: { width: 2, height: 2 },
        altText: { title: name, description: name, name }
      })
    const bytes = await Packer.toBuffer(
      new Document({
        numbering: {
          config: [
            {
              reference: 'items',
              levels: [0].map((level) => ({
                level,
                format: LevelFormat.DECIMAL,
                text: '%1.',
                start: 1,
                alignment: AlignmentType.LEFT,
                style: { paragraph: { indent: { left: 720, hanging: 360 } } }
              }))
            }
          ]
        },
        sections: [
          {
            children: [
              new Paragraph({
                children: [
                  new TextRun('See '),
                  picture(plain, 'plain'),
                  new ExternalHyperlink({
                    link: 'https://example.org/picture',
                    children: [new TextRun('link'), picture(linked, 'linked'), new TextRun('tail')]
                  }),
                  new TextRun(' end')
                ]
              }),
              new Paragraph({
                numbering: { reference: 'items', level: 0 },
                children: [
                  new ExternalHyperlink({
                    link: 'https://example.org/lead',
                    children: [picture(lead, 'lead')]
                  }),
                  new TextRun('Lead')
                ]
              }),
              new Paragraph({
                numbering: { reference: 'items', level: 0 },
                children: [
                  new TextRun('Follow'),
                  new ExternalHyperlink({
                    link: 'https://example.org/follow',
                    children: [picture(follow, 'follow')]
                  })
                ]
              }),
              new Paragraph({
                heading: HeadingLevel.HEADING_2,
                children: [
                  new TextRun('Title'),
                  new ExternalHyperlink({
                    link: 'https://example.org/head',
                    children: [picture(plain, 'head')]
                  }),
                  new TextRun('tail')
                ]
              })
            ]
          }
        ]
      })
    )
    const model = await readDocument({ filePath: 'linked-picture.docx', sourceBytes: bytes })
    expect(model.warnings).not.toContain('unsupported_image')
    expect(model.blocks.map(listShape)).toEqual([
      { type: 'text', text: 'See ', bullet: undefined, orderedNumber: undefined, listDepth: undefined },
      { type: 'image', text: 'plain', bullet: undefined, orderedNumber: undefined, listDepth: undefined },
      { type: 'text', text: 'link', bullet: undefined, orderedNumber: undefined, listDepth: undefined },
      { type: 'image', text: 'linked', bullet: undefined, orderedNumber: undefined, listDepth: undefined },
      { type: 'text', text: 'tail end', bullet: undefined, orderedNumber: undefined, listDepth: undefined },
      { type: 'image', text: 'lead', bullet: 1, orderedNumber: 1, listDepth: 1 },
      { type: 'text', text: 'Lead', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Follow', bullet: 1, orderedNumber: 2, listDepth: 1 },
      { type: 'image', text: 'follow', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'heading', text: 'Title', bullet: undefined, orderedNumber: undefined, listDepth: undefined },
      { type: 'image', text: 'head', bullet: undefined, orderedNumber: undefined, listDepth: undefined },
      { type: 'text', text: 'tail', bullet: undefined, orderedNumber: undefined, listDepth: undefined }
    ])
    expect(model.blocks[2]).toMatchObject({
      runs: [expect.objectContaining({ text: 'link', link: 'https://example.org/picture' })]
    })
    expect(model.blocks[4]).toMatchObject({
      runs: expect.arrayContaining([
        expect.objectContaining({ text: 'tail', link: 'https://example.org/picture' }),
        expect.objectContaining({ text: ' end' })
      ])
    })
    expect(model.blocks[9]).toMatchObject({ type: 'heading', level: 2 })
    expect(model.blocks[11]).toMatchObject({ type: 'text' })
    const embedded = [...model.images.values()]
    expect(embedded).toEqual(expect.arrayContaining([plain, linked, lead, follow]))
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

  it('writes the opening Office marker only when a table starts the list item', async () => {
    const opening = '1. | A | B |\n   | --- | --- |\n   | 1 | 2 |\n2. Next\n'
    const parsed = parseMarkdown(opening)
    expect(parsed.find((block) => block.type === 'table')).toMatchObject({
      bullet: 1,
      orderedNumber: 1,
      listDepth: 1
    })
    const word = await JSZip.loadAsync(await convertDocx(parsed, new Map(), 'Table'))
    const documentXml = await word.file('word/document.xml')!.async('string')
    const numberingXml = await word.file('word/numbering.xml')!.async('string')
    const numbered = paragraphs(documentXml).filter((item) => item.numId)
    const tableMarker = numbered.find((item) => item.text !== 'Next')
    const next = numbered.find((item) => item.text === 'Next')
    expect(numberingLevel(numberingXml, tableMarker?.numId, tableMarker?.ilvl)).toEqual({ start: '1', indent: '720' })
    expect(numberingLevel(numberingXml, next?.numId, next?.ilvl)).toEqual({ start: '2', indent: '720' })
    expect(tableIndents(documentXml)).toContainEqual({ width: '720', type: 'dxa' })
    expect(documentXml.indexOf('<w:numId')).toBeLessThan(documentXml.indexOf('<w:tbl>'))

    const zip = await JSZip.loadAsync(await convertPptx(parsed, new Map(), 'Table'))
    const slideXml = await Promise.all(
      Object.keys(zip.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort()
        .map((name) => zip.file(name)!.async('string'))
    )
    const shapes = slideXml.flatMap((xml, slide) =>
      [...xml.matchAll(/<p:(sp|graphicFrame)\b[\s\S]*?<\/p:\1>/g)].map((match) => ({
        kind: match[1],
        text: [...match[0].matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((part) => part[1]).join(''),
        x: Number(match[0].match(/<a:off x="(-?\d+)"/)?.[1]),
        marker: pptxMarker(match[0]),
        startAt: match[0].match(/startAt="(\d+)"/)?.[1],
        slide
      }))
    )
    const marker = shapes.find((shape) => shape.kind === 'sp' && shape.marker === 'number' && shape.startAt === '1')
    const table = shapes.find((shape) => shape.kind === 'graphicFrame')
    const following = shapes.find((shape) => shape.text === 'Next')
    expect(marker?.slide).toBe(table?.slide)
    expectStep(table!.x - marker!.x, STEP)
    expect(following).toMatchObject({ marker: 'number', startAt: '2' })

    const continued = parseMarkdown('1. Intro\n   | A | B |\n   | --- | --- |\n   | 1 | 2 |\n2. Next\n')
    const continuedTable = continued.find((block) => block.type === 'table')
    expect(continuedTable?.type).toBe('table')
    expect(continuedTable && 'bullet' in continuedTable ? continuedTable.bullet : undefined).toBeUndefined()
    expect(continuedTable && 'listDepth' in continuedTable ? continuedTable.listDepth : undefined).toBe(1)
    const continuedXml = await (
      await JSZip.loadAsync(await convertDocx(continued, new Map(), 'Continued'))
    )
      .file('word/document.xml')!
      .async('string')
    const continuedNumbers = paragraphs(continuedXml).filter((item) => item.numId)
    expect(continuedNumbers.map((item) => item.text)).toEqual(['Intro', 'Next'])

    const nested = parseMarkdown('- Parent\n  - | A | B |\n    | --- | --- |\n    | 1 | 2 |\n- Next\n')
    const nestedXml = await (
      await JSZip.loadAsync(await convertDocx(nested, new Map(), 'Nested'))
    )
      .file('word/document.xml')!
      .async('string')
    const nestedItems = paragraphs(nestedXml).filter((item) => item.numId)
    expect(nestedItems.map((item) => item.ilvl)).toEqual(['0', '1', '0'])
    expect(nestedItems.map((item) => item.text)).toEqual(['Parent', '\u00a0', 'Next'])

    const longRows = Array.from({ length: 24 }, (_value, index) => `   | ${index} | cell |`).join('\n')
    const paged = parseMarkdown(`1. | A | B |\n   | --- | --- |\n${longRows}\n2. Next\n`)
    const pagedZip = await JSZip.loadAsync(await convertPptx(paged, new Map(), 'Paged'))
    const pagedSlides = await Promise.all(
      Object.keys(pagedZip.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort()
        .map((name) => pagedZip.file(name)!.async('string'))
    )
    const tableSlides = pagedSlides.filter((xml) => xml.includes('<a:tbl>'))
    expect(tableSlides.length).toBeGreaterThan(1)
    expect(tableSlides[0]).toContain('startAt="1"')
    expect(tableSlides.slice(1).every((xml) => !xml.includes('startAt="1"'))).toBe(true)
    const nextSlide = pagedSlides.find((xml) => xml.includes('>Next<'))
    expect(nextSlide).toContain('startAt="2"')
  })
})
