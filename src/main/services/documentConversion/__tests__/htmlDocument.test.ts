// @vitest-environment jsdom

import JSZip from 'jszip'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'

import { readWorkbook } from '@cherrystudio/spreadsheet'

import { convertDocx } from '../docx'
import { extractHtmlDocument } from '../htmlDocument'
import { parseMarkdown } from '../parseMarkdown'
import { documentToHtml, documentToMarkdown, flattenDocumentBlocks } from '../serializeDocument'
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

  it('keeps enclosing heading semantics on a leading block span', () => {
    document.body.innerHTML = '<h2><span style="display:block">Quarterly</span> Report</h2>'
    expect(extractHtmlDocument().blocks.map(blockShape)).toEqual([
      {
        type: 'heading',
        level: 2,
        text: 'Quarterly',
        bullet: undefined,
        orderedNumber: undefined,
        listDepth: undefined
      },
      { type: 'text', text: 'Report', bullet: undefined, orderedNumber: undefined, listDepth: undefined }
    ])
  })

  it('keeps enclosing heading semantics on a block title after an image', () => {
    document.body.innerHTML =
      '<h2><img src="logo.png" alt="logo"><span style="display:block">Quarterly Report</span></h2>'
    const blocks = extractHtmlDocument().blocks
    expect(blocks.map(blockShape)).toEqual([
      { type: 'image', text: 'logo', bullet: undefined, orderedNumber: undefined, listDepth: undefined },
      {
        type: 'heading',
        level: 2,
        text: 'Quarterly Report',
        bullet: undefined,
        orderedNumber: undefined,
        listDepth: undefined
      }
    ])
  })

  it('keeps enclosing heading semantics on a nested styled block wrapper', () => {
    document.body.innerHTML =
      '<h2><span style="display:block"><span style="font-weight:700">Quarterly</span></span> Report</h2>'
    const blocks = extractHtmlDocument().blocks
    expect(blocks.map(blockShape)).toEqual([
      {
        type: 'heading',
        level: 2,
        text: 'Quarterly',
        bullet: undefined,
        orderedNumber: undefined,
        listDepth: undefined
      },
      { type: 'text', text: 'Report', bullet: undefined, orderedNumber: undefined, listDepth: undefined }
    ])
    expect(blocks[0]).toMatchObject({
      runs: [expect.objectContaining({ text: 'Quarterly', bold: true })]
    })
  })

  it('applies the heading level to the first column text and leaves later text untitled', () => {
    document.body.innerHTML = '<h2><div style="display:flex"><div>Left</div><div>Right</div></div> leftover</h2>'
    const blocks = extractHtmlDocument().blocks
    expect(blocks.map(blockShape)).toEqual([
      { type: 'columns' },
      { type: 'text', text: 'leftover', bullet: undefined, orderedNumber: undefined, listDepth: undefined }
    ])
    expect(blocks[0]).toMatchObject({
      type: 'columns',
      columns: [[{ type: 'heading', level: 2, text: 'Left' }], [{ type: 'text', text: 'Right' }]]
    })
  })

  it('applies the enclosing level once to a nested heading and leaves later paragraphs as text', () => {
    document.body.innerHTML =
      '<ol start="3"><li><h2><span style="display:block"><h3 style="font-weight:700;text-align:center">Quarterly</h3><p>Body</p></span> tail</h2></li></ol>'
    const heading = document.querySelector('h2')
    expect(heading?.querySelector(':scope > span > h3')?.textContent).toBe('Quarterly')
    expect(heading?.querySelector(':scope > h3')).toBeNull()
    expect(heading?.querySelector('p')?.textContent).toBe('Body')
    const blocks = extractHtmlDocument().blocks
    expect(blocks.map(blockShape)).toEqual([
      { type: 'heading', level: 2, text: 'Quarterly', bullet: 1, orderedNumber: 3, listDepth: 1 },
      { type: 'text', text: 'Body', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'tail', bullet: undefined, orderedNumber: undefined, listDepth: 1 }
    ])
    expect(blocks[0]).toMatchObject({
      style: { align: 'center' },
      runs: [expect.objectContaining({ text: 'Quarterly', bold: true })]
    })
    expect(blocks.filter((block) => block.type === 'heading')).toHaveLength(1)
  })

  it('applies the enclosing level to a heading in the first column and leaves later text untitled', () => {
    document.body.innerHTML =
      '<h2><div style="display:flex"><div><h3 style="text-align:right">Left</h3></div><div>Right</div></div> leftover</h2>'
    const heading = document.querySelector('h2')
    expect(heading?.querySelector('div h3')?.textContent).toBe('Left')
    const blocks = extractHtmlDocument().blocks
    expect(blocks.map(blockShape)).toEqual([
      { type: 'columns' },
      { type: 'text', text: 'leftover', bullet: undefined, orderedNumber: undefined, listDepth: undefined }
    ])
    expect(blocks[0]).toMatchObject({
      type: 'columns',
      columns: [
        [{ type: 'heading', level: 2, text: 'Left', style: { align: 'right' } }],
        [{ type: 'text', text: 'Right' }]
      ]
    })
    expect(blocks.filter((block) => block.type === 'heading')).toHaveLength(0)
  })

  it('keeps image order and the first heading when a heading row would otherwise become columns', () => {
    document.body.innerHTML =
      '<h2 style="display:flex"><img alt="logo" src="logo.png"><span>Quarterly Report</span></h2>'
    const { blocks, warnings } = extractHtmlDocument()
    expect(blocks.map(blockShape)).toEqual([
      { type: 'image', text: 'logo', bullet: undefined, orderedNumber: undefined, listDepth: undefined },
      {
        type: 'heading',
        level: 2,
        text: 'Quarterly Report',
        bullet: undefined,
        orderedNumber: undefined,
        listDepth: undefined
      }
    ])
    expect(warnings).toContain('complex_layout')
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

  it.each([
    [
      'columns then a normal item',
      '<ol start="4"><li><div style="display:flex"><div>Left</div><div>Right</div></div></li><li>Next</li></ol>',
      [
        { type: 'text', text: 'Left', bullet: 1, orderedNumber: 4, listDepth: 1 },
        { type: 'text', text: 'Right', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
        { type: 'text', text: 'Next', bullet: 1, orderedNumber: 5, listDepth: 1 }
      ]
    ],
    [
      'nested columns',
      '<ol start="4"><li><div style="display:flex"><div><div style="display:flex"><div>A</div><div>B</div></div></div><div>C</div></div></li><li>Next</li></ol>',
      [
        { type: 'text', text: 'A', bullet: 1, orderedNumber: 4, listDepth: 1 },
        { type: 'text', text: 'B', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
        { type: 'text', text: 'C', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
        { type: 'text', text: 'Next', bullet: 1, orderedNumber: 5, listDepth: 1 }
      ]
    ]
  ])('numbers %s on the first column leaf', async (_label, html, leaves) => {
    document.body.innerHTML = html
    const blocks = extractHtmlDocument().blocks
    expect(blocks[0]).toMatchObject({ type: 'columns', widths: [expect.any(Number), expect.any(Number)] })
    expect(listLeaves(blocks).map(blockShape)).toEqual(leaves)
    expect(parseMarkdown(documentToMarkdown(blocks, (source) => source)).map(blockShape)).toEqual(leaves)
    await expectOrderedStarts(blocks, [4, 5])
  })

  it('numbers an image-first column item before the following item', async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .png()
      .toBuffer()
    document.body.innerHTML = `<ol start="4"><li><div style="display:flex"><div><img alt="chart" src="data:image/png;base64,${png.toString('base64')}"></div><div>Right</div></div></li><li>Next</li></ol>`
    const blocks = extractHtmlDocument().blocks
    const image = listLeaves(blocks).find((block) => block.type === 'image')
    if (!image || image.type !== 'image') throw new Error('expected an image')
    expect(listLeaves(blocks).map(blockShape)).toEqual([
      { type: 'image', text: 'chart', bullet: 1, orderedNumber: 4, listDepth: 1 },
      { type: 'text', text: 'Right', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Next', bullet: 1, orderedNumber: 5, listDepth: 1 }
    ])
    await expectOrderedStarts(blocks, [4, 5], new Map([[image.source, png]]))
  })

  it('advances past an empty item', async () => {
    document.body.innerHTML = '<ol start="4"><li></li><li>Next</li></ol>'
    const blocks = extractHtmlDocument().blocks
    expect(listLeaves(blocks).map(blockShape)).toEqual([
      { type: 'text', text: 'Next', bullet: 1, orderedNumber: 5, listDepth: 1 }
    ])
    expect(parseMarkdown(documentToMarkdown(blocks, (source) => source)).map(blockShape)).toEqual([
      { type: 'text', text: 'Next', bullet: 1, orderedNumber: 5, listDepth: 1 }
    ])
    await expectOrderedStarts(blocks, [5])
  })

  it('emits an empty parent item before a leading nested list and continues later text', async () => {
    document.body.innerHTML = '<ul><li><ul><li>Child</li></ul><p>More</p></li><li>Next</li></ul>'
    const blocks = extractHtmlDocument().blocks
    expect(parseMarkdown(documentToMarkdown(blocks, (source) => source)).map(blockShape)).toEqual([
      { type: 'text', text: '', bullet: 1, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Child', bullet: 2, orderedNumber: undefined, listDepth: 2 },
      { type: 'text', text: 'More', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Next', bullet: 1, orderedNumber: undefined, listDepth: 1 }
    ])
    const xml = await JSZip.loadAsync(await convertDocx(blocks, new Map(), 'List')).then((zip) =>
      zip.file('word/document.xml')!.async('string')
    )
    const listed = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].flatMap((match) => {
      const paragraph = match[0]
      const level = paragraph.match(/<w:ilvl w:val="(\d+)"/)?.[1]
      if (level === undefined) return []
      return [
        {
          level: Number(level),
          text: [...paragraph.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((text) => text[1]).join('')
        }
      ]
    })
    expect(listed).toEqual([
      { level: 0, text: '' },
      { level: 1, text: 'Child' },
      { level: 0, text: 'Next' }
    ])
    const more = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].find((match) => match[0].includes('More'))
    expect(more?.[0]).toBeTruthy()
    expect(more?.[0]).not.toContain('<w:numPr')
  })

  it('lets the first column parent own the marker when a later column is a nested list', async () => {
    document.body.innerHTML =
      '<ul><li><div style="display:flex"><section><p>Parent</p></section><section><ul><li>Child</li></ul></section></div><p>More</p></li><li>Next</li></ul>'
    const { blocks, warnings } = extractHtmlDocument()
    expect(warnings).toContain('complex_layout')
    const leaves = [
      { type: 'text', text: 'Parent', bullet: 1, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Child', bullet: 2, orderedNumber: undefined, listDepth: 2 },
      { type: 'text', text: 'More', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Next', bullet: 1, orderedNumber: undefined, listDepth: 1 }
    ]
    expect(listLeaves(blocks).map(blockShape)).toEqual(leaves)
    expect(parseMarkdown(documentToMarkdown(blocks, (source) => source)).map(blockShape)).toEqual(leaves)
    const html = documentToHtml(blocks, (source) => source, 'List')
    expect(html).toContain('Parent')
    expect(html.indexOf('Parent')).toBeLessThan(html.indexOf('Child'))
    expect(html.slice(html.indexOf('Parent'), html.indexOf('Next'))).toContain('More')
    const xml = await JSZip.loadAsync(await convertDocx(blocks, new Map(), 'List')).then((zip) =>
      zip.file('word/document.xml')!.async('string')
    )
    const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map((match) => match[0])
    const listed = paragraphs.flatMap((paragraph) => {
      const level = paragraph.match(/<w:ilvl w:val="(\d+)"/)?.[1]
      if (level === undefined) return []
      return [
        {
          level: Number(level),
          text: [...paragraph.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((text) => text[1]).join('')
        }
      ]
    })
    expect(listed).toEqual([
      { level: 0, text: 'Parent' },
      { level: 1, text: 'Child' },
      { level: 0, text: 'Next' }
    ])
    const more = paragraphs.find((paragraph) => paragraph.includes('More'))
    expect(more).toBeTruthy()
    expect(more).not.toContain('<w:numPr')
  })

  it('keeps column lists after a finished list independent of that list', () => {
    document.body.innerHTML =
      '<ul><li>Before</li></ul><div style="display:flex"><section><ul><li>Left</li></ul></section><section><ul><li>Right</li></ul></section></div>'
    const blocks = extractHtmlDocument().blocks
    const leaves = [
      { type: 'text', text: 'Before', bullet: 1, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Left', bullet: 1, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Right', bullet: 1, orderedNumber: undefined, listDepth: 1 }
    ]
    expect(listLeaves(blocks).map(blockShape)).toEqual(leaves)
    expect(blocks[1]?.type).toBe('columns')
    expect(blocks[1]?.type === 'columns' && blocks[1].listDepth).toBeUndefined()
    expect(parseMarkdown(documentToMarkdown(blocks, (source) => source)).map(blockShape)).toEqual(leaves)
    const html = documentToHtml(blocks, (source) => source, 'List')
    const before = html.indexOf('Before')
    const left = html.indexOf('Left')
    expect(html.slice(before, left)).toContain('</ul>')
  })

  it('keeps an ordered parent that starts in columns as that ordered list', async () => {
    document.body.innerHTML =
      '<ol start="3"><li><div style="display:flex"><section><p>Parent</p></section><section><ul><li>Child</li></ul></section></div><p>More</p></li><li>Next</li></ol>'
    const { blocks, warnings } = extractHtmlDocument()
    expect(warnings).toContain('complex_layout')
    expect(listLeaves(blocks).map(blockShape)).toEqual([
      { type: 'text', text: 'Parent', bullet: 1, orderedNumber: 3, listDepth: 1 },
      { type: 'text', text: 'Child', bullet: 2, orderedNumber: undefined, listDepth: 2 },
      { type: 'text', text: 'More', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Next', bullet: 1, orderedNumber: 4, listDepth: 1 }
    ])
    const html = documentToHtml(blocks, (source) => source, 'List')
    expect(html.indexOf('<ol')).toBeLessThan(html.indexOf('Parent'))
    expect(html.slice(0, html.indexOf('Parent'))).not.toContain('<ul')
    expect(html).toContain('start="3"')
  })

  it('continues parent text after a nested child when later columns belong to the parent', () => {
    document.body.innerHTML =
      '<ul><li><p>Parent</p><ul><li>Child</li></ul><div style="display:flex"><section><p>More</p></section><section><p>Tail</p></section></div></li><li>Next</li></ul>'
    const { blocks, warnings } = extractHtmlDocument()
    expect(warnings).toContain('complex_layout')
    expect(listLeaves(blocks).map(blockShape)).toEqual([
      { type: 'text', text: 'Parent', bullet: 1, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Child', bullet: 2, orderedNumber: undefined, listDepth: 2 },
      { type: 'text', text: 'More', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Tail', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Next', bullet: 1, orderedNumber: undefined, listDepth: 1 }
    ])
    const html = documentToHtml(blocks, (source) => source, 'List')
    expect(html.slice(html.indexOf('Child'), html.indexOf('More'))).toContain('</li>')
  })

  it('keeps a later column parent as a sibling of the previous item', () => {
    document.body.innerHTML =
      '<ul><li>Before</li><li><div style="display:flex"><section><p>Parent</p></section><section><ul><li>Child</li></ul></section></div><p>More</p></li><li>Next</li></ul>'
    const { blocks, warnings } = extractHtmlDocument()
    expect(warnings).toContain('complex_layout')
    expect(listLeaves(blocks).map(blockShape)).toEqual([
      { type: 'text', text: 'Before', bullet: 1, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Parent', bullet: 1, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Child', bullet: 2, orderedNumber: undefined, listDepth: 2 },
      { type: 'text', text: 'More', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Next', bullet: 1, orderedNumber: undefined, listDepth: 1 }
    ])
    const html = documentToHtml(blocks, (source) => source, 'List')
    expect(html.slice(html.indexOf('Before'), html.indexOf('Parent'))).toContain('</li>')
  })

  it('resets numbering from an explicit item value', async () => {
    document.body.innerHTML = '<ol start="4"><li>First</li><li value="9">Jump</li><li>After</li></ol>'
    const blocks = extractHtmlDocument().blocks
    const leaves = [
      { type: 'text', text: 'First', bullet: 1, orderedNumber: 4, listDepth: 1 },
      { type: 'text', text: 'Jump', bullet: 1, orderedNumber: 9, listDepth: 1 },
      { type: 'text', text: 'After', bullet: 1, orderedNumber: 10, listDepth: 1 }
    ]
    expect(listLeaves(blocks).map(blockShape)).toEqual(leaves)
    await expectOrderedStarts(blocks, [4, 9, 10])
  })
})

function listLeaves(blocks: ReturnType<typeof extractHtmlDocument>['blocks']) {
  const leaves: typeof blocks = []
  const visit = (items: typeof blocks) => {
    for (const block of items) {
      if (block.type === 'columns') block.columns.forEach(visit)
      else leaves.push(block)
    }
  }
  visit(blocks)
  return leaves
}

async function expectOrderedStarts(
  blocks: ReturnType<typeof extractHtmlDocument>['blocks'],
  markers: number[],
  images = new Map<string, Buffer>()
) {
  const xml = await JSZip.loadAsync(await convertDocx(blocks, images, 'List')).then((zip) =>
    zip.file('word/numbering.xml')!.async('string')
  )
  const starts = [...xml.matchAll(/<w:start w:val="(\d+)"/g)]
    .map((match) => Number(match[1]))
    .filter((start) => start >= 4)
  expect(starts).toEqual(markers)
}

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
