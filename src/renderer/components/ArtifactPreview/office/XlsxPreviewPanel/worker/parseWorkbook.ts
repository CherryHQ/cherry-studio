import ExcelJS from 'exceljs'
import JSZip from 'jszip'

import { assertZipLimits } from '../../zipPreflight'
import {
  charWidthToPx,
  DEFAULT_COL_WIDTH_PX,
  DEFAULT_ROW_HEIGHT_PX,
  MAX_COLS,
  MAX_FLOATING_OBJECTS,
  MAX_MERGED_RANGES,
  MAX_ROWS,
  ptToPx
} from '../gridLayout'
import type {
  BorderEdge,
  CellRenderModel,
  CellStyle,
  FloatingObjectModel,
  MergeRange,
  SheetRenderModel,
  WorkbookRenderModel
} from '../renderModel'
import {
  createChartSheetPartPathMap,
  parseCharts,
  type SheetDataAccessor,
  type SheetLayoutAccessor
} from './chartXmlParser'
import { createFormulaEvaluator, type EvalContext, type FormulaCellRef } from './formulaEvaluator'
import { dateToExcelSerial, formatCellValue } from './numberFormat'
import { type ExcelColorRef, parseTheme, resolveColor, type ResolvedTheme } from './themeResolver'

const FORMULA_BUDGET_MS = 5000
const BORDER_SIDES = ['top', 'right', 'bottom', 'left'] as const
const BORDER_STYLE_KEYS = ['borderTop', 'borderRight', 'borderBottom', 'borderLeft'] as const
const SUPPORTED_BORDER_STYLES: ReadonlySet<BorderEdge['style']> = new Set([
  'thin',
  'medium',
  'thick',
  'dashed',
  'dotted',
  'double',
  'hair'
])
const HORIZONTAL_ALIGNMENT_MAP: Record<string, CellStyle['hAlign']> = {
  left: 'left',
  center: 'center',
  centerContinuous: 'center',
  right: 'right',
  justify: 'justify'
}
const VERTICAL_ALIGNMENT_MAP: Record<string, CellStyle['vAlign']> = {
  top: 'top',
  middle: 'middle',
  bottom: 'bottom'
}
const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp'
}
const FORMULA_DATE_KEY_STRIDE = MAX_COLS + 1

/** Internal formula cell collected during the first parsing pass for later evaluation. */
interface PendingFormulaCell {
  sheetName: string
  row: number
  col: number
  formula: string
  numFmt: string | undefined
}

/** ExcelJS rich-text cell value. */
interface RichTextCellValue {
  richText: { text: string }[]
}

function isRichTextValue(value: unknown): value is RichTextCellValue {
  return typeof value === 'object' && value !== null && Array.isArray((value as RichTextCellValue).richText)
}

interface HyperlinkCellValue {
  text: unknown
  hyperlink: string
}

function isHyperlinkValue(value: unknown): value is HyperlinkCellValue {
  return typeof value === 'object' && value !== null && 'hyperlink' in value && 'text' in value
}

interface FormulaCellValue {
  formula?: string
  sharedFormula?: string
  result?: number | string | boolean | Date | { error: string }
}

function isFormulaValue(value: unknown): value is FormulaCellValue {
  return typeof value === 'object' && value !== null && ('formula' in value || 'sharedFormula' in value)
}

interface ErrorCellValue {
  error: string
}

function isErrorValue(value: unknown): value is ErrorCellValue {
  return typeof value === 'object' && value !== null && 'error' in value && !('formula' in value)
}

/**
 * ExcelJS `WorksheetModel` declarations omit `cols` (see index.d.ts), but `worksheet.model.cols` exists at runtime
 * as a sparse list containing only non-default column definitions. Add a local type covering the actual usage here
 * to avoid `any`.
 */
interface WorksheetModelCol {
  min?: number
  max?: number
  width?: number
  hidden?: boolean
}
interface WorksheetModelWithLayout {
  cols?: WorksheetModelCol[]
}

/**
 * Row definitions must be read directly from private Worksheet `_rows` Row objects. The public
 * `worksheet.model.rows` path reserializes through Row.model, which returns null for rows with no cells and no height,
 * such as `<row r="7" hidden="1"/>`, dropping the entire row. That makes hidden rows display at default height.
 * The load path keeps complete row properties on Row objects. Only `ht="0"` is unrecoverable because of a falsy check;
 * Excel writes the hidden marker for hidden rows, so that case can be ignored.
 */
interface WorksheetWithInternalRows {
  _rows?: ({ number: number; height?: number; hidden?: boolean } | null | undefined)[]
}

