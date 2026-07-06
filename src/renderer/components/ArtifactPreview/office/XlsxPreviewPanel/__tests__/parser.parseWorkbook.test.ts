import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { beforeAll, describe, expect, it } from 'vitest'

import { createZipBytes } from '../../__tests__/zipTestBytes'
import { OFFICE_ZIP_LIMITS } from '../../zipPreflight'
import type { CellStyle, WorkbookRenderModel } from '../renderModel'
import { parseWorkbook } from '../worker/parseWorkbook'
import { buildChartWorkbookArrayBuffer } from './xlsxTestPackages'

async function toArrayBuffer(workbook: ExcelJS.Workbook): Promise<ArrayBuffer> {
  const buf = await workbook.xlsx.writeBuffer()
  // writeBuffer() returns Buffer (a Uint8Array subclass) in Node; copy it into an independent ArrayBuffer.
  const view = buf as unknown as Uint8Array
  const arrayBuffer = new ArrayBuffer(view.byteLength)
  new Uint8Array(arrayBuffer).set(view)
  return arrayBuffer
}

const excelColor = (color: { theme?: number; tint?: number; indexed?: number }): ExcelJS.Color =>
  color as unknown as ExcelJS.Color

describe('parseWorkbook — sheets, values, hidden', () => {
  let model: WorkbookRenderModel

  beforeAll(async () => {
    const wb = new ExcelJS.Workbook()

    const s1 = wb.addWorksheet('Data')
    s1.getCell('A1').value = 'hello'
    s1.getCell('A2').value = 42
    s1.getCell('A3').value = true
    s1.getCell('A4').value = new Date(Date.UTC(2026, 0, 15))
    s1.getCell('A5').value = { richText: [{ text: 'Hello ' }, { text: 'World', font: { bold: true } }] }
    s1.getCell('A6').value = { text: 'Cherry Studio', hyperlink: 'https://github.com/CherryHQ/cherry-studio' }
    s1.getCell('A7').value = { error: '#DIV/0!' }
    // sparse: leave gaps

    const s2 = wb.addWorksheet('Hidden', { state: 'hidden' })
    s2.getCell('A1').value = 'secret'

    const buffer = await toArrayBuffer(wb)
    model = await parseWorkbook(buffer, 'sample.xlsx')
  })

  it('parses multiple sheets and preserves order/name', () => {
    expect(model.sheets.map((s) => s.name)).toEqual(['Data', 'Hidden'])
  })

  it('marks hidden sheet as hidden but still parses its cells', () => {
    const hidden = model.sheets.find((s) => s.name === 'Hidden')!
    expect(hidden.hidden).toBe(true)
    expect(hidden.cells['1:1'].text).toBe('secret')
  })

  it('does not create entries for empty cells (sparse)', () => {
    const data = model.sheets[0]
    expect(data.cells['100:100']).toBeUndefined()
  })

  it('string value: raw + text', () => {
    const cell = model.sheets[0].cells['1:1']
    expect(cell.raw).toBe('hello')
    expect(cell.text).toBe('hello')
  })

  it('number value: raw + text', () => {
    const cell = model.sheets[0].cells['2:1']
    expect(cell.raw).toBe(42)
    expect(cell.text).toBe('42')
  })

  it('boolean value: text is TRUE/FALSE', () => {
    const cell = model.sheets[0].cells['3:1']
    expect(cell.raw).toBe(true)
    expect(cell.text).toBe('TRUE')
  })

  it('Date value: raw is ISO string, text formatted (General fallback)', () => {
    const cell = model.sheets[0].cells['4:1']
    expect(typeof cell.raw).toBe('string')
    expect(cell.raw).toContain('2026-01-15')
    expect(cell.text.length).toBeGreaterThan(0)
  })

  it('richText: concatenates plain text, drops run-level styles, warns once', () => {
    const cell = model.sheets[0].cells['5:1']
    expect(cell.text).toBe('Hello World')
    expect(model.warnings).toContain('richtext-run-styles-dropped')
  })

  it('hyperlink: text shown, hyperlink field populated', () => {
    const cell = model.sheets[0].cells['6:1']
    expect(cell.text).toBe('Cherry Studio')
    expect(cell.hyperlink).toBe('https://github.com/CherryHQ/cherry-studio')
  })

  it('error value: text/raw is the error code', () => {
    const cell = model.sheets[0].cells['7:1']
    expect(cell.text).toBe('#DIV/0!')
    expect(cell.raw).toBe('#DIV/0!')
  })
})

