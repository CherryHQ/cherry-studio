import { promises as fs } from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { isPathInside } from '@main/utils/file/path'
import { AbsolutePathSchema } from '@shared/data/types/file'
import type {
  ExcelImportDiagnostic,
  ExcelImportDiagnosticCode,
  ExcelPreviewTableFilter,
  ExcelPreviewTableRange,
  ExcelPreviewTableStringFilterInfo,
  ExcelWorkbookPreviewRequest,
  ExcelWorkbookPreviewResult
} from '@shared/types/excelPreview'
import { XMLParser } from 'fast-xml-parser'
import StreamZip from 'node-stream-zip'
import * as z from 'zod'

import { collectWorksheetChartImages } from './chart/excelChartArchive'
import {
  createExcelMetadataPartialDiagnostic,
  createUnsupportedExcelChartsDiagnostic,
  DEFAULT_EXCEL_WORKBOOK_PREVIEW_BUDGET,
  type ExcelStreamSheetMetadata,
  type ExcelStreamSheetMetadataIndex,
  type ExcelWorkbookPreviewBudget,
  ExcelWorkbookPreviewBudgetExceededError,
  type ExcelWorksheetColumnData,
  type ExcelWorksheetMergeData,
  type ExcelWorksheetTableData,
  normalizeExcelWorkbookPreviewBudget
} from './excelToUniverWorkbook'
import { asArray, decodeCellRange, toError } from './internal/excelPreviewUtils'

export const EXCEL_PREVIEW_MAX_SIZE_BYTES = 25 * 1024 * 1024

const SUPPORTED_EXCEL_PREVIEW_EXTENSIONS = new Set(['.xlsx', '.xlsm'])

const RelativeFilePathSchema = z
  .string()
  .min(1)
  .refine((s) => !s.includes('\0'), 'filePath must not contain null bytes')
  .refine((s) => !s.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(s), 'filePath must be workspace-relative')

const ExcelWorkbookPreviewRequestSchema = z.strictObject({
  filePath: RelativeFilePathSchema,
  fileName: z.string().min(1).optional(),
  workspacePath: AbsolutePathSchema
})

const logger = loggerService.withContext('ExcelPreviewService')
const XLSX_CHART_ENTRY_PATTERN = /^xl\/charts\/[^/]+[.]xml$/i
const excelArchiveXmlParser = new XMLParser({
  attributeNamePrefix: '',
  ignoreAttributes: false,
  parseAttributeValue: false,
  removeNSPrefix: true
})

interface ParsedWorkbookSheet {
  id?: string
  name?: string
  sheetId?: string
  state?: string
}

interface ParsedWorkbookXml {
  workbook?: {
    sheets?: {
      sheet?: ParsedWorkbookSheet | ParsedWorkbookSheet[]
    }
  }
}

interface ParsedWorkbookRelationship {
  Id?: string
  Target?: string
  Type?: string
}

interface ParsedWorkbookRelationshipsXml {
  Relationships?: {
    Relationship?: ParsedWorkbookRelationship | ParsedWorkbookRelationship[]
  }
}

interface ParsedWorksheetMergeCell {
  ref?: string
}

interface ParsedWorksheetColumn {
  hidden?: boolean | number | string
  max?: number | string
  min?: number | string
  width?: number | string
}

interface ParsedWorksheetXml {
  worksheet?: {
    cols?: {
      col?: ParsedWorksheetColumn | ParsedWorksheetColumn[]
    }
    drawing?: {
      id?: string
    }
    mergeCells?: {
      mergeCell?: ParsedWorksheetMergeCell | ParsedWorksheetMergeCell[]
    }
    tableParts?: {
      tablePart?: ParsedWorksheetTablePart | ParsedWorksheetTablePart[]
    }
  }
}

interface ExcelArchiveWorksheetMetadata {
  chartImages: ExcelStreamSheetMetadata['chartImages']
  columnData: ExcelWorksheetColumnData
  diagnostics: ExcelImportDiagnostic[]
  mergeData: ExcelWorksheetMergeData
  tableData: ExcelWorksheetTableData[]
}

interface ParsedWorksheetTablePart {
  id?: string
}

interface ParsedTableColumn {
  id?: number | string
  name?: string
}

interface ParsedTableFilter {
  val?: string
}

interface ParsedTableCustomFilter {
  operator?: string
  val?: string
}

