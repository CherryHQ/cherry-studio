import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { extractXlsxText } from '../xlsx'

async function xlsxBytes(build: (workbook: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  build(workbook)
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}

/** Rewrite one worksheet's XML, for cell encodings ExcelJS does not write. */
async function editSheetXml(data: Uint8Array, path: string, edit: (xml: string) => string): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(data)
  const xml = await zip.file(path)?.async('string')
  if (xml === undefined) throw new Error(`no ${path}`)
  zip.file(path, edit(xml))
  return zip.generateAsync({ type: 'uint8array' })
}

describe('extractXlsxText', () => {
  it('keeps each value in its row and column, one block per sheet', async () => {
    const data = await xlsxBytes((workbook) => {
      const orders = workbook.addWorksheet('Orders')
      orders.addRow(['item', 'qty', 'note'])
      orders.addRow(['pen', 2, 'blue\nor black'])
      orders.addRow(['ink', null, 'a\ttab'])
      // Formatted but empty, as sheets often are past their data
      orders.getCell('D2').numFmt = '0.00'
      const notes = workbook.addWorksheet('Notes')
      notes.addRow([''])
      notes.addRow(['done'])
    })

    expect(await extractXlsxText(data)).toBe(
      'Sheet: Orders\nitem\tqty\tnote\npen\t2\tblue or black\nink\t\ta tab\n\nSheet: Notes\ndone'
    )
  })

  it('reads formulas as their results, including every cell of a filled-down formula', async () => {
    const data = await xlsxBytes((workbook) => {
      const sheet = workbook.addWorksheet('Totals')
      sheet.getCell('A1').value = 1
      sheet.getCell('A2').value = 2
      sheet.getCell('B1').value = { formula: 'A1*2', result: 2 }
      sheet.getCell('B2').value = { sharedFormula: 'B1', result: 4 }
      sheet.getCell('C1').value = { formula: '1/0', result: { error: '#DIV/0!' } }
      sheet.getCell('C2').value = { formula: 'SUM(A1:A2)' }
    })

    expect(await extractXlsxText(data)).toBe('Sheet: Totals\n1\t2\t#DIV/0!\n2\t4\t=SUM(A1:A2)')
  })

  it('reads a cached 0 or false formula result, not the formula', async () => {
    const data = await xlsxBytes((workbook) => {
      const sheet = workbook.addWorksheet('Zeros')
      sheet.getCell('A1').value = { formula: 'B1*2', result: 0 }
      sheet.getCell('A2').value = { sharedFormula: 'A1', result: 0 }
      sheet.getCell('A3').value = { formula: 'B1>1', result: false }
    })

    expect(await extractXlsxText(data)).toBe('Sheet: Zeros\n0\n0\nFALSE')
  })

  it('reads booleans and hyperlinks as the sheet shows them', async () => {
    const data = await xlsxBytes((workbook) => {
      const sheet = workbook.addWorksheet('Links')
      sheet.addRow([true, false, { text: 'docs', hyperlink: 'https://example.com/docs' }])
    })

    expect(await extractXlsxText(data)).toBe('Sheet: Links\nTRUE\tFALSE\tdocs (https://example.com/docs)')
  })

  it('reads dates, times and durations by their number format', async () => {
    const cells: [string, string, string][] = [
      ['2024-09-30T00:00:00.000Z', 'yyyy-mm-dd', '2024-09-30'],
      ['2024-09-30T14:04:59.900Z', 'm/d/yy h:mm', '2024-09-30 14:05:00'],
      ['2024-09-30T09:30:00.000Z', 'DD.MM.YYYY HH:MM', '2024-09-30 09:30:00'],
      ['2024-05-01T00:00:00.000Z', 'mmm yyyy', '2024-05-01'],
      ['2024-09-30T00:00:00.000Z', 'd-mmm', '2024-09-30'],
      ['1899-12-30T06:00:00.000Z', 'h:mm', '06:00:00'],
      ['1899-12-30T12:00:00.000Z', '[$-x-systime]h:mm:ss AM/PM', '12:00:00'],
      ['1899-12-30T18:00:00.000Z', 'h:mm" daily"', '18:00:00'],
      // ExcelJS drops these backslashes on load, which left d and y to read as date tokens
      ['1899-12-30T18:00:00.000Z', 'h:mm\\ \\d\\a\\i\\l\\y', '18:00:00'],
      ['1899-12-31T12:00:00.000Z', '[h]:mm:ss', '36:00:00'],
      ['1899-12-31T01:00:30.000Z', '[mm]:ss', '1500:30'],
      ['2024-09-30T00:00:00.000Z', 'mmmm', '2024-09-30'],
      // A date-only format keeps the stored day and hides its time, even close to midnight
      ['2024-09-30T23:59:59.900Z', 'yyyy-mm-dd', '2024-09-30'],
      ['2024-09-30T14:05:00.000Z', 'yyyy-mm-dd', '2024-09-30'],
      // A month next to a clock time is still a month
      ['2024-09-30T14:05:00.000Z', 'mmm hh:mm', '2024-09-30 14:05:00']
    ]
    const data = await xlsxBytes((workbook) => {
      const row = workbook.addWorksheet('Dates').getRow(1)
      cells.forEach(([date, numFmt], index) => {
        const cell = row.getCell(index + 1)
        cell.value = new Date(date)
        cell.numFmt = numFmt
      })
    })

    expect(await extractXlsxText(data)).toBe(`Sheet: Dates\n${cells.map(([, , text]) => text).join('\t')}`)
  })

  it('reads the ISO 8601 date or time of a t="d" cell by its number format', async () => {
    // As openpyxl writes them with iso_dates=True. ExcelJS read 2024-09-30 as the serial number
    // 2024 and 09:30:00 as 9. The second sheet also checks which sheet the stored cells belong to.
    const cells: [string, string, string][] = [
      ['2024-09-30', 'yyyy-mm-dd', '2024-09-30'],
      ['2024-09-30T14:05:00', 'yyyy-mm-dd h:mm', '2024-09-30 14:05:00'],
      ['09:30:00', 'h:mm:ss', '09:30:00'],
      ['2024-09-30T00:00:00', 'General', '2024-09-30T00:00:00']
    ]
    const workbook = await xlsxBytes((workbook) => {
      workbook.addWorksheet('Plain').getCell('A1').value = 1
      const row = workbook.addWorksheet('Dates').getRow(1)
      cells.forEach(([, numFmt], index) => {
        const cell = row.getCell(index + 1)
        cell.value = 1
        cell.numFmt = numFmt
      })
    })
    const data = await editSheetXml(workbook, 'xl/worksheets/sheet2.xml', (xml) =>
      cells.reduce(
        (edited, [iso], index) =>
          edited.replace(new RegExp(`(<c r="${'ABCD'[index]}1"[^>]*)><v>1</v>`), `$1 t="d"><v>${iso}</v>`),
        xml
      )
    )

    expect(await extractXlsxText(data)).toBe(
      `Sheet: Plain\n1\n\nSheet: Dates\n${cells.map(([, , text]) => text).join('\t')}`
    )
  })

  it('reads a text, error or boolean formula result in a date-formatted cell as itself', async () => {
    // ExcelJS converted these results as if they were serial numbers, and the invalid date a text
    // result became made the whole workbook fail to extract
    const data = await xlsxBytes((workbook) => {
      const row = workbook.addWorksheet('Due').getRow(1)
      row.getCell(1).value = { formula: 'IF(B2="","pending",B2)', result: 'pending' }
      row.getCell(2).value = { formula: 'NA()', result: { error: '#N/A' } }
      row.getCell(3).value = { formula: 'B2>0', result: true }
      row.getCell(4).value = { formula: 'DATE(2024,9,30)', result: new Date('2024-09-30T00:00:00.000Z') }
      for (const column of [1, 2, 3, 4]) row.getCell(column).numFmt = 'yyyy-mm-dd'
    })

    expect(await extractXlsxText(data)).toBe('Sheet: Due\npending\t#N/A\tTRUE\t2024-09-30')
  })

  it('counts a duration from 1904-01-01 in a workbook on the 1904 date system', async () => {
    const data = await xlsxBytes((workbook) => {
      workbook.properties.date1904 = true
      const cell = workbook.addWorksheet('Hours').getCell('A1')
      cell.value = new Date('1904-01-02T12:00:00.000Z')
      cell.numFmt = '[h]:mm'
    })

    expect(await extractXlsxText(data)).toBe('Sheet: Hours\n36:00:00')
  })

  it('reads a merged range once, in its first cell', async () => {
    // ExcelJS gives each cell of the range the first cell's value; a formula follower has no
    // result and read as =undefined
    const data = await xlsxBytes((workbook) => {
      const sheet = workbook.addWorksheet('Merged')
      sheet.getCell('A1').value = { formula: '40+2', result: 42 }
      sheet.mergeCells('A1:B1')
      sheet.getCell('C1').value = 'x'
      sheet.getCell('A2').value = 'Title'
      sheet.mergeCells('A2:B2')
      sheet.getCell('C2').value = 'y'
    })

    expect(await extractXlsxText(data)).toBe('Sheet: Merged\n42\t\tx\nTitle\t\ty')
  })

  it('keeps a link label that is a number, date or boolean', async () => {
    // ExcelJS writes a link label as text, so the cells are rewritten to the types Excel stores
    const written = await xlsxBytes((workbook) => {
      const row = workbook.addWorksheet('Links').getRow(1)
      row.getCell(1).value = { text: 'n', hyperlink: 'https://a.example/' }
      row.getCell(2).value = { text: 'd', hyperlink: 'https://b.example/' }
      row.getCell(2).numFmt = 'yyyy-mm-dd'
      row.getCell(3).value = { text: 'b', hyperlink: 'https://c.example/' }
    })
    const data = await editSheetXml(written, 'xl/worksheets/sheet1.xml', (xml) =>
      xml
        .replace(/<c r="A1"([^>]*?) t="s"><v>\d+<\/v><\/c>/, '<c r="A1"$1><v>123</v></c>')
        .replace(/<c r="B1"([^>]*?) t="s"><v>\d+<\/v><\/c>/, '<c r="B1"$1><v>45565</v></c>')
        .replace(/<c r="C1"([^>]*?) t="s"><v>\d+<\/v><\/c>/, '<c r="C1"$1 t="b"><v>1</v></c>')
    )

    expect(await extractXlsxText(data)).toBe(
      'Sheet: Links\n123 (https://a.example/)\t2024-09-30 (https://b.example/)\tTRUE (https://c.example/)'
    )
  })

  it('reads a number through the format section for its sign or condition', async () => {
    // ExcelJS makes a date of any number whose format holds a date token in any section
    const data = await xlsxBytes((workbook) => {
      const row = workbook.addWorksheet('Sections').getRow(1)
      const cells: [number, string][] = [
        [42, '0;yyyy-mm-dd'],
        [45000, '[>=1000]0;yyyy-mm-dd'],
        [42, '[>=1000]0;yyyy-mm-dd']
      ]
      cells.forEach(([value, numFmt], index) => {
        row.getCell(index + 1).value = value
        row.getCell(index + 1).numFmt = numFmt
      })
    })

    expect(await extractXlsxText(data)).toBe('Sheet: Sections\n42\t45000\t1900-02-10')
  })

  it('reads a number too large for a date as stored', async () => {
    // ExcelJS turned these into invalid dates, which read NaN or made the workbook fail to extract
    const data = await xlsxBytes((workbook) => {
      const row = workbook.addWorksheet('Large').getRow(1)
      const cells: [number, string][] = [
        [123456789, '0;yyyy-mm-dd'],
        [123456789, '[>=1000]0;yyyy-mm-dd'],
        [-123456789, '0;0;yyyy-mm-dd'],
        [1e20, 'yyyy-mm-dd']
      ]
      cells.forEach(([value, numFmt], index) => {
        row.getCell(index + 1).value = value
        row.getCell(index + 1).numFmt = numFmt
      })
      row.getCell(5).value = { formula: 'A1*10', result: 1234567890 }
      row.getCell(5).numFmt = 'yyyy-mm-dd'
    })

    expect(await extractXlsxText(data)).toBe(
      'Sheet: Large\n123456789\t123456789\t-123456789\t100000000000000000000\t1234567890'
    )
  })

  it('reads a cached empty formula result as an empty cell', async () => {
    const built = await xlsxBytes((workbook) => {
      const row = workbook.addWorksheet('Blank').getRow(1)
      row.getCell(1).value = { formula: 'IF(TRUE,"","x")', result: 'x' }
      row.getCell(2).value = 'after'
    })
    const data = await editSheetXml(built, 'xl/worksheets/sheet1.xml', (xml) => xml.replace('<v>x</v>', '<v></v>'))

    expect(await extractXlsxText(data)).toBe('Sheet: Blank\n\tafter')
  })

  it('reads a bracketed label in quotes as text, not as elapsed time', async () => {
    const data = await xlsxBytes((workbook) => {
      const cell = workbook.addWorksheet('Label').getCell('A1')
      cell.value = new Date('2024-09-30T06:00:00.000Z')
      cell.numFmt = 'h:mm" [h]"'
    })

    expect(await extractXlsxText(data)).toBe('Sheet: Label\n06:00:00')
  })

  it('shows the sign of a negative duration once', async () => {
    const data = await xlsxBytes((workbook) => {
      workbook.properties.date1904 = true
      const row = workbook.addWorksheet('Negative').getRow(1)
      const value = new Date(Date.UTC(1904, 0, 1) - 0.51 * 86_400_000)
      row.getCell(1).value = value
      row.getCell(1).numFmt = '[h]:mm'
      row.getCell(2).value = value
      row.getCell(2).numFmt = '[mm]:ss'
    })

    expect(await extractXlsxText(data)).toBe('Sheet: Negative\n-12:14:24\t-734:24')
  })
})
