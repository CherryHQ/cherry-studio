import path from 'node:path'

import { loggerService } from '@logger'
import type { ExcelImportDiagnostic, ExcelPreviewImageAnchor } from '@shared/types/excelPreview'
import { XMLParser } from 'fast-xml-parser'
import type StreamZip from 'node-stream-zip'

import {
  createExcelMetadataPartialDiagnostic,
  createUnsupportedExcelChartsDiagnostic,
  type ExcelWorkbookPreviewBudget,
  ExcelWorkbookPreviewBudgetExceededError
} from '../excelToUniverWorkbook'
import { asArray, decodeCellRange, toError } from '../internal/excelPreviewUtils'
import { getExcelChartRenderSize, renderExcelChartImage } from './excelChartRenderer'
import type {
  ExcelChartImageCollection,
  ExcelChartKind,
  ExcelChartRenderModel,
  ExcelChartSeries
} from './excelChartTypes'

const EMUS_PER_PIXEL = 9525
const DEFAULT_COLUMN_WIDTH = 88
const DEFAULT_ROW_HEIGHT = 23
const DEFAULT_MAX_CHART_PIXELS = 4_000_000
const DEFAULT_MAX_CHART_PAYLOAD_BYTES = 4 * 1024 * 1024

const logger = loggerService.withContext('ExcelChartArchive')
const xmlParser = new XMLParser({
  attributeNamePrefix: '',
  ignoreAttributes: false,
  parseAttributeValue: false,
  removeNSPrefix: true
})

interface ParsedRelationship {
  Id?: string
  Target?: string
  Type?: string
}

interface ParsedRelationshipsXml {
  Relationships?: {
    Relationship?: ParsedRelationship | ParsedRelationship[]
  }
}

interface ParsedWorksheetDrawing {
  id?: string
}

interface ParsedWorksheetXml {
  worksheet?: {
    drawing?: ParsedWorksheetDrawing
    sheetData?: {
      row?: ParsedWorksheetRow | ParsedWorksheetRow[]
    }
  }
}

interface ParsedWorksheetRow {
  c?: ParsedWorksheetCell | ParsedWorksheetCell[]
}

interface ParsedWorksheetCell {
  is?: {
    t?: unknown
  }
  r?: string
  t?: string
  v?: unknown
}

interface ParsedSharedStringItem {
  r?: unknown
  t?: unknown
}

interface ParsedSharedStringsXml {
  sst?: {
    si?: ParsedSharedStringItem | ParsedSharedStringItem[]
  }
}

interface ParsedDrawingMarker {
  col?: number | string
  colOff?: number | string
  row?: number | string
  rowOff?: number | string
}

interface ParsedDrawingAnchor {
  ext?: {
    cx?: number | string
    cy?: number | string
  }
  from?: ParsedDrawingMarker
  graphicFrame?: {
    graphic?: {
      graphicData?: {
        chart?: {
          id?: string
        }
      }
    }
  }
  to?: ParsedDrawingMarker
}

interface ParsedDrawingXml {
  wsDr?: {
    oneCellAnchor?: ParsedDrawingAnchor | ParsedDrawingAnchor[]
    twoCellAnchor?: ParsedDrawingAnchor | ParsedDrawingAnchor[]
  }
}

interface ParsedChartPoint {
  idx?: number | string
  v?: unknown
}

interface ParsedChartCache {
  pt?: ParsedChartPoint | ParsedChartPoint[]
}

interface ParsedChartDataRef {
  f?: string
  numCache?: ParsedChartCache
  numLit?: ParsedChartCache
  strCache?: ParsedChartCache
  strLit?: ParsedChartCache
}

interface ParsedChartDataSource {
  numLit?: ParsedChartCache
  numRef?: ParsedChartDataRef
  strLit?: ParsedChartCache
  strRef?: ParsedChartDataRef
}

interface ParsedChartSeries {
  cat?: ParsedChartDataSource
  tx?: {
    strRef?: ParsedChartDataRef
    v?: unknown
  }
  val?: ParsedChartDataSource
  xVal?: ParsedChartDataSource
  yVal?: ParsedChartDataSource
}

interface ParsedChartKindNode {
  barDir?: {
    val?: string
  }
  ser?: ParsedChartSeries | ParsedChartSeries[]
}

