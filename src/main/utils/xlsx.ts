import { posix } from 'node:path'

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
  const stored = await storedWorkbook(data)

  const sheets: string[] = []
  workbook.eachSheet((worksheet) => {
    const lines = [`Sheet: ${worksheet.name}`]
    const sheetCells = stored.cells.get(worksheet.name)
    worksheet.eachRow((row) => {
      const cells: string[] = []
      row.eachCell({ includeEmpty: true }, (cell, column) => {
        // ExcelJS drops the backslashes of a format's escaped characters; classify the stored one
        const numFmt = stored.numFmts.get(cell.numFmt) ?? cell.numFmt
        const text = cellText(cell, numFmt, date1904, sheetCells?.get(cell.address))
        cells[column - 1] = text.replace(/[\t\r\n]+/g, ' ')
      })
      const line = cells.join('\t').replace(/\t+$/, '')
      if (line.trim()) lines.push(line)
    })
    sheets.push(lines.join('\n'))
  })
  return sheets.join('\n\n')
}

function cellText(cell: Cell, numFmt: string, date1904: boolean, stored?: StoredCell): string {
  let value: CellValue = cell.value
  // A formula reads as its cached result, from cell.result since ExcelJS leaves a cached 0 or false
  // out of cell.value; one saved without a result shows its formula.
  if (value !== null && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) {
    const result: CellValue = cell.result
    if (result === undefined || result === null) return `=${cell.formula}`
    value = result
  }
  if (value === null || value === undefined) return ''
  const isHyperlink = typeof value === 'object' && 'hyperlink' in value
  // An ISO date, or a result ExcelJS took for a date, reads from what the sheet stores
  if (stored && !isHyperlink && (stored.type === 'd' || value instanceof Date)) {
    return storedText(stored, numFmt, date1904)
  }
  if (value instanceof Date) return formatDate(value, numFmt, date1904)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'object') {
    if ('error' in value) return value.error
    if ('hyperlink' in value) {
      const text = stored ? storedText(stored, numFmt, date1904) : plainText(value.text)
      return text && text !== value.hyperlink ? `${text} (${value.hyperlink})` : value.hyperlink
    }
    return plainText(value)
  }
  return String(value)
}

/** A cell as the sheet XML stores it: its `t` attribute and the text of its `<v>`. */
interface StoredCell {
  type: string
  text: string
}

/**
 * What ExcelJS 4.4.0 changes while loading a workbook, read from its XML instead.
 *
 * `cells`, per worksheet name and address: ExcelJS reads the ISO 8601 text of a `t="d"` cell
 * (openpyxl's `iso_dates=True`) with parseFloat, so 2024-09-30 becomes the serial number 2024,
 * 1905-07-16, and 09:30:00 becomes 9. In a date-formatted cell it also converts a formula's cached
 * text, boolean or error result as if it were a serial number: `pending` or `#N/A` becomes an
 * invalid date.
 *
 * `numFmts`, by the form ExcelJS gives them: ExcelJS drops the backslash of each escaped character
 * in a number format, so `h:mm\ \d\a\i\l\y` reaches it as `h:mm daily`, where `d` and `y` read as
 * date tokens. A loaded form that two stored formats share is left out.
 */
async function storedWorkbook(
  data: Uint8Array
): Promise<{ cells: Map<string, Map<string, StoredCell>>; numFmts: Map<string, string> }> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(data)
  const cells = new Map<string, Map<string, StoredCell>>()
  const numFmts = new Map<string, string>()

  const stylesXml = await zip.file('xl/styles.xml')?.async('string')
  const formatsByLoaded = new Map<string, Set<string>>()
  for (const [tag] of stylesXml?.matchAll(/<numFmt\b[^>]*>/g) ?? []) {
    const code = xmlAttribute(tag, 'formatCode')
    if (code === undefined) continue
    const loaded = code.replace(/[\\](.)/g, '$1')
    formatsByLoaded.set(loaded, (formatsByLoaded.get(loaded) ?? new Set()).add(code))
  }
  for (const [loaded, codes] of formatsByLoaded) {
    const [code] = codes
    if (codes.size === 1 && code !== loaded) numFmts.set(loaded, code)
  }

  const workbookXml = await zip.file('xl/workbook.xml')?.async('string')
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('string')
  if (!workbookXml || !relsXml) return { cells, numFmts }
  const targets = new Map<string, string>()
  for (const [tag] of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = xmlAttribute(tag, 'Id')
    const target = xmlAttribute(tag, 'Target')
    if (id && target) targets.set(id, target.startsWith('/') ? target.slice(1) : posix.join('xl', target))
  }
  for (const [tag] of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = xmlAttribute(tag, 'name')
    const path = targets.get(xmlAttribute(tag, 'r:id') ?? '')
    const xml = path ? await zip.file(path)?.async('string') : undefined
    if (name === undefined || !xml) continue
    // Most sheets hold neither, so their cells are not walked
    const hasFormulaResult = /<f[\s/>]/.test(xml) && /\st=["'](?:str|b|e)["']/.test(xml)
    if (!hasFormulaResult && !/\st=["']d["']/.test(xml)) continue
    const sheetCells = new Map<string, StoredCell>()
    for (const [, attributes, content = ''] of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const type = xmlAttribute(attributes, 't') ?? ''
      // Only a formula's result is converted: a plain text, boolean or error cell reads correctly
      if (type !== 'd' && !(['str', 'b', 'e'].includes(type) && /<f[\s/>]/.test(content))) continue
      const address = xmlAttribute(attributes, 'r')
      const value = /<v>([\s\S]*?)<\/v>/.exec(content)
      if (address && value) sheetCells.set(address, { type, text: xmlText(value[1]) })
    }
    if (sheetCells.size) cells.set(name, sheetCells)
  }
  return { cells, numFmts }
}

/** The decoded value of attribute `name` in a start tag, `undefined` if it has none. */
function xmlAttribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag)
  return match ? xmlText(match[1] ?? match[2]) : undefined
}

