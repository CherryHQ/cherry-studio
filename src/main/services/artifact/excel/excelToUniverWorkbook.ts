import type {
  ExcelImportDiagnostic,
  ExcelPreviewCellCustom,
  ExcelPreviewImageAnchor,
  ExcelPreviewImageRenderData,
  ExcelPreviewTable,
  ExcelPreviewTableColumn,
  ExcelPreviewTableRange,
  ExcelWorkbookPreviewData
} from '@shared/types/excelPreview'
import {
  BooleanNumber,
  BorderStyleTypes,
  CellValueType,
  HorizontalAlign,
  type IBorderStyleData,
  type ICellData,
  type IStyleData,
  type IWorkbookData,
  type IWorksheetData,
  LocaleType,
  VerticalAlign,
  WrapStrategy
} from '@univerjs/core'
import ExcelJS from 'exceljs'

import { decodeCellRange } from './internal/excelPreviewUtils'

const UNIVER_MODEL_VERSION = '0.25.0'
const DEFAULT_ROW_COUNT = 100
const DEFAULT_COLUMN_COUNT = 26
const DEFAULT_ROW_HEIGHT = 23
const DEFAULT_COLUMN_WIDTH = 88
const DEFAULT_ROW_HEADER_WIDTH = 46
const DEFAULT_COLUMN_HEADER_HEIGHT = 20
const MS_PER_DAY = 24 * 60 * 60 * 1000
const EXCEL_UNIX_EPOCH_OFFSET_DAYS = 25569
const EXCEL_1904_OFFSET_DAYS = 1462

type CellMatrix = NonNullable<IWorksheetData['cellData']>
type RowData = NonNullable<IWorksheetData['rowData']>
type ColumnData = NonNullable<IWorksheetData['columnData']>
type MergeRange = NonNullable<IWorksheetData['mergeData']>[number]
export type ExcelWorksheetColumnData = NonNullable<IWorksheetData['columnData']>
export type ExcelWorksheetMergeData = NonNullable<IWorksheetData['mergeData']>
type ExcelWorksheetImage = ReturnType<ExcelJS.Worksheet['getImages']>[number] & {
  imageId: number | string
  range: ExcelJS.ImageRange & {
    ext?: { height: number; width: number }
  }
}
type ExcelWorkbookImage = ExcelJS.Image
type StreamWorksheetReader = ExcelJS.stream.xlsx.WorksheetReader & {
  id?: number | string
  name?: string
  state?: string
}
export type ExcelWorksheetTableData = Omit<ExcelPreviewTable, 'sheetId'>

interface WorksheetImageRenderData {
  imagesByCellKey: Map<string, ExcelPreviewImageRenderData[]>
  maxColumn: number
  maxRow: number
}

export interface ExcelStreamSheetMetadata {
  chartImages?: ExcelPreviewImageRenderData[]
  columnData?: ExcelWorksheetColumnData
  mergeData?: ExcelWorksheetMergeData
  name?: string
  state?: string
  tableData?: ExcelWorksheetTableData[]
}

type ExcelStreamSheetMetadataMap = Record<string, ExcelStreamSheetMetadata | undefined>

export interface ExcelStreamSheetMetadataIndex {
  byFileNumber: ExcelStreamSheetMetadataMap
  bySheetId: ExcelStreamSheetMetadataMap
}

export interface ExcelWorkbookPreviewBudget {
  maxChartPayloadBytes?: number
  maxChartPixels?: number
  maxCharts?: number
  maxCells?: number
  maxColumnsPerSheet?: number
  maxMerges?: number
  maxPayloadBytes?: number
  maxRowsPerSheet?: number
  maxSheets?: number
  maxStyles?: number
}

export type NormalizedExcelWorkbookPreviewBudget = Required<ExcelWorkbookPreviewBudget>

export const DEFAULT_EXCEL_WORKBOOK_PREVIEW_BUDGET: NormalizedExcelWorkbookPreviewBudget = {
  maxChartPayloadBytes: 4 * 1024 * 1024,
  maxChartPixels: 4_000_000,
  maxCharts: 20,
  maxCells: 200_000,
  maxColumnsPerSheet: 5_000,
  maxMerges: 10_000,
  maxPayloadBytes: 20 * 1024 * 1024,
  maxRowsPerSheet: 100_000,
  maxSheets: 50,
  maxStyles: 50_000
}

interface WorkbookBuildCounters {
  cells: number
  merges: number
  payloadBytes: number
  styles: number
}

interface WorkbookBuildContext {
  budget: NormalizedExcelWorkbookPreviewBudget
  counters: WorkbookBuildCounters
  date1904: boolean
  styles: IWorkbookData['styles']
  styleIdsByKey: Map<string, string>
}

export class ExcelWorkbookPreviewBudgetExceededError extends Error {
  readonly code = 'excel_preview_too_complex'

  constructor(message = 'Excel workbook is too complex to preview.') {
    super(message)
    this.name = 'ExcelWorkbookPreviewBudgetExceededError'
  }
}

export const normalizeExcelWorkbookPreviewBudget = (
  budget?: ExcelWorkbookPreviewBudget
): NormalizedExcelWorkbookPreviewBudget => ({
  ...DEFAULT_EXCEL_WORKBOOK_PREVIEW_BUDGET,
  ...budget
})