describe('parseWorkbook — styles: extraction + dedup', () => {
  let model: WorkbookRenderModel

  beforeAll(async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('S1')

    ws.getCell('A1').value = 'styled-1'
    ws.getCell('A1').font = { bold: true, italic: true, underline: true, strike: true, name: 'Calibri', size: 12 }
    ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }
    ws.getCell('A1').border = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      bottom: { style: 'thick', color: { argb: 'FF111111' } }
    }
    ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }

    // Identical style on a different cell -> should dedup to same styleId
    ws.getCell('B1').value = 'styled-2'
    ws.getCell('B1').font = { bold: true, italic: true, underline: true, strike: true, name: 'Calibri', size: 12 }
    ws.getCell('B1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }
    ws.getCell('B1').border = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      bottom: { style: 'thick', color: { argb: 'FF111111' } }
    }
    ws.getCell('B1').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }

    // Fully default cell -> no styleId
    ws.getCell('C1').value = 'plain'

    const buffer = await toArrayBuffer(wb)
    model = await parseWorkbook(buffer, 'styles.xlsx')
  })

  it('extracts font/fill/border/alignment onto CellStyle', () => {
    const styleId = model.sheets[0].cells['1:1'].styleId!
    const style = model.styles[styleId]
    expect(style.bold).toBe(true)
    expect(style.italic).toBe(true)
    expect(style.underline).toBe(true)
    expect(style.strike).toBe(true)
    expect(style.fontFamily).toBe('Calibri')
    expect(style.fontSizePx).toBeCloseTo(12 * (4 / 3))
    expect(style.bg).toBe('#ffff00')
    expect(style.borderTop).toEqual({ style: 'thin', color: '#000000' })
    expect(style.borderBottom).toEqual({ style: 'thick', color: '#111111' })
    expect(style.hAlign).toBe('center')
    expect(style.vAlign).toBe('middle')
    expect(style.wrap).toBe(true)
  })

  it('dedupes identical styles to the same styleId', () => {
    const idA = model.sheets[0].cells['1:1'].styleId
    const idB = model.sheets[0].cells['1:2'].styleId
    expect(idA).toBeDefined()
    expect(idA).toBe(idB)
  })

  it('fully default cell has no styleId', () => {
    expect(model.sheets[0].cells['1:3'].styleId).toBeUndefined()
  })
})

describe('parseWorkbook — merges, row/col sizing, hidden', () => {
  let model: WorkbookRenderModel

  beforeAll(async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('S1')
    ws.mergeCells('A1:C1')
    ws.getCell('A1').value = 'merged header'

    ws.getRow(2).height = 40
    ws.getCell('A2').value = 'tall row'

    // hidden row/col must carry a real value — ExcelJS silently drops hidden
    // metadata for a row/col with zero cell content on write (see report).
    ws.getRow(3).hidden = true
    ws.getCell('A3').value = 'hidden row content'

    ws.getColumn(1).width = 30
    ws.getCell('A4').value = 'wide col'

    ws.getColumn(5).hidden = true
    ws.getCell('E4').value = 'hidden col content'

    const buffer = await toArrayBuffer(wb)
    model = await parseWorkbook(buffer, 'sizing.xlsx')
  })

  it('captures merge ranges (1-based, closed interval)', () => {
    expect(model.sheets[0].merges).toEqual([{ top: 1, left: 1, bottom: 1, right: 3 }])
  })

  it('converts non-default row height pt -> px', () => {
    expect(model.sheets[0].rowHeightsPx[2]).toBeCloseTo((40 * 96) / 72)
  })

  it('hidden row height is 0', () => {
    expect(model.sheets[0].rowHeightsPx[3]).toBe(0)
  })

  it('converts non-default column width chars -> px', () => {
    expect(model.sheets[0].colWidthsPx[1]).toBe(Math.round(30 * 7) + 5)
  })

  it('hidden column width is 0', () => {
    expect(model.sheets[0].colWidthsPx[5]).toBe(0)
  })
})