interface ParsedTableFilterColumn {
  colId?: number | string
  customFilters?: {
    and?: boolean | number | string
    customFilter?: ParsedTableCustomFilter | ParsedTableCustomFilter[]
  }
  filters?: {
    filter?: ParsedTableFilter | ParsedTableFilter[]
  }
  hiddenButton?: boolean | number | string
}

interface ParsedTableXml {
  table?: {
    autoFilter?: {
      filterColumn?: ParsedTableFilterColumn | ParsedTableFilterColumn[]
    }
    displayName?: string
    headerRowCount?: number | string
    name?: string
    ref?: string
    tableColumns?: {
      tableColumn?: ParsedTableColumn | ParsedTableColumn[]
    }
    tableStyleInfo?: {
      name?: string
    }
    totalsRowCount?: number | string
  }
}

interface ExcelArchiveMetadata {
  diagnostics: ExcelImportDiagnostic[]
  hasCharts: boolean
  sheetMetadataIndex: ExcelStreamSheetMetadataIndex
}

const fail = (code: ExcelImportDiagnosticCode, message: string): ExcelWorkbookPreviewResult => ({
  success: false,
  error: { code, message },
  diagnostics: [{ code, message, severity: 'error' }]
})

const normalizeFileName = (request: ExcelWorkbookPreviewRequest) => {
  return request.fileName || path.basename(request.filePath)
}

const normalizeRelativeFilePath = (filePath: string): string => filePath.replace(/[\\/]+/g, path.sep)

const isUnsupportedExcelDrawingError = (error: Error): boolean => {
  // ExcelJS throws this internal drawing error on chart workbooks; streaming
  // mode preserves cells when chart metadata was already collected separately.
  return error.message.includes("reading 'anchors'") || error.message.includes('reading "anchors"')
}

const readArchiveEntryText = async (zip: StreamZip.StreamZipAsync, entryName: string): Promise<string | undefined> => {
  try {
    const entry = await zip.entry(entryName)
    if (!entry) return undefined

    return (await zip.entryData(entry)).toString('utf8')
  } catch (err) {
    logger.warn(`Failed to read Excel archive entry: ${entryName}`, toError(err))
    return undefined
  }
}

const getWorksheetFileNumberFromRelationshipTarget = (target: string | undefined): string | undefined => {
  if (!target) return undefined

  const normalizedTarget = target.startsWith('/')
    ? target.slice(1)
    : path.posix.normalize(path.posix.join('xl', target.replace(/\\/g, '/')))
  const match = /^xl\/worksheets\/sheet(\d+)[.]xml$/i.exec(normalizedTarget)
  return match?.[1]
}

const decodeTableRange = (range: string | undefined): ExcelPreviewTableRange | null => {
  const decodedRange = range ? decodeCellRange(range) : null
  return decodedRange ? { ...decodedRange } : null
}

const parseExcelBooleanAttribute = (value: boolean | number | string | undefined): boolean => {
  return value === true || value === 1 || value === '1' || value === 'true'
}

const parseExcelNumberAttribute = (value: number | string | undefined): number | undefined => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const parseExcelIntegerAttribute = (value: number | string | undefined): number | undefined => {
  const parsed = parseExcelNumberAttribute(value)
  return parsed !== undefined && Number.isInteger(parsed) ? parsed : undefined
}

const parseWorksheetColumnData = (worksheet: ParsedWorksheetXml): ExcelWorksheetColumnData => {
  const columnData: ExcelWorksheetColumnData = {}
  const columnDefinitions = asArray(worksheet.worksheet?.cols?.col)

  columnDefinitions.forEach((columnDefinition) => {
    const min = parseExcelIntegerAttribute(columnDefinition.min)
    const max = parseExcelIntegerAttribute(columnDefinition.max)
    if (!min || !max || min < 1 || max < min) return

    const width = parseExcelNumberAttribute(columnDefinition.width)
    const hidden = parseExcelBooleanAttribute(columnDefinition.hidden)
    if (!width && !hidden) return

    for (let column = min; column <= max; column += 1) {
      columnData[column - 1] = {
        ...(width ? { w: Math.round(width * 8) } : {}),
        ...(hidden ? { hd: 1 } : {})
      }
    }
  })

  return columnData
}