const createWorkbookBuildContext = (date1904: boolean, budget?: ExcelWorkbookPreviewBudget): WorkbookBuildContext => ({
  budget: normalizeExcelWorkbookPreviewBudget(budget),
  counters: {
    cells: 0,
    merges: 0,
    payloadBytes: 0,
    styles: 0
  },
  date1904,
  styles: {},
  styleIdsByKey: new Map()
})

const assertBudget = (condition: boolean, message: string): void => {
  if (!condition) throw new ExcelWorkbookPreviewBudgetExceededError(message)
}

const registerPayloadBytes = (context: WorkbookBuildContext, bytes: number): void => {
  context.counters.payloadBytes += bytes
  assertBudget(
    context.counters.payloadBytes <= context.budget.maxPayloadBytes,
    'Excel workbook preview payload is too large.'
  )
}

const estimateCellPayloadBytes = (cell: ICellData): number => {
  let size = 32
  if (cell.v !== undefined) size += String(cell.v).length * 2
  if (cell.f) size += cell.f.length * 2
  if (cell.s) size += String(cell.s).length
  return size
}

const dateToExcelSerial = (value: Date, date1904: boolean): number => {
  // Excel serial dates are day offsets; Date#getTime supplies the UTC-based
  // millisecond value that ExcelJS parsed from the workbook.
  return EXCEL_UNIX_EPOCH_OFFSET_DAYS + value.getTime() / MS_PER_DAY - (date1904 ? EXCEL_1904_OFFSET_DAYS : 0)
}

const toBooleanNumber = (value: boolean | undefined) => (value ? BooleanNumber.TRUE : BooleanNumber.FALSE)

const toCellKey = (row: number, column: number): string => `${row}:${column}`

const toWorkbookName = (fileName?: string): string => {
  if (!fileName) return 'Workbook'
  return fileName.replace(/\.(xlsx|xlsm)$/i, '') || fileName
}

