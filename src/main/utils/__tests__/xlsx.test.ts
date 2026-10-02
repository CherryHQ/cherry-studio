import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'

import { extractXlsxText } from '../xlsx'

async function xlsxBytes(build: (workbook: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  build(workbook)
  return new Uint8Array(await workbook.xlsx.writeBuffer())
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
      ['1899-12-31T12:00:00.000Z', '[h]:mm:ss', '36:00:00'],
      ['1899-12-31T01:00:00.000Z', '[mm]:ss', '25:00:00']
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

  it('counts a duration from 1904-01-01 in a workbook on the 1904 date system', async () => {
    const data = await xlsxBytes((workbook) => {
      workbook.properties.date1904 = true
      const cell = workbook.addWorksheet('Hours').getCell('A1')
      cell.value = new Date('1904-01-02T12:00:00.000Z')
      cell.numFmt = '[h]:mm'
    })

    expect(await extractXlsxText(data)).toBe('Sheet: Hours\n36:00:00')
  })
})