describe('parseWorkbook — per-sheet defaults + cell-less row definitions', () => {
  let model: WorkbookRenderModel

  beforeAll(async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('S1', { properties: { defaultRowHeight: 30, defaultColWidth: 16 } })
    ws.getCell('A1').value = 'x'
    const buffer = await toArrayBuffer(wb)

    // ExcelJS drops row definitions with no cells and no height when writing, because Row.model returns null.
    // Such rows only come from other generators, so inject raw XML with JSZip to recreate the real-world case.
    const zip = await JSZip.loadAsync(buffer)
    const sheetPath = 'xl/worksheets/sheet1.xml'
    const sheetXml = await zip.file(sheetPath)!.async('string')
    zip.file(
      sheetPath,
      sheetXml.replace('</sheetData>', '<row r="7" hidden="1"/><row r="8" ht="30" customHeight="1"/></sheetData>')
    )
    model = await parseWorkbook(await zip.generateAsync({ type: 'arraybuffer' }), 'defaults.xlsx')
  })

  it('reads sheetFormatPr defaultRowHeight into defaultRowHeightPx (pt -> px)', () => {
    expect(model.sheets[0].defaultRowHeightPx).toBeCloseTo((30 * 96) / 72)
  })

  it('reads sheetFormatPr defaultColWidth into defaultColWidthPx (chars -> px)', () => {
    expect(model.sheets[0].defaultColWidthPx).toBe(Math.round(16 * 7) + 5)
  })

  it('keeps a hidden row definition that has no cells (height 0)', () => {
    expect(model.sheets[0].rowHeightsPx[7]).toBe(0)
  })

  it('keeps a custom-height row definition that has no cells', () => {
    expect(model.sheets[0].rowHeightsPx[8]).toBeCloseTo((30 * 96) / 72)
  })
})

describe('parseWorkbook — formulas: three states', () => {
  let model: WorkbookRenderModel

  beforeAll(async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('S1')

    ws.getCell('A1').value = 10
    ws.getCell('A2').value = 20
    // cached: has result baked in by the writer
    ws.getCell('A3').value = { formula: 'A1+A2', result: 30 }
    // no cache: parser must invoke the formula evaluator
    ws.getCell('A4').value = { formula: 'A1*A2' }
    // an evaluator-unfriendly / unknown function should remain unevaluated
    ws.getCell('A5').value = { formula: 'NOTAREALFUNCTION(A1)' }

    const buffer = await toArrayBuffer(wb)
    model = await parseWorkbook(buffer, 'formulas.xlsx')
  })

  it('cached formula: formulaState=cached, text = formatted cached result', () => {
    const cell = model.sheets[0].cells['3:1']
    expect(cell.formula).toBe('A1+A2')
    expect(cell.formulaState).toBe('cached')
    expect(cell.text).toBe('30')
  })

  it('formula without cache: either evaluated correctly or unevaluated with formula text shown', () => {
    const cell = model.sheets[0].cells['4:1']
    expect(cell.formula).toBe('A1*A2')
    if (cell.formulaState === 'evaluated') {
      expect(cell.text).toBe('200')
    } else {
      expect(cell.formulaState).toBe('unevaluated')
      expect(cell.text).toBe('=A1*A2')
    }
  })

  it('unresolvable function formula ends up unevaluated with formula text shown, greyed by UI', () => {
    const cell = model.sheets[0].cells['5:1']
    expect(cell.formula).toBe('NOTAREALFUNCTION(A1)')
    expect(cell.formulaState).toBe('unevaluated')
    expect(cell.text).toBe('=NOTAREALFUNCTION(A1)')
  })
})

describe('parseWorkbook — formulas: forward references evaluate recursively', () => {
  let model: WorkbookRenderModel

  beforeAll(async () => {
    const wb = new ExcelJS.Workbook()
    const ws1 = wb.addWorksheet('S1')
    const ws2 = wb.addWorksheet('S2')

    // A1 references B2, which appears later in file order on the same sheet.
    ws1.getCell('A1').value = { formula: 'B2*2' }
    ws1.getCell('B2').value = { formula: 'SUM(3,4)' }
    // A2 references a formula cell on a later sheet.
    ws1.getCell('A2').value = { formula: 'S2!A1+1' }
    ws2.getCell('A1').value = { formula: '5*2' }
    // Mutual reference cycle: must not hang, and both cells should remain unevaluated.
    ws1.getCell('A5').value = { formula: 'A6' }
    ws1.getCell('A6').value = { formula: 'A5' }

    const buffer = await toArrayBuffer(wb)
    model = await parseWorkbook(buffer, 'forward-refs.xlsx')
  })

  it('same-sheet forward reference gets the dependency value, not the null placeholder', () => {
    expect(model.sheets[0].cells['2:2'].text).toBe('7')
    expect(model.sheets[0].cells['1:1'].formulaState).toBe('evaluated')
    expect(model.sheets[0].cells['1:1'].text).toBe('14')
  })

  it('cross-sheet forward reference evaluates the later sheet first', () => {
    expect(model.sheets[1].cells['1:1'].text).toBe('10')
    expect(model.sheets[0].cells['2:1'].formulaState).toBe('evaluated')
    expect(model.sheets[0].cells['2:1'].text).toBe('11')
  })

  it('mutual reference cycle degrades both cells to unevaluated without hanging', () => {
    expect(model.sheets[0].cells['5:1'].formulaState).toBe('unevaluated')
    expect(model.sheets[0].cells['6:1'].formulaState).toBe('unevaluated')
    expect(model.warnings).toContain('formula-unevaluated')
  })
})