const normalizeFormula = (formula: string | undefined): string | undefined => {
  if (!formula) return undefined
  return formula.startsWith('=') ? formula : `=${formula}`
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const toImageMimeType = (extension: string | undefined): string | undefined => {
  switch (extension?.toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'bmp':
      return 'image/bmp'
    default:
      return undefined
  }
}

const toImageDataUrl = (image: ExcelWorkbookImage | undefined): string | undefined => {
  if (!image) return undefined

  if (image.base64) {
    if (image.base64.startsWith('data:image/')) return image.base64

    const mimeType = toImageMimeType(image.extension)
    return mimeType ? `data:${mimeType};base64,${image.base64}` : undefined
  }

  if (image.buffer) {
    const mimeType = toImageMimeType(image.extension)
    return mimeType ? `data:${mimeType};base64,${Buffer.from(image.buffer).toString('base64')}` : undefined
  }

  return undefined
}

const toImageAnchor = (anchor: ExcelJS.Anchor): ExcelPreviewImageAnchor => {
  const column = Math.max(0, Math.floor(anchor.col))
  const row = Math.max(0, Math.floor(anchor.row))

  return {
    column,
    columnOffset: Math.max(0, anchor.col - column),
    row,
    rowOffset: Math.max(0, anchor.row - row)
  }
}

const addImageToCell = (
  cellData: CellMatrix,
  row: number,
  column: number,
  images: ExcelPreviewImageRenderData[]
): void => {
  if (!images.length) return

  cellData[row] ??= {}
  const existingCell = cellData[row][column] ?? {}
  const existingCustom = (isObject(existingCell.custom) ? existingCell.custom : {}) as ExcelPreviewCellCustom

  cellData[row][column] = {
    ...existingCell,
    custom: {
      ...existingCustom,
      excelImages: [...(existingCustom.excelImages ?? []), ...images]
    }
  }
}

const addImageRefToCell = (cellData: CellMatrix, row: number, column: number, imageId: string): boolean => {
  cellData[row] ??= {}
  const existingCell = cellData[row][column] ?? {}
  const existingCustom = (isObject(existingCell.custom) ? existingCell.custom : {}) as ExcelPreviewCellCustom
  const existingRefs = existingCustom.excelImageRefs ?? []
  if (existingRefs.includes(imageId)) return false

  cellData[row][column] = {
    ...existingCell,
    custom: {
      ...existingCustom,
      excelImageRefs: [...existingRefs, imageId]
    }
  }
  return true
}

const getImageFootprintRange = (
  image: ExcelPreviewImageRenderData
): { endColumn: number; endRow: number; startColumn: number; startRow: number } => {
  const endColumnPoint =
    image.to?.column !== undefined
      ? image.to.column + image.to.columnOffset
      : image.from.column + (image.size?.width ?? DEFAULT_COLUMN_WIDTH) / DEFAULT_COLUMN_WIDTH
  const endRowPoint =
    image.to?.row !== undefined
      ? image.to.row + image.to.rowOffset
      : image.from.row + (image.size?.height ?? DEFAULT_ROW_HEIGHT) / DEFAULT_ROW_HEIGHT

  return {
    endColumn: Math.max(image.from.column, Math.ceil(endColumnPoint) - 1),
    endRow: Math.max(image.from.row, Math.ceil(endRowPoint) - 1),
    startColumn: image.from.column,
    startRow: image.from.row
  }
}

const addImageRefsToCellData = (
  cellData: CellMatrix,
  images: ExcelPreviewImageRenderData[],
  context: WorkbookBuildContext
): void => {
  images.forEach((image) => {
    const range = getImageFootprintRange(image)
    for (let row = range.startRow; row <= range.endRow; row += 1) {
      for (let column = range.startColumn; column <= range.endColumn; column += 1) {
        if (addImageRefToCell(cellData, row, column, image.id)) {
          registerPayloadBytes(context, image.id.length * 2 + 32)
        }
      }
    }
  })
}

const isErrorValue = (value: ExcelJS.CellValue): value is ExcelJS.CellErrorValue => {
  return isObject(value) && typeof value.error === 'string'
}

const isRichTextValue = (value: ExcelJS.CellValue): value is ExcelJS.CellRichTextValue => {
  return isObject(value) && Array.isArray(value.richText)
}

const isHyperlinkValue = (value: ExcelJS.CellValue): value is ExcelJS.CellHyperlinkValue => {
  return isObject(value) && typeof value.hyperlink === 'string'
}

const isFormulaValue = (
  value: ExcelJS.CellValue
): value is ExcelJS.CellFormulaValue | ExcelJS.CellSharedFormulaValue => {
  return isObject(value) && ('formula' in value || 'sharedFormula' in value)
}

const toCellScalar = (value: ExcelJS.CellValue, date1904: boolean): Pick<ICellData, 't' | 'v'> => {
  if (value === null || value === undefined) return {}

  if (typeof value === 'number') {
    return Number.isFinite(value) ? { t: CellValueType.NUMBER, v: value } : {}
  }

  if (typeof value === 'boolean') {
    return { t: CellValueType.BOOLEAN, v: value }
  }

  if (typeof value === 'string') {
    return { t: CellValueType.STRING, v: value }
  }

  if (value instanceof Date) {
    return { t: CellValueType.NUMBER, v: dateToExcelSerial(value, date1904) }
  }

  if (isErrorValue(value)) {
    return { t: CellValueType.STRING, v: value.error }
  }

  if (isRichTextValue(value)) {
    return { t: CellValueType.STRING, v: value.richText.map((part) => part.text).join('') }
  }

  if (isHyperlinkValue(value)) {
    return { t: CellValueType.STRING, v: value.text || value.hyperlink }
  }

  return {}
}

const toFormulaCell = (
  cell: ExcelJS.Cell,
  value: ExcelJS.CellFormulaValue | ExcelJS.CellSharedFormulaValue,
  date1904: boolean
) => {
  const formula = normalizeFormula(value.formula ?? cell.formula)
  const scalar = toCellScalar(value.result, date1904)

  return {
    ...scalar,
    ...(formula ? { f: formula } : {})
  }
}

const colorToRgb = (color: Partial<ExcelJS.Color> | undefined): string | undefined => {
  const raw = color?.argb?.replace(/^#/, '')
  if (!raw) return undefined

  const rgb = raw.length === 8 ? raw.slice(2) : raw.length === 6 ? raw : undefined
  return rgb ? `#${rgb.toUpperCase()}` : undefined
}

const toColorStyle = (color: Partial<ExcelJS.Color> | undefined): NonNullable<IStyleData['cl']> | undefined => {
  const rgb = colorToRgb(color)
  return rgb ? { rgb } : undefined
}

const toTextDecoration = (enabled: boolean | undefined): NonNullable<IStyleData['ul']> | undefined => {
  return enabled ? { s: BooleanNumber.TRUE } : undefined
}

const toBorderStyle = (style: ExcelJS.BorderStyle | undefined): BorderStyleTypes | undefined => {
  switch (style) {
    case 'dashDot':
      return BorderStyleTypes.DASH_DOT
    case 'dashDotDot':
      return BorderStyleTypes.DASH_DOT_DOT
    case 'dashed':
      return BorderStyleTypes.DASHED
    case 'dotted':
      return BorderStyleTypes.DOTTED
    case 'double':
      return BorderStyleTypes.DOUBLE
    case 'hair':
      return BorderStyleTypes.HAIR
    case 'medium':
      return BorderStyleTypes.MEDIUM
    case 'mediumDashDot':
      return BorderStyleTypes.MEDIUM_DASH_DOT
    case 'mediumDashDotDot':
      return BorderStyleTypes.MEDIUM_DASH_DOT_DOT
    case 'mediumDashed':
      return BorderStyleTypes.MEDIUM_DASHED
    case 'slantDashDot':
      return BorderStyleTypes.SLANT_DASH_DOT
    case 'thick':
      return BorderStyleTypes.THICK
    case 'thin':
      return BorderStyleTypes.THIN
    default:
      return undefined
  }
}

const toBorderSide = (border: Partial<ExcelJS.Border> | undefined): IBorderStyleData | undefined => {
  const style = toBorderStyle(border?.style)
  if (style === undefined) return undefined

  return {
    s: style,
    cl: toColorStyle(border?.color) ?? { rgb: '#000000' }
  }
}

const toBorderData = (border: Partial<ExcelJS.Borders> | undefined): IStyleData['bd'] | undefined => {
  const top = toBorderSide(border?.top)
  const right = toBorderSide(border?.right)
  const bottom = toBorderSide(border?.bottom)
  const left = toBorderSide(border?.left)

  if (!top && !right && !bottom && !left) return undefined

  return {
    ...(top ? { t: top } : {}),
    ...(right ? { r: right } : {}),
    ...(bottom ? { b: bottom } : {}),
    ...(left ? { l: left } : {})
  }
}

const toHorizontalAlign = (alignment: Partial<ExcelJS.Alignment> | undefined): HorizontalAlign | undefined => {
  switch (alignment?.horizontal) {
    case 'center':
    case 'centerContinuous':
      return HorizontalAlign.CENTER
    case 'distributed':
      return HorizontalAlign.DISTRIBUTED
    case 'justify':
      return HorizontalAlign.JUSTIFIED
    case 'left':
      return HorizontalAlign.LEFT
    case 'right':
      return HorizontalAlign.RIGHT
    default:
      return undefined
  }
}

const toVerticalAlign = (alignment: Partial<ExcelJS.Alignment> | undefined): VerticalAlign | undefined => {
  switch (alignment?.vertical) {
    case 'bottom':
      return VerticalAlign.BOTTOM
    case 'middle':
      return VerticalAlign.MIDDLE
    case 'top':
      return VerticalAlign.TOP
    default:
      return undefined
  }
}

const toFillColor = (fill: ExcelJS.Fill | undefined): NonNullable<IStyleData['bg']> | undefined => {
  if (!fill || fill.type !== 'pattern' || fill.pattern !== 'solid') return undefined
  return toColorStyle(fill.fgColor) ?? toColorStyle(fill.bgColor)
}

const toCellStyle = (cell: ExcelJS.Cell): IStyleData | null => {
  const font = cell.font
  const alignment = cell.alignment
  const style: IStyleData = {
    ...(font?.name ? { ff: font.name } : {}),
    ...(typeof font?.size === 'number' ? { fs: font.size } : {}),
    ...(font?.bold ? { bl: BooleanNumber.TRUE } : {}),
    ...(font?.italic ? { it: BooleanNumber.TRUE } : {}),
    ...(font?.strike ? { st: { s: BooleanNumber.TRUE } } : {}),
    ...(font?.underline && font.underline !== 'none' ? { ul: toTextDecoration(true) } : {}),
    ...(toColorStyle(font?.color) ? { cl: toColorStyle(font?.color) } : {}),
    ...(toFillColor(cell.fill) ? { bg: toFillColor(cell.fill) } : {}),
    ...(toBorderData(cell.border) ? { bd: toBorderData(cell.border) } : {}),
    ...(toHorizontalAlign(alignment) ? { ht: toHorizontalAlign(alignment) } : {}),
    ...(toVerticalAlign(alignment) ? { vt: toVerticalAlign(alignment) } : {}),
    ...(alignment?.wrapText ? { tb: WrapStrategy.WRAP } : {}),
    ...(cell.numFmt ? { n: { pattern: cell.numFmt } } : {})
  }

  return Object.keys(style).length ? style : null
}

const getStyleId = (cell: ExcelJS.Cell, context: WorkbookBuildContext): string | undefined => {
  const style = toCellStyle(cell)
  if (!style) return undefined

  const key = JSON.stringify(style)
  const existing = context.styleIdsByKey.get(key)
  if (existing) return existing

  const id = `style-${context.styleIdsByKey.size + 1}`
  context.styleIdsByKey.set(key, id)
  context.styles[id] = style
  context.counters.styles += 1
  assertBudget(context.counters.styles <= context.budget.maxStyles, 'Excel workbook has too many unique styles.')
  registerPayloadBytes(context, JSON.stringify(style).length + id.length + 16)
  return id
}

const toUniverCell = (cell: ExcelJS.Cell, context: WorkbookBuildContext): ICellData | null => {
  const value = cell.value
  const scalar = isFormulaValue(value)
    ? toFormulaCell(cell, value, context.date1904)
    : toCellScalar(value, context.date1904)
  const styleId = getStyleId(cell, context)
  const univerCell: ICellData = {
    ...scalar,
    ...(styleId ? { s: styleId } : {})
  }

  return univerCell.v === undefined && !univerCell.f && !univerCell.s ? null : univerCell
}

const toRowData = (worksheet: ExcelJS.Worksheet): RowData => {
  const rowData: RowData = {}

  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber)
    if (!row.height && !row.hidden) continue

    rowData[rowNumber - 1] = {
      ...(row.height ? { h: Math.round((row.height * 96) / 72) } : {}),
      ...(row.hidden ? { hd: BooleanNumber.TRUE } : {})
    }
  }

  return rowData
}

