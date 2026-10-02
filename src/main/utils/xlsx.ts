import type { Cell, CellValue } from 'exceljs'

/**
 * Extract the text of an .xlsx workbook: a `Sheet: <name>` line per worksheet, then one line per
 * row with a tab between cells, so each value keeps its row and column.
 *
 * Cells read as the sheet shows them rather than as stored: a formula as its cached result (also
 * each cell of a formula filled down or across, which ExcelJS reads as `{ sharedFormula, result }`),
 * an error as its code, a boolean as `TRUE` / `FALSE`, and a date or time by its number format.
 * A line break or tab inside a cell becomes a space so it cannot split the row or add a column.
 *
 * @param data - The workbook's bytes
 * @returns The workbook as text, sheets separated by a blank line
 */
export async function extractXlsxText(data: Uint8Array): Promise<string> {
  // Delayed loading: exceljs stays out of the boot path.
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(new Uint8Array(data).buffer)
  const date1904 = Boolean(workbook.properties.date1904)

  const sheets: string[] = []
  workbook.eachSheet((worksheet) => {
    const lines = [`Sheet: ${worksheet.name}`]
    worksheet.eachRow((row) => {
      const cells: string[] = []
      row.eachCell({ includeEmpty: true }, (cell, column) => {
        cells[column - 1] = cellText(cell, date1904).replace(/[\t\r\n]+/g, ' ')
      })
      const line = cells.join('\t').replace(/\t+$/, '')
      if (line.trim()) lines.push(line)
    })
    sheets.push(lines.join('\n'))
  })
  return sheets.join('\n\n')
}

function cellText(cell: Cell, date1904: boolean): string {
  let value: CellValue = cell.value
  // A formula reads as its cached result; one saved without a result shows its formula.
  if (value !== null && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) {
    if (value.result === undefined || value.result === null) return `=${cell.formula}`
    value = value.result
  }
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return formatDate(value, cell.numFmt, date1904)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'object') {
    if ('error' in value) return value.error
    if ('hyperlink' in value) {
      const text = plainText(value.text)
      return text && text !== value.hyperlink ? `${text} (${value.hyperlink})` : value.hyperlink
    }
    return plainText(value)
  }
  return String(value)
}

/** A string, or the runs of a rich-text value joined. */
function plainText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && 'richText' in value && Array.isArray(value.richText)) {
    return value.richText.map((run: { text?: unknown }) => String(run.text ?? '')).join('')
  }
  return ''
}

// A time of day or an elapsed duration reaches ExcelJS as a Date on day 0 (1899-12-30 or
// 1904-01-01): only a format with a day or a year outside quotes and [...] shows a date.
function formatDate(date: Date, numFmt: string, date1904: boolean): string {
  // Rounded to the second, as Excel shows it: a NOW() stamp of 14:04:59.9 reads 14:05:00
  const time = Math.round(date.getTime() / 1000) * 1000
  const iso = new Date(time).toISOString()
  if (/[dy]/i.test(numFmt.replace(/"[^"]*"|\[[^\]]*\]/g, ''))) {
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ')
  }
  if (!/\[(?:h+|m+|s+)\]/i.test(numFmt)) return iso.slice(11, 19)
  const seconds = (time - (date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30))) / 1000
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`
}