interface ParsedChartXml {
  chartSpace?: {
    chart?: {
      plotArea?: {
        areaChart?: ParsedChartKindNode | ParsedChartKindNode[]
        barChart?: ParsedChartKindNode | ParsedChartKindNode[]
        lineChart?: ParsedChartKindNode | ParsedChartKindNode[]
        pieChart?: ParsedChartKindNode | ParsedChartKindNode[]
        scatterChart?: ParsedChartKindNode | ParsedChartKindNode[]
      }
      title?: unknown
    }
  }
}

interface WorksheetChartImageOptions {
  budget?: ExcelWorkbookPreviewBudget
  fileNumber: string
  sheetId: string
  sheetName?: string
  worksheet: ParsedWorksheetXml
  worksheetXml: string
  zip: StreamZip.StreamZipAsync
}

type CellValue = number | string
type CellValueMap = Map<string, CellValue>
type ParsedChartPlotArea = NonNullable<NonNullable<ParsedChartXml['chartSpace']>['chart']>['plotArea']

const parseNumber = (value: number | string | undefined): number | undefined => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const parseInteger = (value: number | string | undefined): number | undefined => {
  const parsed = parseNumber(value)
  return parsed !== undefined && Number.isInteger(parsed) ? parsed : undefined
}

const toArchiveTargetPath = (baseDir: string, target: string | undefined): string | undefined => {
  if (!target) return undefined

  const normalizedTarget = target.replace(/\\/g, '/')
  return normalizedTarget.startsWith('/')
    ? normalizedTarget.slice(1)
    : path.posix.normalize(path.posix.join(baseDir, normalizedTarget))
}

const toRelationshipPath = (entryPath: string): string => {
  const entryDir = path.posix.dirname(entryPath)
  return path.posix.join(entryDir, '_rels', `${path.posix.basename(entryPath)}.rels`)
}

const readArchiveEntryText = async (zip: StreamZip.StreamZipAsync, entryName: string): Promise<string | undefined> => {
  try {
    const entry = await zip.entry(entryName)
    if (!entry) return undefined

    return (await zip.entryData(entry)).toString('utf8')
  } catch (err) {
    logger.warn(`Failed to read Excel chart archive entry: ${entryName}`, toError(err))
    return undefined
  }
}

const readRelationshipsById = async (
  zip: StreamZip.StreamZipAsync,
  relationshipPath: string,
  diagnostics?: ExcelImportDiagnostic[]
): Promise<Map<string, ParsedRelationship>> => {
  const relsXml = await readArchiveEntryText(zip, relationshipPath)
  if (!relsXml) return new Map()

  try {
    const relationships = asArray((xmlParser.parse(relsXml) as ParsedRelationshipsXml).Relationships?.Relationship)
    return new Map(relationships.flatMap((relationship) => (relationship.Id ? [[relationship.Id, relationship]] : [])))
  } catch (err) {
    logger.warn(`Failed to parse Excel chart relationships: ${relationshipPath}`, toError(err))
    diagnostics?.push(createExcelMetadataPartialDiagnostic())
    return new Map()
  }
}

const emuToPixels = (value: number | string | undefined): number | undefined => {
  const emus = parseNumber(value)
  return emus === undefined ? undefined : emus / EMUS_PER_PIXEL
}

const toAnchor = (marker: ParsedDrawingMarker | undefined): ExcelPreviewImageAnchor | null => {
  const column = parseInteger(marker?.col)
  const row = parseInteger(marker?.row)
  if (column === undefined || row === undefined || column < 0 || row < 0) return null

  const columnOffset = Math.max(0, (emuToPixels(marker?.colOff) ?? 0) / DEFAULT_COLUMN_WIDTH)
  const rowOffset = Math.max(0, (emuToPixels(marker?.rowOff) ?? 0) / DEFAULT_ROW_HEIGHT)

  return { column, columnOffset, row, rowOffset }
}

const toChartModelAnchor = (anchor: ParsedDrawingAnchor): ExcelChartRenderModel['anchor'] | null => {
  const from = toAnchor(anchor.from)
  if (!from) return null

  const to = toAnchor(anchor.to)
  const width = emuToPixels(anchor.ext?.cx)
  const height = emuToPixels(anchor.ext?.cy)

  return {
    from,
    ...(width && height ? { size: { height, width } } : {}),
    ...(to ? { to } : {})
  }
}