/**
 * ExcelJS `ImageRange` declarations omit `ext` for oneCellAnchor, but runtime output includes it.
 * Units are px: ExcelJS ExtXform.parseOpen already converted EMU/9525 on read, so do not divide again.
 */
interface ImageRangeWithExt {
  ext?: { width: number; height: number }
}

interface AxisExtent {
  count: number
  truncated: boolean
}

interface SparseAxisIndex {
  defaultSizePx: number
  overridePositions: number[]
  cumulativeDeltas: number[]
}

interface SheetAxisIndexes {
  rows: SparseAxisIndex
  cols: SparseAxisIndex
}

interface RectUsedRange {
  rowCount: number
  colCount: number
  truncated: boolean
}

/** 'A1:D1' -> MergeRange with a 1-based inclusive range. */
function parseMergeRef(ref: string): MergeRange | null {
  const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref)
  if (!match) return null
  const left = colNameToIndex(match[1])
  const top = Number(match[2])
  const right = colNameToIndex(match[3])
  const bottom = Number(match[4])
  return { top, left, bottom, right }
}

/** Extract an error result string; formula.result may be a CellErrorValue object. */
function errorResultToString(result: unknown): string | undefined {
  if (typeof result === 'object' && result !== null && 'error' in result) {
    return (result as { error: string }).error
  }
  return undefined
}

function colNameToIndex(name: string): number {
  let n = 0
  for (let i = 0; i < name.length; i++) {
    n = n * 26 + (name.charCodeAt(i) - 64)
  }
  return n
}

function buildSparseAxisIndex(sizesByIndex: Record<number, number>, defaultSize: number): SparseAxisIndex {
  const defaultSizePx = Math.max(defaultSize, 0)
  const overridePositions = Object.keys(sizesByIndex)
    .map(Number)
    .filter((position) => Number.isInteger(position) && position >= 1)
    .sort((a, b) => a - b)
  const cumulativeDeltas = new Array<number>(overridePositions.length)
  let cumulativeDelta = 0
  for (let index = 0; index < overridePositions.length; index++) {
    const position = overridePositions[index]
    cumulativeDelta += Math.max(sizesByIndex[position] ?? defaultSizePx, 0) - defaultSizePx
    cumulativeDeltas[index] = cumulativeDelta
  }
  return { defaultSizePx, overridePositions, cumulativeDeltas }
}

function upperBound(values: number[], target: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (values[mid] <= target) low = mid + 1
    else high = mid
  }
  return low
}

function axisOffsetFromIndex(index: number, axis: SparseAxisIndex): number {
  const before = Math.max(index, 1) - 1
  const overrideCount = upperBound(axis.overridePositions, before)
  const correction = overrideCount > 0 ? axis.cumulativeDeltas[overrideCount - 1] : 0
  return before * axis.defaultSizePx + correction
}

function axisCountFromIndex(endPx: number, axis: SparseAxisIndex, maxCount: number): AxisExtent {
  if (!Number.isFinite(endPx) || endPx <= 0) return { count: 0, truncated: false }

  const maxExtentPx = axisOffsetFromIndex(maxCount + 1, axis)
  if (endPx > maxExtentPx) return { count: maxCount, truncated: true }

  let low = 1
  let high = maxCount
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (axisOffsetFromIndex(mid + 1, axis) >= endPx) high = mid
    else low = mid + 1
  }
  return { count: low, truncated: false }
}

function usedRangeForPxRect(
  rect: { x: number; y: number; width: number; height: number },
  rowAxis: SparseAxisIndex,
  colAxis: SparseAxisIndex
): RectUsedRange {
  const right = rect.x + Math.max(rect.width, 0)
  const bottom = rect.y + Math.max(rect.height, 0)
  const rowExtent = axisCountFromIndex(bottom, rowAxis, MAX_ROWS)
  const colExtent = axisCountFromIndex(right, colAxis, MAX_COLS)

  return {
    rowCount: rowExtent.count,
    colCount: colExtent.count,
    truncated: rowExtent.truncated || colExtent.truncated
  }
}

/** Parsed A1-style range reference, optionally with a sheet name, such as `Sheet1!$A$1:$B$3` or `A1`. */
interface ParsedA1Range {
  sheet?: string
  top: number
  left: number
  bottom: number
  right: number
}

/**
 * Chart reference range cell cap. Chart data references come from untrusted XML, so a tiny workbook can point a chart
 * at `Sheet1!$A$1:$XFD$1048576`. Materializing that many cells would tie up the worker before the per-chart catch can
 * recover, so references above this area throw and fall back to no data. Mirrors the formula evaluator's own guard.
 */
const MAX_CHART_RANGE_CELLS = 100_000

