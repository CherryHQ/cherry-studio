import type {
  ExcelImportDiagnostic,
  ExcelPreviewImageAnchor,
  ExcelPreviewImageRenderData
} from '@shared/types/excelPreview'

export type ExcelChartKind = 'area' | 'bar' | 'column' | 'line' | 'pie' | 'scatter'

export interface ExcelChartAnchor {
  from: ExcelPreviewImageAnchor
  size?: {
    height: number
    width: number
  }
  to?: ExcelPreviewImageAnchor
}

export interface ExcelChartSeries {
  categories?: Array<number | string>
  name?: string
  values: number[]
  xValues?: number[]
  yValues?: number[]
}

export interface ExcelChartRenderModel {
  anchor: ExcelChartAnchor
  id: string
  kind: ExcelChartKind
  series: ExcelChartSeries[]
  title?: string
}

export interface ExcelChartImageCollection {
  diagnostics: ExcelImportDiagnostic[]
  images: ExcelPreviewImageRenderData[]
}
