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
        // ExcelJS gives every cell of a merged range the master's value (a formula follower has no
        // result); the sheet shows it once, in the master
        if (cell.isMerged && cell.master.address !== cell.address) {
          cells[column - 1] = ''
          return
        }
        // ExcelJS drops the backslashes of a format's escaped characters; read the cell's stored one
        const storedCell = sheetCells?.get(cell.address)
        const numFmt = storedCell?.numFmt ?? cell.numFmt
        const text = cellText(cell, numFmt, date1904, storedCell)
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
    // ExcelJS also leaves out a cached empty text result, which the sheet stores as <v></v> or <v/>
    if (result === undefined || result === null)
      return stored ? storedText(stored, numFmt, date1904) : `=${cell.formula}`
    value = result
  }
  if (value === null || value === undefined) return ''
  const isHyperlink = typeof value === 'object' && 'hyperlink' in value
  // An ISO date, or a result ExcelJS took for a date, reads from what the sheet stores
  if (stored && !isHyperlink && (stored.type === 'd' || value instanceof Date)) {
    return storedText(stored, numFmt, date1904)
  }
  if (typeof value === 'object' && !(value instanceof Date)) {
    if ('error' in value) return value.error
    if ('hyperlink' in value) {
      // A link's label keeps its own type: a number, date or boolean as the cell shows it
      const text = stored ? storedText(stored, numFmt, date1904) : scalarText(value.text, numFmt, date1904)
      return text && text !== value.hyperlink ? `${text} (${value.hyperlink})` : value.hyperlink
    }
    return plainText(value)
  }
  return scalarText(value, numFmt, date1904)
}

/** A value that is not a formula, error or link: a date or time by its number format. */
function scalarText(value: unknown, numFmt: string, date1904: boolean): string {
  if (value instanceof Date) {
    // ExcelJS makes a date of any number whose format holds a date token in any section, but a
    // number shows through the section for its sign or condition: 42 in `0;yyyy-mm-dd` reads 42
    return Number.isNaN(value.getTime()) ? '' : serialText(serialNumber(value, date1904), numFmt, date1904)
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'number') return String(value)
  return plainText(value)
}

// The serial number ExcelJS turned into `date`: days since 1899-12-30, or 1904-01-01 in the 1904
// date system, without the float noise of the round trip.
function serialNumber(date: Date, date1904: boolean): number {
  const days = (date.getTime() - (date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30))) / 86_400_000
  return Math.round(days * 1e9) / 1e9
}

// The section of a number format that shows `value`. Sections are split at `;` outside quotes,
// brackets and escapes. With conditions such as `[>=1000]`, the first section whose condition
// holds wins, and a section without one takes the rest; otherwise the first is for positive
// numbers, the second for negative and the third for zero. A fourth section is for text.
function activeSection(numFmt: string, value: number): string {
  const sections: string[] = []
  let start = 0
  for (let i = 0; i < numFmt.length; i++) {
    const c = numFmt[i]
    if (c === '"' || c === '[') {
      const end = numFmt.indexOf(c === '"' ? '"' : ']', i + 1)
      if (end < 0) break
      i = end
    } else if (c === '\\') {
      i++
    } else if (c === ';') {
      sections.push(numFmt.slice(start, i))
      start = i + 1
    }
  }
  sections.push(numFmt.slice(start))
  const numeric = sections.slice(0, 3)
  const conditions = numeric.map((section) => /\[(<>|<=|>=|<|>|=)\s*(-?\d+(?:\.\d+)?)\]/.exec(section))
  if (conditions.some(Boolean)) {
    const holds = ([, op, limit]: RegExpExecArray): boolean => {
      const n = Number(limit)
      const results: Record<string, boolean> = {
        '<>': value !== n,
        '<=': value <= n,
        '>=': value >= n,
        '<': value < n,
        '>': value > n,
        '=': value === n
      }
      return results[op]
    }
    const index = conditions.findIndex((condition) => !condition || holds(condition))
    return numeric[index < 0 ? numeric.length - 1 : index]
  }
  if (value > 0 || numeric.length === 1) return numeric[0]
  if (value < 0) return numeric[1]
  return numeric[2] ?? numeric[0]
}

// Date holds 100 million days either side of 1970, which is serial 99,974,431 at the near end
const MAX_DATE_SERIAL = 99_974_000

// Excel's built-in date and time formats (numFmtId), which ExcelJS also reads as dates
const BUILTIN_DATE_FORMAT_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56,
  57, 58
])

