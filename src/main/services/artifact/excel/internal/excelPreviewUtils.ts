export interface ExcelCellAddress {
  column: number
  row: number
}

export interface ExcelCellRange {
  endColumn: number
  endRow: number
  startColumn: number
  startRow: number
}

export const asArray = <T>(value: T | T[] | undefined): T[] => {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

export const toError = (err: unknown) => (err instanceof Error ? err : new Error(String(err)))

export const decodeColumn = (letters: string): number | null => {
  let column = 0
  for (const char of letters.toUpperCase()) {
    const code = char.charCodeAt(0)
    if (code < 65 || code > 90) return null
    column = column * 26 + code - 64
  }
  return column - 1
}

export const decodeCellAddress = (address: string): ExcelCellAddress | null => {
  const match = /^([A-Z]+)(\d+)$/i.exec(address.replace(/\$/g, ''))
  if (!match) return null

  const column = decodeColumn(match[1])
  const row = Number(match[2])
  if (column === null || !Number.isInteger(row) || row < 1) return null

  return { column, row: row - 1 }
}

export const decodeCellRange = (range: string): ExcelCellRange | null => {
  const [startRaw, endRaw = startRaw] = range.split(':')
  const start = decodeCellAddress(startRaw)
  const end = decodeCellAddress(endRaw)
  if (!start || !end) return null

  return {
    endColumn: Math.max(start.column, end.column),
    endRow: Math.max(start.row, end.row),
    startColumn: Math.min(start.column, end.column),
    startRow: Math.min(start.row, end.row)
  }
}