describe('parseWorkbook — formulas: shared formula text is translated per cell', () => {
  let model: WorkbookRenderModel

  beforeAll(async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('S1')

    ws.getCell('N4').value = 0
    ws.getCell('N5').value = 2
    ws.getCell('N6').value = 10
    ws.getCell('N7').value = 10

    type SharedFormulaMaster = ExcelJS.CellFormulaValue & { ref: string; shareType: 'shared' }
    const cachedSharedFormulaMaster: SharedFormulaMaster = {
      formula: 'IF(N4=0,"-",N6/N4)',
      result: '-',
      ref: 'O6:O7',
      shareType: 'shared'
    }
    ws.getCell('O6').value = cachedSharedFormulaMaster as ExcelJS.CellValue
    ws.getCell('O7').value = { sharedFormula: 'O6', result: 5 } satisfies ExcelJS.CellSharedFormulaValue

    const uncachedSharedFormulaMaster: SharedFormulaMaster = {
      formula: 'IF(N4=0,"-",N6/N4)',
      ref: 'P6:P7',
      shareType: 'shared'
    }
    ws.getCell('P6').value = uncachedSharedFormulaMaster as ExcelJS.CellValue
    ws.getCell('P7').value = { sharedFormula: 'P6' } satisfies ExcelJS.CellSharedFormulaValue

    const buffer = await toArrayBuffer(wb)
    model = await parseWorkbook(buffer, 'shared-formulas.xlsx')
  })

  it('preserves translated formula text for cached shared-formula dependents', () => {
    const sheet = model.sheets[0]

    expect(sheet.cells['6:15'].formula).toBe('IF(N4=0,"-",N6/N4)')
    expect(sheet.cells['6:15'].formulaState).toBe('cached')
    expect(sheet.cells['6:15'].text).toBe('-')

    expect(sheet.cells['7:15'].formula).toBe('IF(N5=0,"-",N7/N5)')
    expect(sheet.cells['7:15'].formulaState).toBe('cached')
    expect(sheet.cells['7:15'].text).toBe('5')
  })

  it('evaluates uncached shared-formula dependents using their translated formula text', () => {
    const sheet = model.sheets[0]

    expect(sheet.cells['6:16'].formula).toBe('IF(N4=0,"-",N6/N4)')
    expect(sheet.cells['6:16'].formulaState).toBe('evaluated')
    expect(sheet.cells['6:16'].text).toBe('-')

    expect(sheet.cells['7:16'].formula).toBe('IF(N5=0,"-",N7/N5)')
    expect(sheet.cells['7:16'].formulaState).toBe('evaluated')
    expect(sheet.cells['7:16'].text).toBe('5')
  })
})

describe('parseWorkbook — number formats', () => {
  let model: WorkbookRenderModel

  beforeAll(async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('S1')

    ws.getCell('A1').value = 0.4567
    ws.getCell('A1').numFmt = '0.00%'

    ws.getCell('A2').value = 1234.5
    ws.getCell('A2').numFmt = '#,##0.00'

    ws.getCell('A3').value = new Date(Date.UTC(2026, 0, 15))
    ws.getCell('A3').numFmt = 'yyyy-mm-dd'

    ws.getCell('A4').value = 12345678901234
    // General (default, no explicit numFmt)

    const wb1904 = new ExcelJS.Workbook()
    wb1904.properties.date1904 = true
    const ws1904 = wb1904.addWorksheet('S1')
    ws1904.getCell('A1').value = new Date(Date.UTC(2026, 0, 15))
    ws1904.getCell('A1').numFmt = 'yyyy-mm-dd'

    const buffer = await toArrayBuffer(wb)
    model = await parseWorkbook(buffer, 'numfmt.xlsx')

    const buffer1904 = await toArrayBuffer(wb1904)
    model1904 = await parseWorkbook(buffer1904, 'numfmt1904.xlsx')
  })

  let model1904: WorkbookRenderModel

  it('percent format', () => {
    expect(model.sheets[0].cells['1:1'].text).toBe('45.67%')
  })

  it('thousands + 2 decimals format', () => {
    expect(model.sheets[0].cells['2:1'].text).toBe('1,234.50')
  })

  it('date format yyyy-mm-dd (1900 system)', () => {
    expect(model.sheets[0].cells['3:1'].text).toBe('2026-01-15')
  })

  it('General format on a large number does not throw and produces readable text', () => {
    const text = model.sheets[0].cells['4:1'].text
    expect(text.length).toBeGreaterThan(0)
  })

  it('date1904 workbook: ExcelJS already resolves the stored serial to the correct absolute Date, so text is unaffected', () => {
    expect(model1904.sheets[0].cells['1:1'].text).toBe('2026-01-15')
  })
})