const toColumnData = (worksheet: ExcelJS.Worksheet, columnCount: number): ColumnData => {
  const columnData: ColumnData = {}

  for (let index = 1; index <= columnCount; index += 1) {
    const column = worksheet.getColumn(index)
    const width = column.width ? Math.round(column.width * 8) : undefined
    if (!width && !column.hidden) continue

    columnData[index - 1] = {
      ...(width ? { w: width } : {}),
      ...(column.hidden ? { hd: BooleanNumber.TRUE } : {})
    }
  }

  return columnData
}

const getStreamWorksheetColumns = (worksheet: ExcelJS.stream.xlsx.WorksheetReader): ExcelJS.Column[] => {
  const columns = (worksheet as unknown as { columns?: ExcelJS.Column[] | null }).columns
  return Array.isArray(columns) ? columns : []
}

const getStreamWorkbookDate1904 = (worksheet: ExcelJS.stream.xlsx.WorksheetReader): boolean => {
  const workbook = (worksheet as unknown as { workbook?: { properties?: { model?: { date1904?: boolean } } } }).workbook
  return workbook?.properties?.model?.date1904 === true
}

const toStreamColumnData = (columns: ExcelJS.Column[], columnCount: number): ColumnData => {
  const columnData: ColumnData = {}

  for (let index = 1; index <= Math.max(columnCount, columns.length); index += 1) {
    const column = columns[index - 1]
    const width = column?.width ? Math.round(column.width * 8) : undefined
    if (!width && !column?.hidden) continue

    columnData[index - 1] = {
      ...(width ? { w: width } : {}),
      ...(column?.hidden ? { hd: BooleanNumber.TRUE } : {})
    }
  }

  return columnData
}