const parseWorksheetMergeData = (worksheet: ParsedWorksheetXml): ExcelWorksheetMergeData => {
  const mergeCells = asArray(worksheet.worksheet?.mergeCells?.mergeCell)

  return mergeCells.flatMap((mergeCell) => {
    const merge = decodeCellRange(mergeCell.ref ?? '')
    return merge ? [merge] : []
  })
}

const toArchiveTargetPath = (baseDir: string, target: string | undefined): string | undefined => {
  if (!target) return undefined

  const normalizedTarget = target.replace(/\\/g, '/')
  return normalizedTarget.startsWith('/')
    ? normalizedTarget.slice(1)
    : path.posix.normalize(path.posix.join(baseDir, normalizedTarget))
}

const toSafeTableIdentifier = (value: string): string => {
  return value
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

const normalizeTableStyleId = (theme: string | undefined): string | undefined => {
  // Excel exposes built-in table style names like TableStyleMedium2, not their
  // resolved colors. Univer's closest neutral fallback is its default blue.
  return theme ? 'table-default-0' : undefined
}

const toNumberFilterCompareType = (
  operator: string | undefined
): 'equal' | 'notEqual' | 'greaterThan' | 'greaterThanOrEqual' | 'lessThan' | 'lessThanOrEqual' => {
  switch (operator) {
    case 'notEqual':
      return 'notEqual'
    case 'greaterThan':
      return 'greaterThan'
    case 'greaterThanOrEqual':
      return 'greaterThanOrEqual'
    case 'lessThan':
      return 'lessThan'
    case 'lessThanOrEqual':
      return 'lessThanOrEqual'
    default:
      return 'equal'
  }
}

const unescapeExcelWildcardValue = (value: string): string => value.replace(/~([*?~])/g, '$1')

const getUnescapedExcelWildcardPositions = (value: string, wildcard: '*' | '?'): number[] => {
  const positions: number[] = []
  let escaped = false

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (escaped) {
      escaped = false
      continue
    }

    if (char === '~') {
      escaped = true
      continue
    }

    if (char === wildcard) {
      positions.push(index)
    }
  }

  return positions
}

const toStringFilterInfo = (operator: string | undefined, value: string): ExcelPreviewTableStringFilterInfo => {
  const starPositions = getUnescapedExcelWildcardPositions(value, '*')
  const hasQuestionWildcard = getUnescapedExcelWildcardPositions(value, '?').length > 0

  // Excel stores text contains/startsWith/endsWith filters as wildcard equality
  // expressions, with "~" escaping literal wildcard characters.
  if (value.length > 1 && !hasQuestionWildcard) {
    const excludesMatches = operator === 'notEqual'
    const hasLeadingWildcard = starPositions.includes(0)
    const hasTrailingWildcard = starPositions.includes(value.length - 1)
    const hasOnlyBoundaryWildcards = starPositions.every((position) => position === 0 || position === value.length - 1)

    if (hasOnlyBoundaryWildcards && hasLeadingWildcard && hasTrailingWildcard && value.length > 2) {
      return {
        conditionType: 'string',
        compareType: excludesMatches ? 'notContains' : 'contains',
        expectedValue: unescapeExcelWildcardValue(value.slice(1, -1))
      }
    }

    if (hasOnlyBoundaryWildcards && !excludesMatches && hasTrailingWildcard) {
      return {
        conditionType: 'string',
        compareType: 'startsWith',
        expectedValue: unescapeExcelWildcardValue(value.slice(0, -1))
      }
    }

    if (hasOnlyBoundaryWildcards && !excludesMatches && hasLeadingWildcard) {
      return {
        conditionType: 'string',
        compareType: 'endsWith',
        expectedValue: unescapeExcelWildcardValue(value.slice(1))
      }
    }
  }

  return {
    conditionType: 'string',
    compareType: operator === 'notEqual' ? 'notEqual' : 'equal',
    expectedValue: unescapeExcelWildcardValue(value)
  }
}

const isNumericFilterValue = (value: string): boolean => {
  return value.trim() !== '' && Number.isFinite(Number(value))
}

const parseCustomFilter = (filter: ParsedTableCustomFilter): ExcelPreviewTableFilter | null => {
  if (filter.val === undefined) return null

  if (isNumericFilterValue(filter.val)) {
    return {
      filterType: 'condition',
      filterInfo: {
        conditionType: 'number',
        compareType: toNumberFilterCompareType(filter.operator),
        expectedValue: Number(filter.val)
      }
    }
  }

  return {
    filterType: 'condition',
    filterInfo: toStringFilterInfo(filter.operator, filter.val)
  }
}