describe('parseWorkbook — theme colors', () => {
  let model: WorkbookRenderModel

  beforeAll(async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Theme')

    ws.getCell('A1').value = 'theme text'
    ws.getCell('A1').font = { color: excelColor({ theme: 1 }) }

    ws.getCell('A2').value = 'theme fill'
    ws.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: excelColor({ theme: 0 }) }

    ws.getCell('A3').value = 'theme darker'
    ws.getCell('A3').font = { color: excelColor({ theme: 4, tint: -0.25 }) }

    ws.getCell('A4').value = 'theme lighter'
    ws.getCell('A4').font = { color: excelColor({ theme: 4, tint: 0.4 }) }

    ws.getCell('A5').value = 'indexed red'
    ws.getCell('A5').font = { color: excelColor({ indexed: 2 }) }

    ws.getCell('A6').value = 'indexed yellow'
    ws.getCell('A6').font = { color: excelColor({ indexed: 5 }) }

    ws.getCell('A7').value = 'indexed blue'
    ws.getCell('A7').font = { color: excelColor({ indexed: 12 }) }

    model = await parseWorkbook(await toArrayBuffer(wb), 'theme-colors-runtime.xlsx')
  })

  const styleOf = (model_: WorkbookRenderModel, addr: string): CellStyle | undefined => {
    const cell = model_.sheets[0].cells[addr]
    return cell?.styleId !== undefined ? model_.styles[cell.styleId] : undefined
  }

  it('theme=1 (dk1) resolves to black text', () => {
    expect(styleOf(model, '1:1')?.color).toBe('#000000')
  })

  it('theme=0 (lt1) resolves to white fill', () => {
    expect(styleOf(model, '2:1')?.bg).toBe('#ffffff')
  })

  it('theme=4 (accent1=4F81BD) with tint -0.25 darkens per HSL algorithm', () => {
    expect(styleOf(model, '3:1')?.color).toBe('#376092')
  })

  it('theme=4 (accent1=4F81BD) with tint +0.40 lightens per HSL algorithm', () => {
    expect(styleOf(model, '4:1')?.color).toBe('#95b3d7')
  })

  it('indexed color 2 -> red', () => {
    expect(styleOf(model, '5:1')?.color).toBe('#ff0000')
  })

  it('indexed color 5 -> yellow', () => {
    expect(styleOf(model, '6:1')?.color).toBe('#ffff00')
  })

  it('indexed color 12 -> blue', () => {
    expect(styleOf(model, '7:1')?.color).toBe('#0000ff')
  })
})