const toExcelPreviewTableRange = (range: string): ExcelPreviewTableRange | null => {
  const decodedRange = decodeCellRange(range)
  return decodedRange ? { ...decodedRange } : null
}

const toSafeTableIdentifier = (value: string): string => {
  return value
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

const toSheetTableId = (sheetId: string, tableName: string, index: number): string => {
  return `excel-table-${sheetId}-${toSafeTableIdentifier(tableName) || index + 1}`
}

const withSheetTableIdentity = (table: ExcelWorksheetTableData, sheetId: string, index: number): ExcelPreviewTable => {
  const tableId = toSheetTableId(sheetId, table.name, index)

  return {
    ...table,
    columns: table.columns.map((column, columnIndex) => ({
      ...column,
      id: `${tableId}-column-${columnIndex + 1}`
    })),
    id: tableId,
    sheetId
  }
}

const normalizeTableStyleId = (theme: string | undefined): string | undefined => {
  // Excel exposes built-in table style names like TableStyleMedium2, not their
  // resolved colors. Univer's closest neutral fallback is its default blue.
  return theme ? 'table-default-0' : undefined
}

const toTableColumnData = (columns: Array<{ name?: string }>, tableId: string): ExcelPreviewTableColumn[] => {
  return columns.map((column, index) => ({
    displayName: column.name || `Column ${index + 1}`,
    id: `${tableId}-column-${index + 1}`
  }))
}

type ExcelJsTableModel = {
  columns?: Array<{ name?: string }>
  displayName?: string
  headerRow?: boolean
  name?: string
  style?: { theme?: string }
  tableRef?: string
  totalsRow?: boolean
}

type ExcelJsWorksheetModelWithTables = ExcelJS.Worksheet['model'] & {
  tables?: ExcelJsTableModel[]
}

const getWorksheetTableModels = (worksheet: ExcelJS.Worksheet): ExcelJsTableModel[] => {
  const models = (worksheet.model as ExcelJsWorksheetModelWithTables).tables
  return Array.isArray(models) ? models : []
}

const tableRangeKey = (table: Pick<ExcelWorksheetTableData, 'range'>): string => {
  return `${table.range.startRow}:${table.range.startColumn}:${table.range.endRow}:${table.range.endColumn}`
}

const mergeTableData = (
  worksheet: ExcelJS.Worksheet,
  sheetId: string,
  metadata?: ExcelStreamSheetMetadata
): ExcelPreviewTable[] => {
  const metadataTables = metadata?.tableData ?? []
  const metadataByRange = new Map(metadataTables.map((table) => [tableRangeKey(table), table]))
  const tables = getWorksheetTableModels(worksheet).flatMap((tableModel, index): ExcelPreviewTable[] => {
    const tableName = tableModel.name || tableModel.displayName || `Table${index + 1}`
    const range = tableModel.tableRef ? toExcelPreviewTableRange(tableModel.tableRef) : null
    if (!range) return []

    const baseId = toSheetTableId(sheetId, tableName, index)
    const metadataTable = metadataByRange.get(tableRangeKey({ range }))
    const columns = tableModel.columns?.length ? toTableColumnData(tableModel.columns, baseId) : metadataTable?.columns

    return [
      {
        columns: columns ?? [],
        id: baseId,
        name: tableName,
        range,
        sheetId,
        showFooter: tableModel.totalsRow,
        showHeader: tableModel.headerRow,
        tableStyleId: normalizeTableStyleId(tableModel.style?.theme),
        ...(metadataTable?.filters ? { filters: metadataTable.filters } : {})
      }
    ]
  })

  const knownKeys = new Set(tables.map(tableRangeKey))
  const archiveOnlyTables = metadataTables
    .filter((table) => !knownKeys.has(tableRangeKey(table)))
    .map((table, index) => withSheetTableIdentity(table, sheetId, index))

  return [...tables, ...archiveOnlyTables]
}

const toMergeData = (worksheet: ExcelJS.Worksheet): MergeRange[] => {
  return (worksheet.model.merges ?? []).flatMap((range) => {
    const merge = decodeCellRange(range)
    return merge ? [merge] : []
  })
}

const collectWorksheetImages = (
  worksheet: ExcelJS.Worksheet,
  sheetId: string,
  context: WorkbookBuildContext
): WorksheetImageRenderData => {
  const imagesByCellKey = new Map<string, ExcelPreviewImageRenderData[]>()
  const worksheetImages = worksheet.getImages() as ExcelWorksheetImage[]
  let maxRow = -1
  let maxColumn = -1

  worksheetImages.forEach((worksheetImage, index) => {
    const source = toImageDataUrl(worksheet.workbook.getImage(Number(worksheetImage.imageId)))
    if (!source) return

    registerPayloadBytes(context, source.length * 2 + 128)

    const from = toImageAnchor(worksheetImage.range.tl)
    const to = worksheetImage.range.br ? toImageAnchor(worksheetImage.range.br) : undefined
    const image: ExcelPreviewImageRenderData = {
      from,
      id: `${sheetId}-image-${index + 1}`,
      source,
      ...(worksheetImage.range.ext
        ? {
            size: {
              height: worksheetImage.range.ext.height,
              width: worksheetImage.range.ext.width
            }
          }
        : {}),
      ...(to ? { to } : {})
    }
    const key = toCellKey(from.row, from.column)
    imagesByCellKey.set(key, [...(imagesByCellKey.get(key) ?? []), image])
    const footprint = getImageFootprintRange(image)
    maxRow = Math.max(maxRow, footprint.endRow)
    maxColumn = Math.max(maxColumn, footprint.endColumn)
  })

  return { imagesByCellKey, maxColumn, maxRow }
}

const getImageRenderDataBounds = (
  images: ExcelPreviewImageRenderData[]
): Pick<WorksheetImageRenderData, 'maxColumn' | 'maxRow'> => {
  return images.reduce(
    (bounds, image) => {
      const footprint = getImageFootprintRange(image)
      return {
        maxColumn: Math.max(bounds.maxColumn, footprint.endColumn),
        maxRow: Math.max(bounds.maxRow, footprint.endRow)
      }
    },
    { maxColumn: -1, maxRow: -1 }
  )
}

const addImagesToCellData = (
  cellData: CellMatrix,
  images: ExcelPreviewImageRenderData[],
  context: WorkbookBuildContext
): void => {
  images.forEach((image) => {
    registerPayloadBytes(context, image.source.length * 2 + 128)
    addImageToCell(cellData, image.from.row, image.from.column, [image])
  })
  addImageRefsToCellData(cellData, images, context)
}

const toWorksheetData = (
  worksheet: ExcelJS.Worksheet,
  sheetId: string,
  context: WorkbookBuildContext,
  metadata?: ExcelStreamSheetMetadata
): Partial<IWorksheetData> => {
  const cellData: CellMatrix = {}
  const worksheetImages = collectWorksheetImages(worksheet, sheetId, context)
  const metadataImages = metadata?.chartImages ?? []
  const metadataImageBounds = getImageRenderDataBounds(metadataImages)
  const rowCount = Math.max(
    worksheet.rowCount,
    worksheet.actualRowCount,
    worksheetImages.maxRow + 1,
    metadataImageBounds.maxRow + 1,
    DEFAULT_ROW_COUNT
  )
  const columnCount = Math.max(
    worksheet.columnCount,
    worksheet.actualColumnCount,
    worksheet.columns?.length ?? 0,
    worksheetImages.maxColumn + 1,
    metadataImageBounds.maxColumn + 1,
    DEFAULT_COLUMN_COUNT
  )
  assertBudget(rowCount <= context.budget.maxRowsPerSheet, `Worksheet "${worksheet.name}" has too many rows.`)
  assertBudget(columnCount <= context.budget.maxColumnsPerSheet, `Worksheet "${worksheet.name}" has too many columns.`)

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const univerCell = toUniverCell(cell, context)
      if (!univerCell) return

      context.counters.cells += 1
      assertBudget(context.counters.cells <= context.budget.maxCells, 'Excel workbook has too many cells to preview.')
      registerPayloadBytes(context, estimateCellPayloadBytes(univerCell))

      cellData[rowNumber - 1] ??= {}
      cellData[rowNumber - 1][columnNumber - 1] = univerCell
    })
  })
  worksheetImages.imagesByCellKey.forEach((images, key) => {
    const [row, column] = key.split(':').map(Number)
    addImageToCell(cellData, row, column, images)
  })
  addImageRefsToCellData(cellData, [...worksheetImages.imagesByCellKey.values()].flat(), context)
  addImagesToCellData(cellData, metadataImages, context)

  const mergeData = toMergeData(worksheet)
  context.counters.merges += mergeData.length
  assertBudget(context.counters.merges <= context.budget.maxMerges, 'Excel workbook has too many merged ranges.')
  registerPayloadBytes(context, mergeData.length * 48)

  return {
    id: sheetId,
    name: worksheet.name,
    tabColor: '',
    hidden: toBooleanNumber(worksheet.state !== 'visible'),
    freeze: {
      startRow: -1,
      startColumn: -1,
      ySplit: 0,
      xSplit: 0
    },
    rowCount,
    columnCount,
    zoomRatio: 1,
    scrollTop: 0,
    scrollLeft: 0,
    defaultColumnWidth: DEFAULT_COLUMN_WIDTH,
    defaultRowHeight: DEFAULT_ROW_HEIGHT,
    mergeData,
    cellData,
    rowData: toRowData(worksheet),
    columnData: toColumnData(worksheet, columnCount),
    rowHeader: { width: DEFAULT_ROW_HEADER_WIDTH, hidden: BooleanNumber.FALSE },
    columnHeader: { height: DEFAULT_COLUMN_HEADER_HEIGHT, hidden: BooleanNumber.FALSE },
    showGridlines: BooleanNumber.TRUE,
    rightToLeft: BooleanNumber.FALSE
  }
}

