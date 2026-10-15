// @vitest-environment jsdom

import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'

import { readWorkbook } from '@cherrystudio/spreadsheet'

import { convertDocx } from '../docx'
import { extractHtmlDocument } from '../htmlDocument'
import { parseMarkdown } from '../parseMarkdown'
import { documentToMarkdown, flattenDocumentBlocks } from '../serializeDocument'
import { convertXlsx } from '../xlsx'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('HTML layout text extraction', () => {
  it('preserves code indentation and trailing whitespace through HTML-to-Markdown conversion', () => {
    const code = '    first()\n\t  second()  \n\n'
    document.body.innerHTML = `<pre style="white-space:pre">${code}</pre>`
    const { blocks } = extractHtmlDocument()
    expect(parseMarkdown(documentToMarkdown(blocks, (source) => source))).toMatchObject([{ type: 'code', text: code }])
  })

  it.each(['flex', 'grid'])('retains direct text around inline children in a %s container', (display) => {
    document.body.innerHTML = `<div style="display:${display}">Total: <span style="display:inline">10</span><span style="display:inline">USD</span></div>`
    const { blocks } = extractHtmlDocument()
    expect(parseMarkdown(documentToMarkdown(blocks, (source) => source))).toMatchObject([
      { type: 'text', text: 'Total: 10USD' }
    ])
  })

  it('retains direct and nested block text in source order', () => {
    document.body.innerHTML = '<div style="display:flex">Before <div>Middle</div> after <div>Last</div> end</div>'
    const { blocks } = extractHtmlDocument()
    expect(flattenDocumentBlocks(blocks).map((block) => ('text' in block ? block.text : undefined))).toEqual([
      'Before',
      'Middle',
      'after',
      'Last',
      'end'
    ])
  })

  it('keeps columns when direct text contains only layout whitespace', () => {
    document.body.innerHTML = '<div style="display:flex">\n <div>Left</div>\n <div>Right</div>\n</div>'
    expect(extractHtmlDocument().blocks).toMatchObject([
      { type: 'columns', columns: [[{ text: 'Left' }], [{ text: 'Right' }]] }
    ])
  })

  it('keeps paragraph boundaries and inline styles inside a table cell through XLSX and DOCX', async () => {
    document.body.innerHTML =
      '<table><tr><td><p>Hello <span style="font-weight:700">bold</span> tail</p><p>Second</p></td><td><span>A</span><span>B</span></td></tr></table>'
    const { blocks } = extractHtmlDocument()
    const table = blocks[0]
    expect(table).toMatchObject({ type: 'table', rows: [['Hello bold tail\nSecond', 'AB']] })
    if (table?.type !== 'table') throw new Error('expected a table')
    const [styled, inline] = table.cells?.[0] ?? []
    expect(styled?.runs.map((run) => run.text).join('')).toBe('Hello bold tail\nSecond')
    expect(styled?.runs.find((run) => run.text === 'bold')).toMatchObject({ bold: true })
    expect(styled?.runs.some((run) => run.text.includes('\n') && run.bold)).toBe(false)
    expect(inline?.runs.map((run) => run.text).join('')).toBe('AB')

    const workbook = await readWorkbook(Uint8Array.from(await convertXlsx(blocks)).buffer)
    expect(workbook.worksheets[0].getCell('A1').value).toBe('Hello bold tail\nSecond')
    expect(workbook.worksheets[0].getCell('B1').value).toBe('AB')

    const word = await JSZip.loadAsync(await convertDocx(blocks, new Map(), 'Cells'))
    const documentXml = await word.file('word/document.xml')!.async('string')
    const cellXml = documentXml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []
    expect(cellXml).toHaveLength(2)
    const [styledCell = '', inlineCell = ''] = cellXml
    expect(textsOf(styledCell)).toEqual(expect.arrayContaining(['Hello ', 'bold', ' tail', 'Second']))
    expect(styledCell).toContain('<w:br')
    expect(styledCell.indexOf('<w:br')).toBeGreaterThan(styledCell.indexOf('bold'))
    expect(styledCell.indexOf('<w:br')).toBeLessThan(styledCell.lastIndexOf('Second'))
    const boldRun = styledCell.match(/<w:r>[\s\S]*?bold[\s\S]*?<\/w:r>/)?.[0] ?? ''
    expect(boldRun).toContain('<w:b')
    expect(textsOf(inlineCell).join('')).toBe('AB')
    expect(inlineCell).not.toContain('<w:br')
  })

  it('keeps the first heading text and its level when an image splits the heading', () => {
    document.body.innerHTML =
      '<ol start="10"><li><h1 style="text-align:center">Before <span style="display:inline;font-weight:700">styled</span> <img alt="chart" src="chart.png"> after</h1></li></ol>'
    const blocks = extractHtmlDocument().blocks
    expect(blocks.map(blockShape)).toEqual([
      { type: 'heading', level: 1, text: 'Before styled', bullet: 1, orderedNumber: 10, listDepth: 1 },
      { type: 'image', text: 'chart', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'after', bullet: undefined, orderedNumber: undefined, listDepth: 1 }
    ])
    expect(blocks[0]).toMatchObject({
      style: { align: 'center' },
      runs: expect.arrayContaining([expect.objectContaining({ text: 'styled', bold: true })])
    })
    expect(blocks[2]).toMatchObject({ style: { align: 'center' } })
    expect(blocks.filter((block) => block.type !== 'columns' && block.bullet)).toHaveLength(1)
  })

  it('keeps an image-leading heading at the parser level after the image', () => {
    document.body.innerHTML = '<ol start="4"><li><h2><img alt="chart" src="chart.png"> Title</h2></li></ol>'
    const blocks = extractHtmlDocument().blocks
    expect(blocks.map(blockShape)).toEqual([
      { type: 'image', text: 'chart', bullet: 1, orderedNumber: 4, listDepth: 1 },
      { type: 'heading', level: 2, text: 'Title', bullet: undefined, orderedNumber: undefined, listDepth: 1 }
    ])
  })

  it('preserves pre whitespace around an image on the mixed flush', () => {
    const before = '  keep\t'
    const after = '  tail\n'
    document.body.innerHTML = `<ul><li><pre style="white-space:pre">${before}<img alt="chart" src="chart.png">${after}</pre></li></ul>`
    const blocks = extractHtmlDocument().blocks
    expect(blocks.map(blockShape)).toEqual([
      { type: 'code', text: before, bullet: 1, orderedNumber: undefined, listDepth: 1 },
      { type: 'image', text: 'chart', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'code', text: after, bullet: undefined, orderedNumber: undefined, listDepth: 1 }
    ])
  })

  it('separates a table-cell block from the inline text that follows it', () => {
    document.body.innerHTML = '<table><tr><td><p>First</p><span style="font-weight:700">tail</span></td></tr></table>'
    const table = extractHtmlDocument().blocks[0]
    expect(table).toMatchObject({ type: 'table', rows: [['First\ntail']] })
    if (table?.type !== 'table') throw new Error('expected a table')
    const runs = table.cells?.[0]?.[0]?.runs ?? []
    expect(runs.map((run) => run.text).join('')).toBe('First\ntail')
    expect(runs.find((run) => run.text === 'tail')).toMatchObject({ bold: true })
    expect(runs.some((run) => run.text.includes('\n') && run.bold)).toBe(false)
  })
})

function blockShape(block: ReturnType<typeof extractHtmlDocument>['blocks'][number]) {
  if (block.type === 'columns') return { type: block.type }
  return {
    type: block.type,
    ...('text' in block ? { text: block.text } : {}),
    ...(block.type === 'heading' ? { level: block.level } : {}),
    bullet: block.bullet,
    orderedNumber: block.orderedNumber,
    listDepth: block.listDepth
  }
}

function textsOf(xml: string): string[] {
  return [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((match) => match[1])
}