describe('parseWorkbook — floating images', () => {
  let model: WorkbookRenderModel

  const PNG_BASE64 =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

  beforeAll(async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('S1')
    const imgId = wb.addImage({ base64: PNG_BASE64, extension: 'png' })
    // oneCellAnchor: tl + ext in px. ExcelJS multiplies by 9525 when writing EMUs and divides back when reading.
    // addImage types require tl/br to be Anchor instances, but runtime accepts plain { col, row } objects.
    // See lib/doc/image.js set model; the test follows runtime behavior.
    ws.addImage(imgId, {
      tl: { col: 1, row: 1 },
      ext: { width: 20, height: 10 }
    } as unknown as ExcelJS.ImagePosition)
    // twoCellAnchor: tl + br
    ws.addImage(imgId, { tl: { col: 3, row: 3 }, br: { col: 5, row: 5 } } as unknown as ExcelJS.ImageRange)

    const buffer = await toArrayBuffer(wb)
    model = await parseWorkbook(buffer, 'images.xlsx')
  })

  it('registers image binary data under model.images', () => {
    expect(Object.keys(model.images).length).toBeGreaterThan(0)
    const first = Object.values(model.images)[0]
    expect(first.mime).toBe('image/png')
    expect(first.data.byteLength).toBeGreaterThan(0)
  })

  it('oneCellAnchor (tl+ext): PxRect uses the px extent ExcelJS already converted', () => {
    const sheet = model.sheets[0]
    const oneCell = sheet.floatingImages.find((f) => f.rect.width === 20)
    expect(oneCell).toBeDefined()
    expect(oneCell!.rect.height).toBeCloseTo(10)
  })

  it('twoCellAnchor (tl+br): PxRect derived from column/row cumulative offsets', () => {
    const sheet = model.sheets[0]
    const twoCell = sheet.floatingImages.find((f) => f.rect.width !== 20)
    expect(twoCell).toBeDefined()
    expect(twoCell!.rect.width).toBeGreaterThan(0)
    expect(twoCell!.rect.height).toBeGreaterThan(0)
  })

  it('expands the used range to cover the full floating image bounds', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('S1')
    const imgId = wb.addImage({ base64: PNG_BASE64, extension: 'png' })
    ws.addImage(imgId, { tl: { col: 0, row: 0 }, br: { col: 20, row: 40 } } as unknown as ExcelJS.ImageRange)

    const parsed = await parseWorkbook(await toArrayBuffer(wb), 'image-range.xlsx')
    const sheet = parsed.sheets[0]

    expect(sheet.floatingImages[0].rect).toEqual({ x: 0, y: 0, width: 1280, height: 800 })
    expect(sheet.rowCount).toBeGreaterThanOrEqual(40)
    expect(sheet.colCount).toBeGreaterThanOrEqual(20)
  })
})

describe('parseWorkbook — corrupted input', () => {
  it('rejects with a readable error message', async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    await expect(parseWorkbook(garbage.buffer, 'corrupt.xlsx')).rejects.toThrow(/./)
  })
})

describe('parseWorkbook — ZIP preflight rejects decompression bombs', () => {
  it('rejects an entry whose declared uncompressed size exceeds the limit', async () => {
    const bytes = createZipBytes([
      { name: 'xl/worksheets/sheet1.xml', uncompressedSize: OFFICE_ZIP_LIMITS.maxEntryUncompressedBytes + 1 }
    ])

    await expect(parseWorkbook(bytes.buffer, 'bomb-entry.xlsx')).rejects.toThrow(/XLSX preview supports ZIP entries/)
  })

  it('rejects an archive whose declared total uncompressed size exceeds the limit', async () => {
    const bytes = createZipBytes(
      Array.from({ length: 9 }, (_, index) => ({
        name: `xl/media/image-${index}.bin`,
        uncompressedSize: OFFICE_ZIP_LIMITS.maxEntryUncompressedBytes
      }))
    )

    await expect(parseWorkbook(bytes.buffer, 'bomb-total.xlsx')).rejects.toThrow(/total uncompressed bytes/)
  })

  it('rejects an archive declaring too many entries', async () => {
    const bytes = createZipBytes(
      Array.from({ length: OFFICE_ZIP_LIMITS.maxEntries + 1 }, (_, index) => ({ name: `xl/f-${index}.xml` }))
    )

    await expect(parseWorkbook(bytes.buffer, 'bomb-entries.xlsx')).rejects.toThrow(/up to 4000 entries/)
  })
})

describe('parseWorkbook — openpyxl default-namespace chart drawings must not crash ExcelJS', () => {
  // openpyxl-style drawings use <wsDr xmlns=...> without an xdr: prefix; without
  // normalization ExcelJS crashes during reconcile.
  it.each([
    ['basic', 'charts-basic-runtime.xlsx'],
    ['no-cache', 'charts-no-cache-runtime.xlsx']
  ] as const)('parses generated %s chart package through the full pipeline', async (kind, name) => {
    const buffer = await buildChartWorkbookArrayBuffer(kind)
    const model = await parseWorkbook(buffer, name)

    expect(model.sheets.length).toBeGreaterThan(0)
    expect(model.sheets[0].rowCount).toBeGreaterThan(5)
    expect(model.sheets[0].colCount).toBeGreaterThan(3)
    const charts = model.sheets.flatMap((sheet) => sheet.charts)
    expect(charts.length).toBeGreaterThan(0)
    for (const chart of charts) {
      if (chart.type === 'unsupported') continue
      expect(chart.series.length).toBeGreaterThan(0)
      expect(chart.series[0].values.length).toBeGreaterThan(0)
    }
  })
})