export const createUnsupportedExcelChartsDiagnostic = (count: number): ExcelImportDiagnostic => ({
  code: 'unsupported_excel_charts',
  count,
  message: 'Charts are not rendered in Excel preview yet.',
  severity: 'warning'
})

export const createExcelMetadataPartialDiagnostic = (
  message = 'Some Excel preview metadata could not be read.'
): ExcelImportDiagnostic => ({
  code: 'excel_metadata_partial',
  message,
  severity: 'warning'
})

export const mergeExcelImportDiagnostics = (
  ...diagnosticSets: Array<ExcelImportDiagnostic[] | undefined>
): ExcelImportDiagnostic[] => {
  const diagnosticsByCode = new Map<ExcelImportDiagnostic['code'], ExcelImportDiagnostic>()

  diagnosticSets
    .flatMap((diagnostics) => diagnostics ?? [])
    .forEach((diagnostic) => {
      const existing = diagnosticsByCode.get(diagnostic.code)
      if (!existing) {
        diagnosticsByCode.set(diagnostic.code, diagnostic)
        return
      }

      diagnosticsByCode.set(diagnostic.code, {
        ...existing,
        count: Math.max(existing.count ?? 0, diagnostic.count ?? 0) || undefined,
        severity: existing.severity === 'error' || diagnostic.severity === 'error' ? 'error' : 'warning'
      })
    })

  return Array.from(diagnosticsByCode.values())
}