/** XML text with its character and entity references resolved. */
function xmlText(text: string): string {
  const named: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }
  return text.replace(/&(?:#x([\da-fA-F]+)|#(\d+)|(lt|gt|amp|quot|apos));/g, (_reference, hex, decimal, name) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : decimal ? String.fromCodePoint(Number(decimal)) : named[name]
  )
}

/**
 * A cell ExcelJS misreads, from the value the sheet stores: a formula's text or error result as
 * itself, a boolean result as `TRUE` / `FALSE`, and an ISO date or time by the cell's number
 * format. An ISO value in a cell that is not formatted as a date or time keeps its ISO text.
 */
function storedText(stored: StoredCell, numFmt: string | undefined, date1904: boolean): string {
  if (stored.type === 'b') return /^(1|true)$/i.test(stored.text) ? 'TRUE' : 'FALSE'
  if (stored.type !== 'd') return stored.text
  // A General cell has no number format
  if (!numFmt) return stored.text
  const date = isoDate(stored.text, date1904)
  const { date: showsDate, time: showsTime } = dateFormatParts(numFmt)
  const formatted = showsDate || showsTime || /\[(h+|m+|s+)\]/i.test(numFmt)
  return date && formatted ? formatDate(date, numFmt, date1904) : stored.text
}

// The ISO 8601 date, date-time or time of a `t="d"` cell as the Date ExcelJS would have made:
// UTC, with a time alone on day 0 of the date system. An offset is dropped, as Excel keeps none.
function isoDate(text: string, date1904: boolean): Date | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})?(?:T?(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?))?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(
    text.trim()
  )
  if (!match || (!match[1] && !match[2])) return undefined
  const day = match[1] ?? (date1904 ? '1904-01-01' : '1899-12-30')
  const date = new Date(`${day}T${match[2] ?? '00:00:00'}Z`)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/** A string, or the runs of a rich-text value joined. */
function plainText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && 'richText' in value && Array.isArray(value.richText)) {
    return value.richText.map((run: { text?: unknown }) => String(run.text ?? '')).join('')
  }
  return ''
}

// Which calendar and clock parts a number format shows. Quoted text, escaped, padding and fill
// characters and [...] sections are not tokens. `y` and `d` show the date, `h`, `s` and AM/PM the
// time. `m` and `mm` are minutes right after an hour or right before a second and a month
// otherwise, as in Excel; `mmm` and longer always name the month.
function dateFormatParts(numFmt: string): { date: boolean; time: boolean } {
  const code = numFmt.toLowerCase()
  const tokens: string[] = []
  for (let i = 0; i < code.length; i++) {
    const c = code[i]
    if (c === '"' || c === '[') {
      const end = code.indexOf(c === '"' ? '"' : ']', i + 1)
      if (end < 0) break
      i = end
    } else if (c === '\\' || c === '_' || c === '*') {
      i++
    } else if (code.startsWith('am/pm', i) || code.startsWith('a/p', i)) {
      tokens.push('ampm')
      i += code.startsWith('am/pm', i) ? 4 : 2
    } else if ('ymdhs'.includes(c)) {
      let end = i
      while (code[end + 1] === c) end++
      tokens.push(code.slice(i, end + 1))
      i = end
    }
  }
  let date = false
  let time = false
  tokens.forEach((token, index) => {
    if (token[0] === 'y' || token[0] === 'd') date = true
    else if (token[0] === 'h' || token[0] === 's' || token === 'ampm') time = true
    else if (token.length <= 2 && (tokens[index - 1]?.[0] === 'h' || tokens[index + 1]?.[0] === 's')) time = true
    else date = true
  })
  return { date, time }
}

// A time of day or an elapsed duration reaches ExcelJS as a Date on day 0 (1899-12-30 or 1904-01-01).
function formatDate(date: Date, numFmt: string, date1904: boolean): string {
  const elapsed = /\[(h+|m+|s+)\]/i.exec(numFmt)
  if (!elapsed) {
    const parts = dateFormatParts(numFmt)
    // A date-only format shows the day as stored: rounding first would carry 23:59:59.9 into the
    // next day, and the time of day is hidden
    if (parts.date && !parts.time) return date.toISOString().slice(0, 10)
    // Rounded to the second, as Excel shows it: a NOW() stamp of 14:04:59.9 reads 14:05:00
    const iso = new Date(Math.round(date.getTime() / 1000) * 1000).toISOString()
    return parts.date ? iso.slice(0, 19).replace('T', ' ') : iso.slice(11, 19)
  }
  const time = Math.round(date.getTime() / 1000) * 1000
  const seconds = (time - (date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30))) / 1000
  const pad = (n: number) => String(n).padStart(2, '0')
  // Elapsed minutes count in minutes: [mm]:ss of 25 hours reads 1500:00
  if (/^m/i.test(elapsed[1])) return `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`
  return `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`
}