const parseCustomFilters = (filters: ParsedTableFilterColumn['customFilters']): ExcelPreviewTableFilter | null => {
  const customFilters = asArray(filters?.customFilter)
  if (customFilters.length === 1) return parseCustomFilter(customFilters[0])

  const numericFilters = customFilters.filter((filter) => filter.val !== undefined && isNumericFilterValue(filter.val))
  if (numericFilters.length !== 2 || !parseExcelBooleanAttribute(filters?.and)) return null

  const lower = numericFilters.find(
    (filter) => filter.operator === 'greaterThanOrEqual' || filter.operator === 'greaterThan'
  )
  const upper = numericFilters.find((filter) => filter.operator === 'lessThanOrEqual' || filter.operator === 'lessThan')
  if (!lower?.val || !upper?.val) return null

  return {
    filterType: 'condition',
    filterInfo: {
      conditionType: 'number',
      compareType: 'between',
      expectedValue: [Number(lower.val), Number(upper.val)]
    }
  }
}

const parseTableFilterColumn = (filterColumn: ParsedTableFilterColumn): ExcelPreviewTableFilter | null => {
  const manualValues = asArray(filterColumn.filters?.filter)
    .map((filter) => filter.val)
    .filter((value): value is string => value !== undefined)

  if (manualValues.length) {
    return {
      filterType: 'manual',
      values: manualValues
    }
  }

  return parseCustomFilters(filterColumn.customFilters)
}

const parseTableFilters = (table: ParsedTableXml): Array<ExcelPreviewTableFilter | null> | undefined => {
  const filterColumns = asArray(table.table?.autoFilter?.filterColumn)
  if (!filterColumns.length) return undefined

  const filters: Array<ExcelPreviewTableFilter | null> = []
  filterColumns.forEach((filterColumn) => {
    const columnIndex = parseExcelIntegerAttribute(filterColumn.colId)
    if (columnIndex === undefined || columnIndex < 0) return

    filters[columnIndex] = parseTableFilterColumn(filterColumn)
  })

  return filters.some(Boolean) ? filters.map((filter) => filter ?? null) : undefined
}

const parseArchiveTableData = (tableXml: string, fallbackIndex: number): ExcelWorksheetTableData | null => {
  const table = excelArchiveXmlParser.parse(tableXml) as ParsedTableXml
  const tableName = table.table?.name || table.table?.displayName || `Table${fallbackIndex + 1}`
  const range = decodeTableRange(table.table?.ref)
  if (!range) return null

  const tableId = `excel-table-${toSafeTableIdentifier(tableName) || fallbackIndex + 1}`
  const columns = asArray(table.table?.tableColumns?.tableColumn).map((column, index) => ({
    displayName: column.name || `Column ${index + 1}`,
    id: `${tableId}-column-${index + 1}`
  }))
  const filters = parseTableFilters(table)

  return {
    columns,
    id: tableId,
    name: tableName,
    range,
    showFooter: parseExcelBooleanAttribute(table.table?.totalsRowCount),
    showHeader: table.table?.headerRowCount !== '0' && table.table?.headerRowCount !== 0,
    tableStyleId: normalizeTableStyleId(table.table?.tableStyleInfo?.name),
    ...(filters ? { filters } : {})
  }
}