/** Parse an A1 range reference needed by chartXmlParser. Invalid refs return null. */
function parseA1Range(ref: string): ParsedA1Range | null {
  let sheet: string | undefined
  let rest = ref
  const bangIndex = ref.lastIndexOf('!')
  if (bangIndex !== -1) {
    // Quoted sheet names escape an embedded apostrophe by doubling it, e.g. `'Bob''s Data'`. Strip the outer quotes,
    // then unescape `''` -> `'` so the lookup key matches the parsed sheet name.
    sheet = ref.slice(0, bangIndex).replace(/^'|'$/g, '').replace(/''/g, "'")
    rest = ref.slice(bangIndex + 1)
  }
  const cellPattern = /\$?([A-Z]+)\$?(\d+)/g
  const cells: { col: number; row: number }[] = []
  let match: RegExpExecArray | null
  while ((match = cellPattern.exec(rest)) !== null) {
    cells.push({ col: colNameToIndex(match[1]), row: Number(match[2]) })
  }
  if (cells.length === 0) return null
  const cols = cells.map((c) => c.col)
  const rows = cells.map((c) => c.row)
  return {
    sheet,
    top: Math.min(...rows),
    left: Math.min(...cols),
    bottom: Math.max(...rows),
    right: Math.max(...cols)
  }
}

/**
 * Read an A1 range from the parsed cell-value reader as a 2D array for chart reference backfill. Ranges exceeding
 * MAX_CHART_RANGE_CELLS by area throw so chartXmlParser's safeReadRange catch treats them as missing data instead of
 * materializing a huge array. Booleans are mapped to 1/0, empty cells to null. Returns null for unparseable refs.
 */
type CellValueReader = (sheet: string, row: number, col: number) => string | number | boolean | null

function readRangeFromValueReader(
  readValue: CellValueReader,
  fallbackSheet: string,
  ref: string
): (string | number | null)[][] | null {
  const parsed = parseA1Range(ref)
  if (!parsed) return null
  const rangeRows = parsed.bottom - parsed.top + 1
  const rangeCols = parsed.right - parsed.left + 1
  if (rangeRows * rangeCols > MAX_CHART_RANGE_CELLS) {
    throw new Error(`chart range ${ref} exceeds ${MAX_CHART_RANGE_CELLS} cells`)
  }
  const refSheet = parsed.sheet ?? fallbackSheet
  const result: (string | number | null)[][] = []
  for (let r = parsed.top; r <= parsed.bottom; r++) {
    const rowValues: (string | number | null)[] = []
    for (let c = parsed.left; c <= parsed.right; c++) {
      const raw = readValue(refSheet, r, c)
      rowValues.push(typeof raw === 'boolean' ? (raw ? 1 : 0) : (raw ?? null))
    }
    result.push(rowValues)
  }
  return result
}

/** Compatibility helper kept for the chart-range guard's pure unit coverage. Production uses the cell-model reader. */
export function readRangeFromValueTable(
  rawValueTable: Map<string, string | number | boolean | null>,
  fallbackSheet: string,
  ref: string
): (string | number | null)[][] | null {
  return readRangeFromValueReader(
    (sheet, row, col) => rawValueTable.get(`${sheet}!${row}:${col}`) ?? null,
    fallbackSheet,
    ref
  )
}

/**
 * Cumulative pixel offset of a 1-based grid line: the summed size of every track before `index`. Drawing anchor
 * coordinates are untrusted, so this must not loop up to `index` — a crafted anchor with a huge <xdr:col>/<xdr:row>
 * would otherwise pin the worker. Instead it assumes the default size for all preceding tracks and corrects only the
 * custom-sized ones, so the cost is bounded by the sheet's actual custom-track count, independent of `index`.
 */
export function axisOffsetPx(index: number, sizesByIndex: Record<number, number>, defaultSize: number): number {
  return axisOffsetFromIndex(index, buildSparseAxisIndex(sizesByIndex, defaultSize))
}

/** Inverse of axisOffsetPx, bounded by a binary search over sparse custom-track corrections. */
export function axisCountForPxExtent(
  endPx: number,
  sizesByIndex: Record<number, number>,
  defaultSize: number,
  maxCount: number
): AxisExtent {
  return axisCountFromIndex(endPx, buildSparseAxisIndex(sizesByIndex, defaultSize), maxCount)
}

/** Only emit browser-safe bitmap MIME types for embedded workbook images. */
export function imageMimeForExtension(extension: unknown): string | undefined {
  return IMAGE_MIME_BY_EXTENSION[String(extension).toLowerCase()]
}