export function excelJsWorkbookToUniverWorkbook(
  workbook: ExcelJS.Workbook,
  fileName?: string,
  budget?: ExcelWorkbookPreviewBudget,
  sheetMetadataIndex: ExcelStreamSheetMetadataIndex = { byFileNumber: {}, bySheetId: {} }
): IWorkbookData {
  const context = createWorkbookBuildContext(workbook.properties.date1904 === true, budget)
  const sheets: IWorkbookData['sheets'] = {}
  const sheetOrder: string[] = []

  assertBudget(workbook.worksheets.length <= context.budget.maxSheets, 'Excel workbook has too many sheets to preview.')

  workbook.worksheets.forEach((worksheet, index) => {
    const sheetId = `sheet-${index + 1}`
    const worksheetSheetId = worksheet.id !== undefined ? String(worksheet.id) : undefined
    const metadata =
      (worksheetSheetId ? sheetMetadataIndex.bySheetId[worksheetSheetId] : undefined) ??
      (worksheetSheetId ? sheetMetadataIndex.byFileNumber[worksheetSheetId] : undefined) ??
      sheetMetadataIndex.byFileNumber[String(index + 1)]
    sheets[sheetId] = toWorksheetData(worksheet, sheetId, context, metadata)
    sheetOrder.push(sheetId)
  })

  return {
    id: 'excel-preview-workbook',
    name: toWorkbookName(fileName),
    appVersion: UNIVER_MODEL_VERSION,
    locale: LocaleType.EN_US,
    styles: context.styles,
    sheetOrder,
    sheets
  }
}

const streamWorksheetToWorksheetData = async (
  worksheet: StreamWorksheetReader,
  sheetId: string,
  context: WorkbookBuildContext,
  metadata?: ExcelStreamSheetMetadata
): Promise<Partial<IWorksheetData>> => {
  const cellData: CellMatrix = {}
  const rowData: RowData = {}
  let maxRowNumber = 0
  let maxColumnNumber = 0

  for await (const row of worksheet) {
    maxRowNumber = Math.max(maxRowNumber, row.number)
    if (row.height || row.hidden) {
      rowData[row.number - 1] = {
        ...(row.height ? { h: Math.round((row.height * 96) / 72) } : {}),
        ...(row.hidden ? { hd: BooleanNumber.TRUE } : {})
      }
    }

    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      maxColumnNumber = Math.max(maxColumnNumber, columnNumber)
      const univerCell = toUniverCell(cell, context)
      if (!univerCell) return

      context.counters.cells += 1
      assertBudget(context.counters.cells <= context.budget.maxCells, 'Excel workbook has too many cells to preview.')
      registerPayloadBytes(context, estimateCellPayloadBytes(univerCell))

      cellData[row.number - 1] ??= {}
      cellData[row.number - 1][columnNumber - 1] = univerCell
    })
  }

  const columns = getStreamWorksheetColumns(worksheet)
  const archiveColumnData = metadata?.columnData ?? {}
  const metadataImages = metadata?.chartImages ?? []
  const mergeData = metadata?.mergeData ?? []
  const maxArchiveColumn = Object.keys(archiveColumnData).reduce((max, key) => {
    const column = Number(key)
    return Number.isInteger(column) ? Math.max(max, column) : max
  }, -1)
  const maxMergeRow = mergeData.reduce((max, merge) => Math.max(max, merge.endRow), -1)
  const maxMergeColumn = mergeData.reduce((max, merge) => Math.max(max, merge.endColumn), -1)
  const metadataImageBounds = getImageRenderDataBounds(metadataImages)
  const rowCount = Math.max(maxRowNumber, maxMergeRow + 1, metadataImageBounds.maxRow + 1, DEFAULT_ROW_COUNT)
  const columnCount = Math.max(
    maxColumnNumber,
    columns.length,
    maxArchiveColumn + 1,
    maxMergeColumn + 1,
    metadataImageBounds.maxColumn + 1,
    DEFAULT_COLUMN_COUNT
  )
  assertBudget(rowCount <= context.budget.maxRowsPerSheet, `Worksheet "${worksheet.name}" has too many rows.`)
  assertBudget(columnCount <= context.budget.maxColumnsPerSheet, `Worksheet "${worksheet.name}" has too many columns.`)
  context.counters.merges += mergeData.length
  assertBudget(context.counters.merges <= context.budget.maxMerges, 'Excel workbook has too many merged ranges.')
  registerPayloadBytes(context, mergeData.length * 48)
  const sheetName = metadata?.name || worksheet.name || String(worksheet.id ?? sheetId)
  const sheetState = metadata?.state ?? worksheet.state
  addImagesToCellData(cellData, metadataImages, context)

  return {
    id: sheetId,
    name: sheetName,
    tabColor: '',
    hidden: toBooleanNumber(sheetState !== undefined && sheetState !== 'visible'),
    freeze: {
      startRow: -1,
      startColumn: -1,
      ySplit: 0,
      xSplit: 0
    },
    rowCount,
    columnCount,
    zoomRatio: 1,
    scrollTop: 0,
    scrollLeft: 0,
    defaultColumnWidth: DEFAULT_COLUMN_WIDTH,
    defaultRowHeight: DEFAULT_ROW_HEIGHT,
    mergeData,
    cellData,
    rowData,
    columnData: Object.keys(archiveColumnData).length ? archiveColumnData : toStreamColumnData(columns, columnCount),
    rowHeader: { width: DEFAULT_ROW_HEADER_WIDTH, hidden: BooleanNumber.FALSE },
    columnHeader: { height: DEFAULT_COLUMN_HEADER_HEIGHT, hidden: BooleanNumber.FALSE },
    showGridlines: BooleanNumber.TRUE,
    rightToLeft: BooleanNumber.FALSE
  }
}