const collectWorksheetTableData = async (
  zip: StreamZip.StreamZipAsync,
  fileNumber: string,
  worksheet: ParsedWorksheetXml,
  diagnostics: ExcelImportDiagnostic[]
): Promise<ExcelWorksheetTableData[]> => {
  const tableParts = asArray(worksheet.worksheet?.tableParts?.tablePart)
  if (!tableParts.length) return []

  const relsXml = await readArchiveEntryText(zip, `xl/worksheets/_rels/sheet${fileNumber}.xml.rels`)
  if (!relsXml) return []

  let relationships: ParsedWorkbookRelationship[] = []
  try {
    relationships = asArray(
      (excelArchiveXmlParser.parse(relsXml) as ParsedWorkbookRelationshipsXml).Relationships?.Relationship
    )
  } catch (err) {
    logger.warn(`Failed to parse Excel worksheet table relationships: sheet${fileNumber}.xml.rels`, toError(err))
    diagnostics.push(createExcelMetadataPartialDiagnostic())
  }
  const relationshipsById = new Map(relationships.map((relationship) => [relationship.Id, relationship]))

  const tableData: ExcelWorksheetTableData[] = []
  for (const [index, tablePart] of tableParts.entries()) {
    const relationship = tablePart.id ? relationshipsById.get(tablePart.id) : undefined
    const tablePath = toArchiveTargetPath('xl/worksheets', relationship?.Target)
    if (!tablePath) continue

    const tableXml = await readArchiveEntryText(zip, tablePath)
    let parsedTable: ExcelWorksheetTableData | null = null
    try {
      parsedTable = tableXml ? parseArchiveTableData(tableXml, index) : null
    } catch (err) {
      logger.warn(`Failed to parse Excel table metadata: ${tablePath}`, toError(err))
      diagnostics.push(createExcelMetadataPartialDiagnostic())
    }
    if (parsedTable) tableData.push(parsedTable)
  }

  return tableData
}

const collectArchiveWorksheetMetadata = async (
  zip: StreamZip.StreamZipAsync,
  fileNumber: string,
  sheetId: string,
  sheetName?: string,
  budget?: ExcelWorkbookPreviewBudget
): Promise<ExcelArchiveWorksheetMetadata> => {
  const worksheetXml = await readArchiveEntryText(zip, `xl/worksheets/sheet${fileNumber}.xml`)
  if (!worksheetXml) return { chartImages: [], columnData: {}, diagnostics: [], mergeData: [], tableData: [] }

  const diagnostics: ExcelImportDiagnostic[] = []
  let worksheet: ParsedWorksheetXml
  try {
    worksheet = excelArchiveXmlParser.parse(worksheetXml) as ParsedWorksheetXml
  } catch (err) {
    logger.warn(`Failed to parse Excel worksheet metadata: sheet${fileNumber}.xml`, toError(err))
    return {
      chartImages: [],
      columnData: {},
      diagnostics: [createExcelMetadataPartialDiagnostic()],
      mergeData: [],
      tableData: []
    }
  }
  const chartImages = await collectWorksheetChartImages({
    budget,
    fileNumber,
    sheetId,
    sheetName,
    worksheet,
    worksheetXml,
    zip
  })
  const tableData = await collectWorksheetTableData(zip, fileNumber, worksheet, diagnostics)

  return {
    chartImages: chartImages.images,
    columnData: parseWorksheetColumnData(worksheet),
    diagnostics: [...diagnostics, ...chartImages.diagnostics],
    mergeData: parseWorksheetMergeData(worksheet),
    tableData
  }
}