/** Map ExcelJS style font/fill/border/alignment to CellStyle, resolving colors through the theme. */
function buildCellStyle(cell: ExcelJS.Cell, theme: ResolvedTheme, warnings: Set<string>): CellStyle | undefined {
  const style: CellStyle = {}
  let hasAny = false

  const font = cell.font
  if (font) {
    if (font.name) {
      style.fontFamily = font.name
      hasAny = true
    }
    if (font.size) {
      style.fontSizePx = font.size * (4 / 3)
      hasAny = true
    }
    if (font.bold) {
      style.bold = true
      hasAny = true
    }
    if (font.italic) {
      style.italic = true
      hasAny = true
    }
    if (font.underline) {
      style.underline = true
      hasAny = true
    }
    if (font.strike) {
      style.strike = true
      hasAny = true
    }
    if (font.color) {
      const resolved = resolveColor(font.color as ExcelColorRef, theme)
      if (resolved) {
        style.color = resolved
        hasAny = true
      }
    }
  }

  const fill = cell.fill
  if (fill && fill.type === 'pattern') {
    if (fill.pattern === 'solid' && fill.fgColor) {
      const resolved = resolveColor(fill.fgColor as ExcelColorRef, theme)
      if (resolved) {
        style.bg = resolved
        hasAny = true
      }
    } else if (fill.pattern !== 'none' && fill.fgColor) {
      // Non-solid pattern: approximate fgColor as a solid fill.
      const resolved = resolveColor(fill.fgColor as ExcelColorRef, theme)
      if (resolved) {
        style.bg = resolved
        hasAny = true
      }
      warnings.add('cell-fill-pattern-approximated')
    }
  }

  const border = cell.border
  if (border) {
    BORDER_SIDES.forEach((side, i) => {
      const edge = border[side]
      if (edge?.style && SUPPORTED_BORDER_STYLES.has(edge.style as BorderEdge['style'])) {
        const color = resolveColor(edge.color as ExcelColorRef, theme) ?? '#000000'
        style[BORDER_STYLE_KEYS[i]] = { style: edge.style as BorderEdge['style'], color }
        hasAny = true
      } else if (edge?.style) {
        warnings.add('border-style-unsupported-approximated-as-thin')
        const color = resolveColor(edge.color as ExcelColorRef, theme) ?? '#000000'
        style[BORDER_STYLE_KEYS[i]] = { style: 'thin', color }
        hasAny = true
      }
    })
  }

  const alignment = cell.alignment
  if (alignment) {
    if (alignment.horizontal) {
      const mapped = HORIZONTAL_ALIGNMENT_MAP[alignment.horizontal]
      if (mapped) {
        style.hAlign = mapped
        hasAny = true
      }
    }
    if (alignment.vertical) {
      const mapped = VERTICAL_ALIGNMENT_MAP[alignment.vertical]
      if (mapped) {
        style.vAlign = mapped
        hasAny = true
      }
    }
    if (alignment.wrapText) {
      style.wrap = true
      hasAny = true
    }
    if (alignment.indent) {
      style.indent = alignment.indent
      hasAny = true
    }
  }

  const numFmt = cell.numFmt
  if (numFmt && numFmt !== 'General') {
    style.numFmt = numFmt
    hasAny = true
  }

  return hasAny ? style : undefined
}

/** Workbook-level style interning table. */
class StyleTable {
  private map = new Map<string, number>()
  private list: CellStyle[] = []

  intern(style: CellStyle | undefined): number | undefined {
    if (!style) return undefined
    const key = JSON.stringify(style)
    const existing = this.map.get(key)
    if (existing !== undefined) return existing
    const id = this.list.length
    this.map.set(key, id)
    this.list.push(style)
    return id
  }

  get styles(): CellStyle[] {
    return this.list
  }
}

const XDR_NS = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'

/**
 * Generators such as openpyxl can write drawing XML with a default namespace, e.g. `<wsDr xmlns=...>`, and no xdr:
 * element prefix. ExcelJS DrawingXform matches the literal name 'xdr:wsDr', so parsing returns undefined and reconcile
 * crashes with "Cannot read properties of undefined (reading 'anchors')". Any openpyxl file containing charts can fail.
 * Before passing bytes to ExcelJS, rewrite unprefixed drawing parts with the xdr: prefix. The drawing default namespace
 * is spreadsheetDrawing, so prefixing preserves semantics; already-prefixed a:/c:/r: elements are unaffected.
 * Charts and themes use our namespace-agnostic parsers and do not depend on this conversion.
 */