export async function excelJsStreamingWorkbookToPreviewData(
  filePath: string,
  fileName: string,
  budget?: ExcelWorkbookPreviewBudget,
  diagnostics: ExcelImportDiagnostic[] = [],
  sheetMetadataIndex: ExcelStreamSheetMetadataIndex = { byFileNumber: {}, bySheetId: {} }
): Promise<ExcelWorkbookPreviewData> {
  const context = createWorkbookBuildContext(false, budget)
  const sheets: IWorkbookData['sheets'] = {}
  const sheetOrder: string[] = []
  const tables: ExcelPreviewTable[] = []
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
    hyperlinks: 'cache',
    sharedStrings: 'cache',
    styles: 'cache',
    worksheets: 'emit'
  })

  for await (const worksheet of reader) {
    const streamWorksheet = worksheet as StreamWorksheetReader
    context.date1904 = getStreamWorkbookDate1904(streamWorksheet)
    assertBudget(sheetOrder.length < context.budget.maxSheets, 'Excel workbook has too many sheets to preview.')

    const sheetId = `sheet-${sheetOrder.length + 1}`
    const streamWorksheetId = streamWorksheet.id !== undefined ? String(streamWorksheet.id) : undefined
    const sheetIdMetadata = streamWorksheetId ? sheetMetadataIndex.bySheetId[streamWorksheetId] : undefined
    const fileNumberMetadata = streamWorksheetId ? sheetMetadataIndex.byFileNumber[streamWorksheetId] : undefined
    const sequentialFileNumberMetadata = sheetMetadataIndex.byFileNumber[String(sheetOrder.length + 1)]
    const metadata =
      sheetIdMetadata && (!streamWorksheet.name || streamWorksheet.name === sheetIdMetadata.name)
        ? sheetIdMetadata
        : (fileNumberMetadata ?? sequentialFileNumberMetadata)
    sheets[sheetId] = await streamWorksheetToWorksheetData(streamWorksheet, sheetId, context, metadata)
    tables.push(...(metadata?.tableData ?? []).map((table, index) => withSheetTableIdentity(table, sheetId, index)))
    sheetOrder.push(sheetId)
  }

  return {
    diagnostics,
    fileName,
    ...(tables.length ? { tables } : {}),
    workbookData: {
      id: 'excel-preview-workbook',
      name: toWorkbookName(fileName),
      appVersion: UNIVER_MODEL_VERSION,
      locale: LocaleType.EN_US,
      styles: context.styles,
      sheetOrder,
      sheets
    }
  }
}

export function excelJsWorkbookToPreviewData(
  workbook: ExcelJS.Workbook,
  fileName: string,
  budget?: ExcelWorkbookPreviewBudget,
  sheetMetadataIndex: ExcelStreamSheetMetadataIndex = { byFileNumber: {}, bySheetId: {} }
): ExcelWorkbookPreviewData {
  const tables = workbook.worksheets.flatMap((worksheet, index) => {
    const sheetId = `sheet-${index + 1}`
    const worksheetSheetId = worksheet.id !== undefined ? String(worksheet.id) : undefined
    const metadata =
      (worksheetSheetId ? sheetMetadataIndex.bySheetId[worksheetSheetId] : undefined) ??
      (worksheetSheetId ? sheetMetadataIndex.byFileNumber[worksheetSheetId] : undefined) ??
      sheetMetadataIndex.byFileNumber[String(index + 1)]

    return mergeTableData(worksheet, sheetId, metadata)
  })

  return {
    diagnostics: [],
    fileName,
    ...(tables.length ? { tables } : {}),
    workbookData: excelJsWorkbookToUniverWorkbook(workbook, fileName, budget, sheetMetadataIndex)
  }
}