const toChartRelationshipId = (anchor: ParsedDrawingAnchor): string | undefined => {
  return anchor.graphicFrame?.graphic?.graphicData?.chart?.id
}

const toDrawingAnchors = (drawing: ParsedDrawingXml): ParsedDrawingAnchor[] => {
  return [...asArray(drawing.wsDr?.oneCellAnchor), ...asArray(drawing.wsDr?.twoCellAnchor)]
}

const collectText = (value: unknown): string[] => {
  if (value === undefined || value === null) return []
  if (typeof value === 'number' || typeof value === 'string') return [String(value)]
  if (Array.isArray(value)) return value.flatMap(collectText)
  if (typeof value !== 'object') return []

  const record = value as Record<string, unknown>
  return ['tx', 'rich', 't', 'v', 'r', 'p'].flatMap((key) => collectText(record[key]))
}

const toText = (value: unknown): string | undefined => {
  const text = collectText(value).join('').trim()
  return text || undefined
}

const getPointValues = (cache: ParsedChartCache | undefined): unknown[] => {
  return asArray(cache?.pt)
    .sort((left, right) => Number(left.idx ?? 0) - Number(right.idx ?? 0))
    .map((point) => point.v)
    .filter((value) => value !== undefined)
}

const getCachedValues = (source: ParsedChartDataSource | undefined): unknown[] => {
  return [
    ...getPointValues(source?.strRef?.strCache),
    ...getPointValues(source?.strLit),
    ...getPointValues(source?.numRef?.numCache),
    ...getPointValues(source?.numLit)
  ]
}

const getFormula = (source: ParsedChartDataSource | undefined): string | undefined => {
  return source?.strRef?.f ?? source?.numRef?.f
}

const toNumberArray = (values: unknown[]): number[] => {
  return values.flatMap((value) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? [parsed] : []
  })
}

const toStringArray = (values: unknown[]): string[] => {
  return values.map((value) => String(value))
}

const readSharedStrings = async (
  zip: StreamZip.StreamZipAsync,
  diagnostics?: ExcelImportDiagnostic[]
): Promise<string[]> => {
  const sharedStringsXml = await readArchiveEntryText(zip, 'xl/sharedStrings.xml')
  if (!sharedStringsXml) return []

  try {
    const sharedStrings = xmlParser.parse(sharedStringsXml) as ParsedSharedStringsXml
    return asArray(sharedStrings.sst?.si).map((item) => toText(item) ?? '')
  } catch (err) {
    logger.warn('Failed to parse Excel shared strings for chart preview.', toError(err))
    diagnostics?.push(createExcelMetadataPartialDiagnostic())
    return []
  }
}

const collectWorksheetCellValues = (worksheet: ParsedWorksheetXml, sharedStrings: string[] = []): CellValueMap => {
  const values: CellValueMap = new Map()

  asArray(worksheet.worksheet?.sheetData?.row).forEach((row) => {
    asArray(row.c).forEach((cell) => {
      if (!cell.r) return

      if (cell.t === 's') {
        const index = parseInteger(typeof cell.v === 'number' || typeof cell.v === 'string' ? cell.v : undefined)
        const sharedValue = index === undefined ? undefined : sharedStrings[index]
        if (sharedValue !== undefined) values.set(cell.r.replace(/\$/g, '').toUpperCase(), sharedValue)
        return
      }

      const rawValue = cell.t === 'inlineStr' ? toText(cell.is) : cell.v
      if (rawValue === undefined || rawValue === null) return

      const numericValue = Number(rawValue)
      values.set(
        cell.r.replace(/\$/g, '').toUpperCase(),
        Number.isFinite(numericValue) ? numericValue : String(rawValue)
      )
    })
  })

  return values
}

const encodeColumn = (column: number): string => {
  let value = column + 1
  let letters = ''

  while (value > 0) {
    const remainder = (value - 1) % 26
    letters = String.fromCharCode(65 + remainder) + letters
    value = Math.floor((value - 1) / 26)
  }

  return letters
}