/**
 * A cell as the sheet XML stores it: its `t` attribute, the text of its `<v>`, and for a custom
 * number format its code as written, escapes included.
 */
interface StoredCell {
  type: string
  text: string
  numFmt?: string
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
 * A number in a cell whose format has a date token in any section reaches ExcelJS as a Date: one
 * beyond Date's range becomes an invalid date, and the millisecond round trip changes digits a
 * numeric section shows (42.123456789 reads back as 42.123456794). Such a cell keeps its stored
 * number, read by its section, and its stored format: ExcelJS also drops the backslash of each
 * escaped character, so `h:mm\ \d\a\i\l\y` reaches it as `h:mm daily`, where `d` and `y` read as
 * date tokens.
 */
async function storedWorkbook(data: Uint8Array): Promise<{ cells: Map<string, Map<string, StoredCell>> }> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(data)
  const cells = new Map<string, Map<string, StoredCell>>()

  // The format of each cell style, by its index in <cellXfs>: the stored code of a custom format,
  // and whether the format shows a date or time in any section
  const stylesXml = (await zip.file('xl/styles.xml')?.async('string')) ?? ''
  const codesById = new Map<number, string>()
  for (const [tag] of stylesXml.matchAll(/<numFmt\b[^>]*>/g)) {
    const id = Number(xmlAttribute(tag, 'numFmtId'))
    const code = xmlAttribute(tag, 'formatCode')
    if (Number.isInteger(id) && code !== undefined) codesById.set(id, code)
  }
  const styleCodes: (string | undefined)[] = []
  const dateStyles = new Set<number>()
  // Date styles whose numbers need the stored value: a numeric section or condition shows the
  // number's own digits, and an escape is lost on load
  const storedStyles = new Set<number>()
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? ''
  for (const [tag] of cellXfs.matchAll(/<xf\b[^>]*>/g)) {
    const id = Number(xmlAttribute(tag, 'numFmtId') ?? 0)
    const code = codesById.get(id)
    const parts = code === undefined ? undefined : dateFormatParts(code)
    const showsDate = parts
      ? parts.date || parts.time || elapsedToken(code ?? '') !== undefined
      : BUILTIN_DATE_FORMAT_IDS.has(id)
    if (showsDate) dateStyles.add(styleCodes.length)
    if (showsDate && code !== undefined && /[;\\[]/.test(code)) storedStyles.add(styleCodes.length)
    styleCodes.push(code)
  }

  const workbookXml = await zip.file('xl/workbook.xml')?.async('string')
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('string')
  if (!workbookXml || !relsXml) return { cells }
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
    // Most sheets hold none of these, so their cells are not walked
    const hasFormulaResult = /<f[\s/>]/.test(xml) && /\st=["'](?:str|b|e)["']/.test(xml)
    // A number outside Date's range has an integer part of at least 99,974,431: eight digits or an exponent
    const mayExceedDate = dateStyles.size > 0 && /<v>\s*-?(?:\d{8}|[\d.]+[eE]\+?\d)/.test(xml)
    if (!hasFormulaResult && !mayExceedDate && !usesStyle(xml, storedStyles) && !/\st=["']d["']/.test(xml)) continue
    const sheetCells = new Map<string, StoredCell>()
    for (const [, attributes, content = ''] of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const type = xmlAttribute(attributes, 't') ?? ''
      const style = Number(xmlAttribute(attributes, 's') ?? 0)
      // A cached empty value can be written <v></v>, <v/> or <v />
      const value = /<v(?:\s*\/>|>([\s\S]*?)<\/v>)/.exec(content)
      // Only a formula's result is converted: a plain text, boolean or error cell reads correctly
      const isFormulaResult = ['str', 'b', 'e'].includes(type) && /<f[\s/>]/.test(content)
      const isDateStyledNumber =
        (type === '' || type === 'n') &&
        dateStyles.has(style) &&
        (storedStyles.has(style) || Math.abs(Number(value?.[1])) >= MAX_DATE_SERIAL)
      if (type !== 'd' && !isFormulaResult && !isDateStyledNumber) continue
      const address = xmlAttribute(attributes, 'r')
      if (address && value) sheetCells.set(address, { type, text: xmlText(value[1] ?? ''), numFmt: styleCodes[style] })
    }
    if (sheetCells.size) cells.set(name, sheetCells)
  }
  return { cells }
}

/** Whether a cell of the sheet XML has one of the style indexes in `styles`. */
function usesStyle(xml: string, styles: Set<number>): boolean {
  if (!styles.size) return false
  for (const [, style] of xml.matchAll(/<c\b[^>]*?\ss=["'](\d+)["']/g)) {
    if (styles.has(Number(style))) return true
  }
  return false
}

const attributePatterns = new Map<string, RegExp>()

/** The decoded value of attribute `name` in a start tag, `undefined` if it has none. */
function xmlAttribute(tag: string, name: string): string | undefined {
  let pattern = attributePatterns.get(name)
  if (!pattern) {
    pattern = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`)
    attributePatterns.set(name, pattern)
  }
  const match = pattern.exec(tag)
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
  if (stored.type === '' || stored.type === 'n') {
    const serial = Number(stored.text)
    return stored.text.trim() && Number.isFinite(serial) ? serialText(serial, numFmt ?? '', date1904) : stored.text
  }
  if (stored.type !== 'd') return stored.text
  // A General cell has no number format
  if (!numFmt) return stored.text
  const date = isoDate(stored.text, date1904)
  const { date: showsDate, time: showsTime } = dateFormatParts(numFmt)
  const formatted = showsDate || showsTime || elapsedToken(numFmt)
  return date && formatted ? formatDate(date, numFmt, date1904) : stored.text
}

/**
 * A stored number by the section of its format that shows it: a date or time from the exact serial,
 * otherwise the number. In the 1900 date system Excel counts a 29 February 1900 that never was, so
 * serials 1 to 59 fall a day later than days since 1899-12-30, and serial 60 is that day.
 */
function serialText(serial: number, numFmt: string, date1904: boolean): string {
  const section = activeSection(numFmt, serial)
  const { date, time, elapsed } = sectionParts(section)
  if (!date && !time && !elapsed) return String(serial)
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)
  const leapBug = !date1904 && date && !elapsed && serial >= 1 && serial < 61
  const days = leapBug && serial < 60 ? serial + 1 : serial
  const value = new Date(epoch + days * 86_400_000)
  if (Number.isNaN(value.getTime())) return String(serial)
  const text = formatDate(value, section, date1904)
  return leapBug && serial >= 60 ? text.replace('1900-02-28', '1900-02-29') : text
}

const sectionPartsCache = new Map<string, { date: boolean; time: boolean; elapsed: boolean }>()

// What a format section shows, cached: a sheet has a few formats and many cells
function sectionParts(section: string): { date: boolean; time: boolean; elapsed: boolean } {
  let parts = sectionPartsCache.get(section)
  if (!parts) {
    parts = { ...dateFormatParts(section), elapsed: elapsedToken(section) !== undefined }
    if (sectionPartsCache.size > 1000) sectionPartsCache.clear()
    sectionPartsCache.set(section, parts)
  }
  return parts
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

// The elapsed-time token of a number format, such as `h` for `[h]:mm`; quoted text and escaped
// characters are literals, so `h:mm" [h]"` has none.
function elapsedToken(numFmt: string): string | undefined {
  for (let i = 0; i < numFmt.length; i++) {
    const c = numFmt[i]
    if (c === '"') {
      const end = numFmt.indexOf('"', i + 1)
      if (end < 0) break
      i = end
    } else if (c === '\\' || c === '_' || c === '*') {
      i++
    } else if (c === '[') {
      const end = numFmt.indexOf(']', i + 1)
      if (end < 0) break
      const token = numFmt.slice(i + 1, end)
      if (/^(h+|m+|s+)$/i.test(token)) return token
      i = end
    }
  }
  return undefined
}

// A time of day or an elapsed duration reaches ExcelJS as a Date on day 0 (1899-12-30 or 1904-01-01).
function formatDate(date: Date, numFmt: string, date1904: boolean): string {
  const elapsed = elapsedToken(numFmt)
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
  const total = (time - (date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30))) / 1000
  // A negative duration (only the 1904 date system has them) shows its sign once, before the parts
  const sign = total < 0 ? '-' : ''
  const seconds = Math.abs(total)
  const pad = (n: number) => String(n).padStart(2, '0')
  // Elapsed minutes count in minutes: [mm]:ss of 25 hours reads 1500:00
  if (/^m/i.test(elapsed)) return `${sign}${Math.floor(seconds / 60)}:${pad(seconds % 60)}`
  return `${sign}${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`
}