const collectArchiveSheetMetadata = async (
  zip: StreamZip.StreamZipAsync,
  budget?: ExcelWorkbookPreviewBudget
): Promise<Pick<ExcelArchiveMetadata, 'diagnostics' | 'sheetMetadataIndex'>> => {
  const [workbookXml, workbookRelsXml] = await Promise.all([
    readArchiveEntryText(zip, 'xl/workbook.xml'),
    readArchiveEntryText(zip, 'xl/_rels/workbook.xml.rels')
  ])
  const sheetMetadataIndex: ExcelStreamSheetMetadataIndex = {
    byFileNumber: {},
    bySheetId: {}
  }
  if (!workbookXml) return { diagnostics: [], sheetMetadataIndex }

  const diagnostics: ExcelImportDiagnostic[] = []
  let workbook: ParsedWorkbookXml
  try {
    workbook = excelArchiveXmlParser.parse(workbookXml) as ParsedWorkbookXml
  } catch (err) {
    logger.warn('Failed to parse Excel workbook metadata.', toError(err))
    return { diagnostics: [createExcelMetadataPartialDiagnostic()], sheetMetadataIndex }
  }
  const sheets = asArray(workbook.workbook?.sheets?.sheet)
  if (!sheets.length) return { diagnostics: [], sheetMetadataIndex }

  let relationships: ParsedWorkbookRelationship[] = []
  if (workbookRelsXml) {
    try {
      relationships = asArray(
        (excelArchiveXmlParser.parse(workbookRelsXml) as ParsedWorkbookRelationshipsXml).Relationships?.Relationship
      )
    } catch (err) {
      logger.warn('Failed to parse Excel workbook relationships metadata.', toError(err))
      diagnostics.push(createExcelMetadataPartialDiagnostic())
    }
  }
  const relationshipsById = new Map(relationships.map((relationship) => [relationship.Id, relationship]))

  for (const [index, sheet] of sheets.entries()) {
    if (!sheet.name) continue

    const relationship = sheet.id ? relationshipsById.get(sheet.id) : undefined
    const fileNumber = getWorksheetFileNumberFromRelationshipTarget(relationship?.Target) ?? String(index + 1)
    const worksheetMetadata = await collectArchiveWorksheetMetadata(
      zip,
      fileNumber,
      `sheet-${index + 1}`,
      sheet.name,
      budget
    )
    diagnostics.push(...worksheetMetadata.diagnostics)
    const metadata: ExcelStreamSheetMetadata = {
      ...(worksheetMetadata.chartImages?.length ? { chartImages: worksheetMetadata.chartImages } : {}),
      ...(Object.keys(worksheetMetadata.columnData).length ? { columnData: worksheetMetadata.columnData } : {}),
      ...(worksheetMetadata.mergeData.length ? { mergeData: worksheetMetadata.mergeData } : {}),
      ...(worksheetMetadata.tableData.length ? { tableData: worksheetMetadata.tableData } : {}),
      name: sheet.name,
      ...(sheet.state ? { state: sheet.state } : {})
    }
    sheetMetadataIndex.byFileNumber[fileNumber] = metadata
    if (sheet.sheetId) {
      sheetMetadataIndex.bySheetId[sheet.sheetId] = metadata
    }
  }

  return { diagnostics, sheetMetadataIndex }
}

const getRenderedArchiveChartCount = (sheetMetadataIndex: ExcelStreamSheetMetadataIndex): number => {
  return Object.values(sheetMetadataIndex.byFileNumber).reduce(
    (count, metadata) => count + (metadata?.chartImages?.length ?? 0),
    0
  )
}

const getUnsupportedArchiveChartCount = (diagnostics: ExcelImportDiagnostic[]): number => {
  return diagnostics.reduce(
    (count, diagnostic) => count + (diagnostic.code === 'unsupported_excel_charts' ? (diagnostic.count ?? 1) : 0),
    0
  )
}

const collectArchiveMetadata = async (
  filePath: string,
  budget?: ExcelWorkbookPreviewBudget
): Promise<ExcelArchiveMetadata> => {
  const zip = new StreamZip.async({ file: filePath })

  try {
    const entries = await zip.entries()
    const entryNames = Object.keys(entries)
    const chartCount = entryNames.filter((entryName) => XLSX_CHART_ENTRY_PATTERN.test(entryName)).length
    if (chartCount > (budget?.maxCharts ?? DEFAULT_EXCEL_WORKBOOK_PREVIEW_BUDGET.maxCharts)) {
      throw new ExcelWorkbookPreviewBudgetExceededError('Excel workbook has too many charts to preview.')
    }
    const sheetMetadata = await collectArchiveSheetMetadata(zip, budget)
    const renderedChartCount = getRenderedArchiveChartCount(sheetMetadata.sheetMetadataIndex)
    const unsupportedChartCount = getUnsupportedArchiveChartCount(sheetMetadata.diagnostics)
    const unaccountedChartCount = Math.max(0, chartCount - renderedChartCount - unsupportedChartCount)
    const unsupportedTotal = unsupportedChartCount + unaccountedChartCount
    const nonChartDiagnostics = sheetMetadata.diagnostics.filter(
      (diagnostic) => diagnostic.code !== 'unsupported_excel_charts'
    )

    return {
      diagnostics: [
        ...nonChartDiagnostics,
        ...(unsupportedTotal ? [createUnsupportedExcelChartsDiagnostic(unsupportedTotal)] : [])
      ],
      hasCharts: chartCount > 0,
      sheetMetadataIndex: sheetMetadata.sheetMetadataIndex
    }
  } finally {
    await zip.close()
  }
}