const parseFormulaRange = (formula: string | undefined, currentSheetName?: string) => {
  if (!formula) return null

  const [sheetNameRaw, rangeRaw] = formula.includes('!') ? formula.split('!') : [currentSheetName, formula]
  const sheetName = sheetNameRaw?.replace(/^'|'$/g, '').replace(/''/g, "'")
  if (sheetName && currentSheetName && sheetName !== currentSheetName) return null

  return decodeCellRange(rangeRaw)
}

const resolveFormulaValues = (
  formula: string | undefined,
  cells: CellValueMap,
  currentSheetName?: string
): CellValue[] => {
  const range = parseFormulaRange(formula, currentSheetName)
  if (!range) return []

  const values: CellValue[] = []
  for (let row = range.startRow; row <= range.endRow; row += 1) {
    for (let column = range.startColumn; column <= range.endColumn; column += 1) {
      const value = cells.get(`${encodeColumn(column)}${row + 1}`)
      if (value !== undefined) values.push(value)
    }
  }

  return values
}

const getSourceValues = (
  source: ParsedChartDataSource | undefined,
  cells: CellValueMap,
  currentSheetName?: string
): unknown[] => {
  const cached = getCachedValues(source)
  return cached.length ? cached : resolveFormulaValues(getFormula(source), cells, currentSheetName)
}

const getSeriesName = (
  series: ParsedChartSeries,
  cells: CellValueMap,
  currentSheetName?: string
): string | undefined => {
  const cached = getPointValues(series.tx?.strRef?.strCache)
  const value = cached[0] ?? series.tx?.v ?? resolveFormulaValues(series.tx?.strRef?.f, cells, currentSheetName)[0]
  return value === undefined ? undefined : String(value)
}

const toChartKind = (plotArea: ParsedChartPlotArea): { kind: ExcelChartKind; node: ParsedChartKindNode } | null => {
  const chartNodes = [
    { kind: 'bar' as const, nodes: asArray(plotArea?.barChart) },
    { kind: 'line' as const, nodes: asArray(plotArea?.lineChart) },
    { kind: 'area' as const, nodes: asArray(plotArea?.areaChart) },
    { kind: 'pie' as const, nodes: asArray(plotArea?.pieChart) },
    { kind: 'scatter' as const, nodes: asArray(plotArea?.scatterChart) }
  ].filter((entry) => entry.nodes.length > 0)

  if (chartNodes.length !== 1 || chartNodes[0].nodes.length !== 1) return null

  const [{ kind, nodes }] = chartNodes
  const node = nodes[0]
  if (kind === 'bar') return { kind: node.barDir?.val === 'bar' ? 'bar' : 'column', node }

  return { kind, node }
}

const parseChartSeries = (
  kind: ExcelChartKind,
  sourceSeries: ParsedChartSeries[],
  cells: CellValueMap,
  currentSheetName?: string
): ExcelChartSeries[] => {
  return sourceSeries.flatMap((series): ExcelChartSeries[] => {
    const name = getSeriesName(series, cells, currentSheetName)
    if (kind === 'scatter') {
      const xValues = toNumberArray(getSourceValues(series.xVal, cells, currentSheetName))
      const yValues = toNumberArray(getSourceValues(series.yVal, cells, currentSheetName))
      const values = yValues.length ? yValues : toNumberArray(getSourceValues(series.val, cells, currentSheetName))
      if (!xValues.length || !values.length) return []

      return [{ name, values, xValues, yValues: values }]
    }

    const values = toNumberArray(getSourceValues(series.val, cells, currentSheetName))
    if (!values.length) return []

    return [
      {
        categories: toStringArray(getSourceValues(series.cat, cells, currentSheetName)),
        name,
        values
      }
    ]
  })
}

const parseChartModel = (
  chartXml: string,
  id: string,
  anchor: ExcelChartRenderModel['anchor'],
  cells: CellValueMap,
  sheetName?: string
): ExcelChartRenderModel | null => {
  const chart = xmlParser.parse(chartXml) as ParsedChartXml
  const plotArea = chart.chartSpace?.chart?.plotArea
  const chartKind = plotArea ? toChartKind(plotArea) : null
  if (!chartKind) return null

  const series = parseChartSeries(chartKind.kind, asArray(chartKind.node.ser), cells, sheetName)
  if (!series.length) return null

  return {
    anchor,
    id,
    kind: chartKind.kind,
    series,
    title: toText(chart.chartSpace?.chart?.title)
  }
}

