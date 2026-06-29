import type { UniverWorkbookSnapshot } from '@shared/ipc/schemas/officePreview'
import { type OfficeContentNode, OfficeParser, type OfficeParserAST } from 'officeparser'
import path from 'path'

const UNIVER_MODEL_APP_VERSION = '0.25.1'
const UNIVER_LOCALE_EN_US = 'enUS'
const BOOLEAN_FALSE = 0
const BOOLEAN_TRUE = 1
const CELL_VALUE_TYPE_STRING = 1
const DEFAULT_COLUMN_COUNT = 20
const DEFAULT_ROW_COUNT = 100

type UniverCellData = {
  v: string
  t: typeof CELL_VALUE_TYPE_STRING
}

type UniverCellMatrix = Record<number, Record<number, UniverCellData>>

function isSheetNode(node: OfficeContentNode): node is OfficeContentNode & { type: 'sheet' } {
  return node.type === 'sheet'
}

function isRowNode(node: OfficeContentNode): node is OfficeContentNode & { type: 'row' } {
  return node.type === 'row'
}

function isCellNode(node: OfficeContentNode): node is OfficeContentNode & { type: 'cell' } {
  return node.type === 'cell'
}

function getSafeSheetName(node: OfficeContentNode & { type: 'sheet' }, index: number): string {
  const name = node.metadata?.sheetName?.trim()
  return name || `Sheet${index + 1}`
}

function uniqueSheetId(index: number): string {
  return `sheet-${index + 1}`
}

function createCellValue(text: string | undefined): UniverCellData | null {
  const value = text?.trim() ?? ''
  if (!value) return null
  return { v: value, t: CELL_VALUE_TYPE_STRING }
}

function putCell(cellData: UniverCellMatrix, row: number, col: number, value: UniverCellData): void {
  cellData[row] ??= {}
  cellData[row][col] = value
}

function collectSheetCellData(sheet: OfficeContentNode & { type: 'sheet' }) {
  const cellData: UniverCellMatrix = {}
  const mergeData: Array<{ startRow: number; endRow: number; startColumn: number; endColumn: number }> = []
  let maxRow = 0
  let maxCol = 0

  for (const rowNode of sheet.children ?? []) {
    if (!isRowNode(rowNode)) continue

    for (const cellNode of rowNode.children ?? []) {
      if (!isCellNode(cellNode)) continue

      const metadata = cellNode.metadata
      if (!metadata) continue

      const value = createCellValue(cellNode.text)
      if (value) putCell(cellData, metadata.row, metadata.col, value)

      const rowSpan = metadata.rowSpan ?? 1
      const colSpan = metadata.colSpan ?? 1
      if (rowSpan > 1 || colSpan > 1) {
        mergeData.push({
          startRow: metadata.row,
          endRow: metadata.row + rowSpan,
          startColumn: metadata.col,
          endColumn: metadata.col + colSpan
        })
      }

      maxRow = Math.max(maxRow, metadata.row + rowSpan)
      maxCol = Math.max(maxCol, metadata.col + colSpan)
    }
  }

  return {
    cellData,
    mergeData,
    rowCount: Math.max(DEFAULT_ROW_COUNT, maxRow + 1),
    columnCount: Math.max(DEFAULT_COLUMN_COUNT, maxCol + 1)
  }
}

function buildWorkbookSnapshot(ast: OfficeParserAST, filePath: string): UniverWorkbookSnapshot {
  const sheetNodes = ast.content.filter(isSheetNode)
  const sheets = sheetNodes.length > 0 ? sheetNodes : [{ type: 'sheet' as const, children: [], metadata: undefined }]
  const sheetOrder: string[] = []
  const sheetRecords: Record<string, unknown> = {}

  for (let index = 0; index < sheets.length; index += 1) {
    const sheet = sheets[index]
    const id = uniqueSheetId(index)
    const { cellData, mergeData, rowCount, columnCount } = collectSheetCellData(sheet)

    sheetOrder.push(id)
    sheetRecords[id] = {
      id,
      name: getSafeSheetName(sheet, index),
      tabColor: '',
      hidden: BOOLEAN_FALSE,
      freeze: { xSplit: 0, ySplit: 0, startRow: 0, startColumn: 0 },
      rowCount,
      columnCount,
      zoomRatio: 1,
      scrollTop: 0,
      scrollLeft: 0,
      defaultColumnWidth: 88,
      defaultRowHeight: 24,
      mergeData,
      cellData,
      rowData: {},
      columnData: {},
      rowHeader: { width: 46 },
      columnHeader: { height: 20 },
      showGridlines: BOOLEAN_TRUE,
      rightToLeft: BOOLEAN_FALSE
    }
  }

  return {
    id: `office-preview-${Date.now().toString(36)}`,
    name: path.basename(filePath),
    appVersion: UNIVER_MODEL_APP_VERSION,
    locale: UNIVER_LOCALE_EN_US,
    styles: {},
    sheetOrder,
    sheets: sheetRecords
  }
}

export async function convertXlsxToUniverWorkbook(filePath: string): Promise<UniverWorkbookSnapshot> {
  const ast = await OfficeParser.parseOffice(filePath, {
    extractAttachments: false,
    includeRawContent: false,
    ocr: false,
    fileType: 'xlsx'
  })
  return buildWorkbookSnapshot(ast, filePath)
}