const getArchiveMetadata = async (
  filePath: string,
  budget?: ExcelWorkbookPreviewBudget
): Promise<ExcelArchiveMetadata> => {
  try {
    return await collectArchiveMetadata(filePath, budget)
  } catch (err) {
    if (err instanceof ExcelWorkbookPreviewBudgetExceededError) {
      throw err
    }
    logger.warn(`Failed to inspect Excel archive metadata: ${filePath}`, toError(err))
    return {
      diagnostics: [createExcelMetadataPartialDiagnostic()],
      hasCharts: false,
      sheetMetadataIndex: { byFileNumber: {}, bySheetId: {} }
    }
  }
}

export interface ReadExcelWorkbookPreviewOptions {
  budget?: ExcelWorkbookPreviewBudget
}

export async function readExcelWorkbookPreview(
  request: ExcelWorkbookPreviewRequest,
  options: ReadExcelWorkbookPreviewOptions = {}
): Promise<ExcelWorkbookPreviewResult> {
  const parsed = ExcelWorkbookPreviewRequestSchema.safeParse(request)
  if (!parsed.success) {
    return fail('invalid_excel_preview_request', 'Invalid Excel preview request.')
  }

  const normalizedRequest = parsed.data
  const workspaceRoot = path.resolve(normalizedRequest.workspacePath)
  const resolvedFilePath = path.resolve(workspaceRoot, normalizeRelativeFilePath(normalizedRequest.filePath))

  if (!isPathInside(resolvedFilePath, workspaceRoot)) {
    return fail('invalid_excel_preview_request', 'Excel preview file must stay inside the workspace.')
  }

  const extension = path.extname(resolvedFilePath).toLowerCase()

  if (extension === '.xls') {
    return fail('unsupported_xls_format', 'Legacy .xls files are not supported by Excel preview.')
  }

  if (!SUPPORTED_EXCEL_PREVIEW_EXTENSIONS.has(extension)) {
    return fail('unsupported_excel_extension', 'Only .xlsx and .xlsm files can be previewed.')
  }

  try {
    const [realWorkspaceRoot, realFilePath] = await Promise.all([
      fs.realpath(workspaceRoot),
      fs.realpath(resolvedFilePath)
    ])
    if (!isPathInside(realFilePath, realWorkspaceRoot)) {
      return fail('invalid_excel_preview_request', 'Excel preview file must stay inside the workspace.')
    }

    const stats = await fs.stat(realFilePath)
    if (!stats.isFile()) {
      return fail('invalid_excel_preview_request', 'Excel preview path is not a file.')
    }
    if (stats.size > EXCEL_PREVIEW_MAX_SIZE_BYTES) {
      return fail('excel_file_too_large', 'Excel preview supports files up to 25 MB.')
    }

    const budget = normalizeExcelWorkbookPreviewBudget(options.budget)
    const archiveMetadata = await getArchiveMetadata(realFilePath, budget)
    const [
      { default: ExcelJS },
      { excelJsStreamingWorkbookToPreviewData, excelJsWorkbookToPreviewData, mergeExcelImportDiagnostics }
    ] = await Promise.all([import('exceljs'), import('./excelToUniverWorkbook')])
    const workbook = new ExcelJS.Workbook()
    try {
      await workbook.xlsx.readFile(realFilePath)
    } catch (err) {
      const error = toError(err)
      if (!archiveMetadata.hasCharts || !isUnsupportedExcelDrawingError(error)) {
        throw error
      }

      logger.warn(`Excel workbook contains unsupported chart drawings; using cell-only preview: ${realFilePath}`)
      return {
        success: true,
        data: await excelJsStreamingWorkbookToPreviewData(
          realFilePath,
          normalizeFileName(normalizedRequest),
          budget,
          archiveMetadata.diagnostics,
          archiveMetadata.sheetMetadataIndex
        )
      }
    }

    const data = excelJsWorkbookToPreviewData(
      workbook,
      normalizeFileName(normalizedRequest),
      budget,
      archiveMetadata.sheetMetadataIndex
    )
    data.diagnostics = mergeExcelImportDiagnostics(data.diagnostics, archiveMetadata.diagnostics)

    return {
      success: true,
      data
    }
  } catch (err) {
    const error = toError(err)
    logger.error(`Failed to read Excel workbook preview: ${resolvedFilePath}`, error)
    if (error instanceof ExcelWorkbookPreviewBudgetExceededError) {
      return fail(error.code, error.message)
    }
    return fail('excel_parse_error', 'Failed to read Excel workbook preview.')
  }
}