export const collectWorksheetChartImages = async ({
  budget,
  fileNumber,
  sheetId,
  sheetName,
  worksheet,
  zip
}: WorksheetChartImageOptions): Promise<ExcelChartImageCollection> => {
  const drawingRelationshipId = worksheet.worksheet?.drawing?.id
  if (!drawingRelationshipId) return { diagnostics: [], images: [] }

  const diagnostics: ExcelImportDiagnostic[] = []
  const worksheetRels = await readRelationshipsById(zip, `xl/worksheets/_rels/sheet${fileNumber}.xml.rels`, diagnostics)
  const drawingPath = toArchiveTargetPath('xl/worksheets', worksheetRels.get(drawingRelationshipId)?.Target)
  if (!drawingPath) return { diagnostics, images: [] }

  const [drawingXml, drawingRels] = await Promise.all([
    readArchiveEntryText(zip, drawingPath),
    readRelationshipsById(zip, toRelationshipPath(drawingPath), diagnostics)
  ])
  if (!drawingXml) return { diagnostics, images: [] }

  let drawing: ParsedDrawingXml
  try {
    drawing = xmlParser.parse(drawingXml) as ParsedDrawingXml
  } catch (err) {
    logger.warn(`Failed to parse Excel drawing metadata: ${drawingPath}`, toError(err))
    return { diagnostics: [...diagnostics, createExcelMetadataPartialDiagnostic()], images: [] }
  }
  const anchors = toDrawingAnchors(drawing)
  const sharedStrings = await readSharedStrings(zip, diagnostics)
  const cells = collectWorksheetCellValues(worksheet, sharedStrings)
  const images: ExcelChartImageCollection['images'] = []
  let unsupportedCount = 0
  let chartPayloadBytes = 0

  for (const [index, drawingAnchor] of anchors.entries()) {
    const chartRelationshipId = toChartRelationshipId(drawingAnchor)
    if (!chartRelationshipId) continue

    const anchor = toChartModelAnchor(drawingAnchor)
    const chartPath = toArchiveTargetPath(path.posix.dirname(drawingPath), drawingRels.get(chartRelationshipId)?.Target)
    if (!anchor || !chartPath) {
      unsupportedCount += 1
      continue
    }

    const chartXml = await readArchiveEntryText(zip, chartPath)
    let model: ExcelChartRenderModel | null = null
    if (chartXml) {
      try {
        model = parseChartModel(chartXml, `${sheetId}-chart-${index + 1}`, anchor, cells, sheetName)
      } catch (err) {
        logger.warn(`Failed to parse Excel chart metadata: ${chartPath}`, toError(err))
        diagnostics.push(createExcelMetadataPartialDiagnostic())
      }
    }
    if (!model) {
      unsupportedCount += 1
      continue
    }

    const { height, width } = getExcelChartRenderSize(model)
    if (height * width > (budget?.maxChartPixels ?? DEFAULT_MAX_CHART_PIXELS)) {
      throw new ExcelWorkbookPreviewBudgetExceededError('Excel chart preview image is too large.')
    }

    try {
      const image = await renderExcelChartImage(model)
      if (!image) {
        unsupportedCount += 1
        continue
      }

      chartPayloadBytes += image.source.length
      if (chartPayloadBytes > (budget?.maxChartPayloadBytes ?? DEFAULT_MAX_CHART_PAYLOAD_BYTES)) {
        throw new ExcelWorkbookPreviewBudgetExceededError('Excel chart preview payload is too large.')
      }
      images.push(image)
    } catch (err) {
      const error = toError(err)
      if (error instanceof ExcelWorkbookPreviewBudgetExceededError) throw error

      logger.warn(`Failed to render Excel chart: ${chartPath}`, error)
      unsupportedCount += 1
    }
  }

  return {
    diagnostics: [
      ...diagnostics,
      ...(unsupportedCount ? [createUnsupportedExcelChartsDiagnostic(unsupportedCount)] : [])
    ],
    images
  }
}