async function normalizeDrawingsForExcelJs(zip: JSZip, original: ArrayBuffer): Promise<ArrayBuffer> {
  const drawingFiles = zip.file(/^xl\/drawings\/[a-zA-Z0-9]+\.xml$/)
  let modified = false
  for (const file of drawingFiles) {
    const xml = await file.async('string')
    if (/<xdr:wsDr[\s>]/.test(xml)) continue
    const prefixed = xml
      .replace(/<(\/?)(?![a-zA-Z0-9._-]+:)(?![?!])([a-zA-Z][a-zA-Z0-9._-]*)/g, '<$1xdr:$2')
      .replace(/<xdr:wsDr/, `<xdr:wsDr xmlns:xdr="${XDR_NS}"`)
    zip.file(file.name, prefixed)
    modified = true
  }
  if (!modified) return original
  return zip.generateAsync({ type: 'arraybuffer' })
}

/**
 * Main parse entry point. This pure function can be tested directly by Vitest in Node without going through the Worker.
 * Fixed pipeline order: unzip -> ExcelJS cells/styles -> formula evaluation -> charts -> images -> assembly.
 */
export async function parseWorkbook(data: ArrayBuffer, fileName: string): Promise<WorkbookRenderModel> {
  // Reject ordinary declared-size zip bombs before an unzip library sees the bytes. ZIP metadata can be forged, so
  // this does not claim a hard limit on actual decompressor output; enforcing that requires a streaming inflater cap.
  assertZipLimits(new Uint8Array(data), 'XLSX')

  let zip: JSZip
  let dataForExcelJs = data
  const warnings = new Set<string>()
  try {
    zip = await JSZip.loadAsync(data)
    dataForExcelJs = await normalizeDrawingsForExcelJs(zip, data)
  } catch (err) {
    throw new Error(`Failed to parse xlsx file: ${err instanceof Error ? err.message : String(err)}`)
  }
  const hasDrawingParts = zip.file(/^xl\/drawings\/[a-zA-Z0-9]+\.xml$/).length > 0
  const chartSheetPartPathsPromise = hasDrawingParts
    ? createChartSheetPartPathMap(zip).catch((err) => {
        warnings.add(`chart-workbook-index-failed:${err instanceof Error ? err.message : String(err)}`)
        return new Map<string, string>()
      })
    : Promise.resolve<ReadonlyMap<string, string>>(new Map())

  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(dataForExcelJs)
  } catch (err) {
    throw new Error(`Failed to parse xlsx file: ${err instanceof Error ? err.message : String(err)}`)
  }
  const themeXmlFile = zip.file('xl/theme/theme1.xml')
  const themeXml = themeXmlFile ? await themeXmlFile.async('string') : null
  const theme = parseTheme(themeXml)

  const date1904 = workbook.properties?.date1904 ?? false
  const styleTable = new StyleTable()
  const images: Record<number, { mime: string; data: ArrayBuffer }> = {}
  const imageIdCache = new Map<number, number>() // ExcelJS imageId -> WorkbookRenderModel imageId
  let nextImageId = 0

  const sheets: SheetRenderModel[] = []
  const pendingFormulas: PendingFormulaCell[] = []
  // Formula/chart reads reuse the render cell tables rather than duplicating every value into a second string-keyed Map.
  const sheetCellsByName = new Map<string, Record<string, CellRenderModel>>()
  // Render cells keep ISO strings for dates; formulas and charts need Excel serials, so only date cells need overrides.
  const formulaDateSerialsBySheet = new Map<string, Map<number, number>>()
  const axisIndexesBySheet = new Map<string, SheetAxisIndexes>()

  const setFormulaDateSerial = (sheetName: string, row: number, col: number, serial: number): void => {
    let serials = formulaDateSerialsBySheet.get(sheetName)
    if (!serials) {
      serials = new Map<number, number>()
      formulaDateSerialsBySheet.set(sheetName, serials)
    }
    serials.set(row * FORMULA_DATE_KEY_STRIDE + col, serial)
  }

  const readParsedCellValue: CellValueReader = (sheetName, row, col) => {
    const dateSerial = formulaDateSerialsBySheet.get(sheetName)?.get(row * FORMULA_DATE_KEY_STRIDE + col)
    if (dateSerial !== undefined) return dateSerial
    return sheetCellsByName.get(sheetName)?.[`${row}:${col}`]?.raw ?? null
  }

  for (const worksheet of workbook.worksheets) {
    const cells: Record<string, CellRenderModel> = {}
    sheetCellsByName.set(worksheet.name, cells)

    let maxRow = 0
    let maxCol = 0

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const value = cell.value
        const style = buildCellStyle(cell, theme, warnings)

        if ((value === null || value === undefined) && !style) {
          return
        }

        if (rowNumber > MAX_ROWS || colNumber > MAX_COLS) {
          warnings.add('sheet-truncated')
          return
        }

        maxRow = Math.max(maxRow, rowNumber)
        maxCol = Math.max(maxCol, colNumber)

        const styleId = styleTable.intern(style)
        const key = `${rowNumber}:${colNumber}`
        const cellModel: CellRenderModel = { text: '', styleId }

        if (value === null || value === undefined) {
          cellModel.text = ''
          cells[key] = cellModel
          return
        }

        if (isFormulaValue(value)) {
          const errorStr = errorResultToString(value.result)
          const hasResult = value.result !== undefined
          // ExcelJS value.formula exists only on regular formulas and shared-formula masters. Shared-formula
          // dependents only have sharedFormula (the master address). cell.formula returns the formula shifted to
          // the current position.
          const formulaText = cell.formula || value.formula

          if (hasResult) {
            const dateResult = value.result instanceof Date ? value.result : null
            const rawResult: string | number | boolean | null =
              errorStr !== undefined
                ? errorStr
                : dateResult
                  ? dateResult.toISOString()
                  : (value.result as string | number | boolean)
            cellModel.raw = rawResult
            cellModel.formula = formulaText || undefined
            cellModel.formulaState = 'cached'
            cellModel.text = formatCellValue(dateResult ?? rawResult, cell.numFmt, date1904)
            // Keep date math numeric without duplicating every ordinary cell into a second value table.
            if (dateResult) {
              setFormulaDateSerial(worksheet.name, rowNumber, colNumber, dateToExcelSerial(dateResult))
            }
          } else if (formulaText) {
            // Formula text without a cached value enters the second-pass evaluator.
            cellModel.formula = formulaText
            cellModel.text = `=${formulaText}`
            cellModel.formulaState = 'unevaluated'
            pendingFormulas.push({
              sheetName: worksheet.name,
              row: rowNumber,
              col: colNumber,
              formula: formulaText,
              numFmt: cell.numFmt
            })
          } else {
            // Shared-formula dependent without a cached value. v1 does not translate refs, so mark unevaluated.
            cellModel.formulaState = 'unevaluated'
            cellModel.text = ''
            warnings.add('shared-formula-without-cache-unevaluated')
          }
          cells[key] = cellModel
          return
        }

        if (isErrorValue(value)) {
          cellModel.raw = value.error
          cellModel.text = value.error
          cells[key] = cellModel
          return
        }

        if (isHyperlinkValue(value)) {
          cellModel.hyperlink = value.hyperlink
          const text = typeof value.text === 'string' ? value.text : String(value.text)
          cellModel.raw = text
          cellModel.text = text
          cells[key] = cellModel
          return
        }

        if (isRichTextValue(value)) {
          const text = value.richText.map((seg) => seg.text).join('')
          cellModel.raw = text
          cellModel.text = text
          warnings.add('richtext-run-styles-dropped')
          cells[key] = cellModel
          return
        }

        if (value instanceof Date) {
          cellModel.raw = value.toISOString()
          cellModel.text = formatCellValue(value, cell.numFmt, date1904)
          cells[key] = cellModel
          // numfmt renders in the 1900 system, so formulas use that serial regardless of date1904.
          setFormulaDateSerial(worksheet.name, rowNumber, colNumber, dateToExcelSerial(value))
          return
        }

        // string / number / boolean
        cellModel.raw = value as string | number | boolean
        cellModel.text = formatCellValue(value, cell.numFmt, date1904)
        cells[key] = cellModel
      })
    })

    // Merged ranges.
    const merges: MergeRange[] = []
    const mergeRefs = worksheet.model.merges ?? []
    const mergeCount = Math.min(mergeRefs.length, MAX_MERGED_RANGES)
    for (let index = 0; index < mergeCount; index++) {
      const ref = mergeRefs[index]
      const range = parseMergeRef(ref)
      if (range) {
        merges.push(range)
        maxRow = Math.max(maxRow, range.bottom)
        maxCol = Math.max(maxCol, range.right)
      }
    }
    if (mergeRefs.length > MAX_MERGED_RANGES) warnings.add('merged-ranges-truncated')

    // Per-sheet custom default row height/column width from sheetFormatPr. Fall back when ExcelJS gives 0/missing.
    const sheetProps = worksheet.properties
    const defaultRowHeightPx = sheetProps?.defaultRowHeight
      ? ptToPx(sheetProps.defaultRowHeight)
      : DEFAULT_ROW_HEIGHT_PX
    const defaultColWidthPx = sheetProps?.defaultColWidth
      ? charWidthToPx(sheetProps.defaultColWidth)
      : DEFAULT_COL_WIDTH_PX

    // Sparse row heights and column widths.
    const rowHeightsPx: Record<number, number> = {}
    const colWidthsPx: Record<number, number> = {}
    const worksheetModel = worksheet.model as ExcelJS.WorksheetModel & WorksheetModelWithLayout

    const internalRows = (worksheet as unknown as WorksheetWithInternalRows)._rows
    internalRows?.forEach((row) => {
      if (!row) return
      if (row.hidden) {
        rowHeightsPx[row.number] = 0
      } else if (row.height !== undefined) {
        rowHeightsPx[row.number] = ptToPx(row.height)
      }
    })

    for (const colModel of worksheetModel.cols ?? []) {
      const min = colModel.min ?? 0
      // Whole-column definitions often have max=16384. Expand only to the render limit to avoid cloning huge maps.
      const max = Math.min(colModel.max ?? min, MAX_COLS)
      for (let c = min; c <= max; c++) {
        if (colModel.hidden) {
          colWidthsPx[c] = 0
        } else if (colModel.width !== undefined) {
          colWidthsPx[c] = charWidthToPx(colModel.width)
        }
      }
    }

    // Build sparse prefix indexes once per sheet. Offset and inverse-extent lookups are logarithmic in custom tracks,
    // independent of an untrusted anchor coordinate's magnitude.
    const axisIndexes: SheetAxisIndexes = {
      rows: buildSparseAxisIndex(rowHeightsPx, defaultRowHeightPx),
      cols: buildSparseAxisIndex(colWidthsPx, defaultColWidthPx)
    }
    axisIndexesBySheet.set(worksheet.name, axisIndexes)

    // Floating images. A crafted image with huge <xdr:col>/<xdr:row> must not scan up to the anchor.
    const floatingImages: FloatingObjectModel[] = []
    const colX = (col: number): number => axisOffsetFromIndex(col, axisIndexes.cols)
    const rowY = (row: number): number => axisOffsetFromIndex(row, axisIndexes.rows)

    for (const img of worksheet.getImages()) {
      // Anchor counts are untrusted; bound the number of <img> nodes the renderer will create.
      if (floatingImages.length >= MAX_FLOATING_OBJECTS) {
        warnings.add('floating-objects-truncated')
        break
      }
      const excelImageId = Number(img.imageId)
      let renderImageId = imageIdCache.get(excelImageId)
      if (renderImageId === undefined) {
        const stored = workbook.getImage(excelImageId)
        if (stored?.buffer) {
          const mime = imageMimeForExtension(stored.extension)
          if (!mime) {
            warnings.add('image-format-unsupported')
            continue
          }
          const nodeBuffer = stored.buffer as unknown as Uint8Array
          const copy = new ArrayBuffer(nodeBuffer.byteLength)
          new Uint8Array(copy).set(nodeBuffer)
          renderImageId = nextImageId++
          images[renderImageId] = { mime, data: copy }
          imageIdCache.set(excelImageId, renderImageId)
        }
      }
      if (renderImageId === undefined) continue

      const tl = img.range.tl
      const x = colX(tl.nativeCol + 1) + tl.nativeColOff / 9525
      const y = rowY(tl.nativeRow + 1) + tl.nativeRowOff / 9525

      let width: number
      let height: number
      const ext = (img.range as ExcelJS.ImageRange & ImageRangeWithExt).ext
      if (img.range.br) {
        const br = img.range.br
        const brX = colX(br.nativeCol + 1) + br.nativeColOff / 9525
        const brY = rowY(br.nativeRow + 1) + br.nativeRowOff / 9525
        width = brX - x
        height = brY - y
      } else if (ext) {
        // ExcelJS already converted ext from EMU to px in ExtXform.parseOpen.
        width = ext.width
        height = ext.height
      } else {
        warnings.add('image-anchor-missing-extent')
        continue
      }

      const rect = { x, y, width, height }
      floatingImages.push({ rect, imageId: renderImageId })

      const usedRange = usedRangeForPxRect(rect, axisIndexes.rows, axisIndexes.cols)
      maxRow = Math.max(maxRow, Math.ceil(tl.nativeRow + 1), usedRange.rowCount)
      maxCol = Math.max(maxCol, Math.ceil(tl.nativeCol + 1), usedRange.colCount)
      if (usedRange.truncated) warnings.add('sheet-truncated')
    }

    const rowCount = Math.min(Math.max(maxRow, 1), MAX_ROWS)
    const colCount = Math.min(Math.max(maxCol, 1), MAX_COLS)
    if (maxRow > MAX_ROWS || maxCol > MAX_COLS) {
      warnings.add('sheet-truncated')
    }

    sheets.push({
      name: worksheet.name,
      hidden: worksheet.state === 'hidden' || worksheet.state === 'veryHidden',
      rowCount,
      colCount,
      defaultRowHeightPx,
      defaultColWidthPx,
      rowHeightsPx,
      colWidthsPx,
      cells,
      merges,
      floatingImages,
      charts: []
    })
  }

  // Formula evaluation second pass.
  if (pendingFormulas.length > 0 && date1904) {
    // fast-formula-parser hard-codes the 1900 epoch (its date functions are built on a d1900 constant with no
    // 1904 option) and date overrides use 1900-system serials, so evaluating a 1904-system workbook could
    // silently shift results by 1462 days wherever the workbook's own serial convention shows through (serial
    // literals in formulas, raw serial display). Prefer honestly unevaluated formulas over wrong values: skip
    // the second pass and keep the first-pass unevaluated state. Cached formula results are unaffected.
    warnings.add('formulas-unevaluated-date1904')
  } else if (pendingFormulas.length > 0) {
    // Forward refs to formula cells later in file order evaluate recursively before falling back to parsed cell data.
    // The evaluator has memoization and cycle detection, so re-entry is safe.
    const pendingByKey = new Map<string, PendingFormulaCell>()
    for (const pending of pendingFormulas) {
      pendingByKey.set(`${pending.sheetName}!${pending.row}:${pending.col}`, pending)
    }

    // eslint-disable-next-line prefer-const -- evalContext and evaluator reference each other, so declare before assign.
    let evaluator: ReturnType<typeof createFormulaEvaluator>
    const evalContext: EvalContext = {
      getCellValue(ref: FormulaCellRef) {
        const refKey = `${ref.sheet}!${ref.row}:${ref.col}`
        const pending = pendingByKey.get(refKey)
        if (pending) {
          // Memoization makes completed cells O(1). Cycles/failures are classified by the evaluator as unevaluated -> null.
          const outcome = evaluator.evaluate(pending.formula, { sheet: ref.sheet, row: ref.row, col: ref.col })
          if (outcome.state === 'evaluated') {
            return outcome.value ?? null
          }
          return null
        }
        return readParsedCellValue(ref.sheet, ref.row, ref.col)
      }
    }
    evaluator = createFormulaEvaluator(evalContext, FORMULA_BUDGET_MS)

    for (const pending of pendingFormulas) {
      const outcome = evaluator.evaluate(pending.formula, {
        sheet: pending.sheetName,
        row: pending.row,
        col: pending.col
      })
      const cellsForSheet = sheetCellsByName.get(pending.sheetName)
      if (!cellsForSheet) continue
      const key = `${pending.row}:${pending.col}`
      const cellModel = cellsForSheet[key]
      if (!cellModel) continue

      if (outcome.state === 'evaluated') {
        const value = outcome.value ?? null
        cellModel.raw = value
        cellModel.formulaState = 'evaluated'
        cellModel.text = formatCellValue(value, pending.numFmt, date1904)
      } else {
        warnings.add('formula-unevaluated')
      }
    }
  }

  // Charts must parse after formula evaluation so reference backfill can use evaluated cell values.
  const chartSheetPartPaths = await chartSheetPartPathsPromise
  for (const worksheet of workbook.worksheets) {
    const sheetModel = sheets.find((s) => s.name === worksheet.name)
    const axisIndexes = axisIndexesBySheet.get(worksheet.name)
    if (!sheetModel || !axisIndexes) continue

    const layout: SheetLayoutAccessor = {
      colX(col: number) {
        return axisOffsetFromIndex(col, axisIndexes.cols)
      },
      rowY(row: number) {
        return axisOffsetFromIndex(row, axisIndexes.rows)
      }
    }

    const dataAccessor: SheetDataAccessor = {
      readRange(ref: string): (string | number | null)[][] | null {
        return readRangeFromValueReader(readParsedCellValue, worksheet.name, ref)
      }
    }

    try {
      // Images and charts share the per-sheet floating-object budget.
      const { charts, warnings: chartWarnings } = await parseCharts(
        zip,
        worksheet.name,
        layout,
        dataAccessor,
        MAX_FLOATING_OBJECTS - sheetModel.floatingImages.length,
        chartSheetPartPaths
      )
      sheetModel.charts = charts
      for (const chart of charts) {
        const usedRange = usedRangeForPxRect(chart.rect, axisIndexes.rows, axisIndexes.cols)
        sheetModel.rowCount = Math.max(sheetModel.rowCount, usedRange.rowCount)
        sheetModel.colCount = Math.max(sheetModel.colCount, usedRange.colCount)
        if (usedRange.truncated) warnings.add('sheet-truncated')
      }
      chartWarnings.forEach((w) => warnings.add(w))
    } catch (err) {
      warnings.add(`chart-parse-failed:${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return {
    fileName,
    styles: styleTable.styles,
    sheets,
    images,
    warnings: Array.from(warnings)
  }
}
