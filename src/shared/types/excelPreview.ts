import type { IWorkbookData } from '@univerjs/core'

export type ExcelImportDiagnosticCode =
  | 'invalid_excel_preview_request'
  | 'unsupported_excel_extension'
  | 'unsupported_xls_format'
  | 'excel_file_too_large'
  | 'excel_preview_too_complex'
  | 'unsupported_excel_charts'
  | 'excel_metadata_partial'
  | 'excel_parse_error'

export type ExcelImportDiagnosticSeverity = 'warning' | 'error'

export interface ExcelImportDiagnostic {
  code: ExcelImportDiagnosticCode
  count?: number
  message?: string
  severity: ExcelImportDiagnosticSeverity
}

export interface ExcelPreviewImageAnchor {
  column: number
  columnOffset: number
  row: number
  rowOffset: number
}

export interface ExcelPreviewImageSize {
  height: number
  width: number
}

export interface ExcelPreviewImageRenderData {
  from: ExcelPreviewImageAnchor
  id: string
  size?: ExcelPreviewImageSize
  source: string
  to?: ExcelPreviewImageAnchor
}

export interface ExcelPreviewCellCustom {
  excelImageRefs?: string[]
  excelImages?: ExcelPreviewImageRenderData[]
}

export interface ExcelPreviewTableRange {
  startRow: number
  startColumn: number
  endRow: number
  endColumn: number
}

export interface ExcelPreviewTableColumn {
  displayName: string
  id: string
}

export interface ExcelPreviewTableManualFilter {
  filterType: 'manual'
  isAllSelected?: boolean
  values: string[]
}

export type ExcelPreviewTableNumberFilterInfo =
  | {
      compareType: 'equal' | 'notEqual' | 'greaterThan' | 'greaterThanOrEqual' | 'lessThan' | 'lessThanOrEqual'
      conditionType: 'number'
      expectedValue: number
    }
  | {
      compareType: 'between'
      conditionType: 'number'
      expectedValue: [number, number]
    }

export interface ExcelPreviewTableStringFilterInfo {
  compareType: 'equal' | 'notEqual' | 'contains' | 'notContains' | 'startsWith' | 'endsWith'
  conditionType: 'string'
  expectedValue: string
}

export interface ExcelPreviewTableConditionFilter {
  filterInfo: ExcelPreviewTableNumberFilterInfo | ExcelPreviewTableStringFilterInfo
  filterType: 'condition'
}

export type ExcelPreviewTableFilter = ExcelPreviewTableManualFilter | ExcelPreviewTableConditionFilter

export interface ExcelPreviewTable {
  columns: ExcelPreviewTableColumn[]
  filters?: Array<ExcelPreviewTableFilter | null>
  id: string
  name: string
  range: ExcelPreviewTableRange
  sheetId: string
  showFooter?: boolean
  showHeader?: boolean
  tableStyleId?: string
}

export interface ExcelWorkbookPreviewRequest {
  fileName?: string
  filePath: string
  workspacePath: string
}

export interface ExcelWorkbookPreviewData {
  diagnostics: ExcelImportDiagnostic[]
  fileName: string
  tables?: ExcelPreviewTable[]
  workbookData: IWorkbookData
}

export type ExcelWorkbookPreviewResult =
  | {
      data: ExcelWorkbookPreviewData
      success: true
    }
  | {
      diagnostics?: ExcelImportDiagnostic[]
      error: {
        code: ExcelImportDiagnosticCode
        message: string
      }
      success: false
    }
