/**
 * Intermediate render model for xlsx previews. This is the single contract layer emitted by the Worker and consumed by UI.
 * All types must be structured-cloneable: plain data only, with no class instances or functions.
 * Keep worker/parser and UI consumers in sync when changing this file.
 */

export interface WorkbookRenderModel {
  fileName: string
  /** Workbook-level deduplicated style table. CellRenderModel.styleId points here. */
  styles: CellStyle[]
  sheets: SheetRenderModel[]
  /** Image binaries, imageId -> data. Transferred through postMessage as Transferables. */
  images: Record<number, { mime: string; data: ArrayBuffer }>
  /** Non-fatal parse issues such as unsupported features or evaluation-failure counts. The panel logs them. */
  warnings: string[]
}

export interface SheetRenderModel {
  name: string
  hidden: boolean
  /** Used range, including max row/column touched by styles, merges, and floating objects. 1-based. */
  rowCount: number
  colCount: number
  /** Default sizes in px at zoom=1. */
  defaultRowHeightPx: number
  defaultColWidthPx: number
  /** Sparse overrides storing only non-default values. Hidden rows/columns map to 0. */
  rowHeightsPx: Record<number, number>
  colWidthsPx: Record<number, number>
  /** Sparse cell table keyed as `${row}:${col}` with 1-based coordinates. */
  cells: Record<string, CellRenderModel>
  merges: MergeRange[]
  floatingImages: FloatingObjectModel[]
  charts: ChartModel[]
}

/** 1-based inclusive range. */
export interface MergeRange {
  top: number
  left: number
  bottom: number
  right: number
}

export type FormulaState =
  | 'cached' // Cached result from the file.
  | 'evaluated' // Computed by fast-formula-parser, including legal error results like #DIV/0!.
  | 'unevaluated' // Cannot be evaluated; UI shows the raw formula and dims it.

export interface CellRenderModel {
  /** Final display text with number formatting applied. Unevaluated formulas use the raw formula with leading '='. */
  text: string
  /** Underlying raw value for the status bar and future extensions. */
  raw?: string | number | boolean | null
  /** Raw formula without the leading '=', matching ExcelJS. Undefined for non-formula cells. */
  formula?: string
  formulaState?: FormulaState
  /** Index into WorkbookRenderModel.styles. undefined means all-default style. */
  styleId?: number
  hyperlink?: string
}

export interface BorderEdge {
  style: 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double' | 'hair'
  /** Resolved CSS color. */
  color: string
}

export interface CellStyle {
  fontFamily?: string
  /** pt * 4/3,zoom=1 */
  fontSizePx?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  /** Text color as a CSS color. */
  color?: string
  /** Fill color as a CSS color. Pattern fills approximate fgColor as a solid color. */
  bg?: string
  borderTop?: BorderEdge
  borderRight?: BorderEdge
  borderBottom?: BorderEdge
  borderLeft?: BorderEdge
  /** When unset, UI defaults by type: numbers right, text left, booleans/errors center. */
  hAlign?: 'left' | 'center' | 'right' | 'justify'
  vAlign?: 'top' | 'middle' | 'bottom'
  wrap?: boolean
  indent?: number
  /** Raw number format string for debugging and status bar use. */
  numFmt?: string
}

/** Floating-object anchor rect in zoom=1 px coordinates, origin at the A1 top-left, excluding row/column headers. */
export interface PxRect {
  x: number
  y: number
  width: number
  height: number
}

export interface FloatingObjectModel {
  rect: PxRect
  /** Points to WorkbookRenderModel.images. */
  imageId: number
}

export type ChartType = 'bar' | 'line' | 'pie' | 'area' | 'unsupported'

export interface ChartSeries {
  name?: string
  categories: (string | number)[]
  values: (number | null)[]
}

export interface ChartModel {
  rect: PxRect
  type: ChartType
  /** Raw type name when type === 'unsupported', such as 'scatterChart', shown in the placeholder. */
  rawTypeName?: string
  title?: string
  series: ChartSeries[]
  /** Bar charts only: 'col' for vertical columns, 'bar' for horizontal bars. */
  barDirection?: 'col' | 'bar'
  /** c:grouping stacking mode. percentStacked normalizes each category to percentages when rendered. */
  stacking?: 'stacked' | 'percentStacked'
}

// ---------------------------------------------------------------------------
// Worker protocol
// ---------------------------------------------------------------------------

export interface XlsxParseRequest {
  /** Incrementing sequence id echoed by responses. The panel discards stale responses. */
  id: number
  fileName: string
  /** postMessage transfer */
  data: ArrayBuffer
}

export type XlsxParseResponse =
  | { id: number; ok: true; model: WorkbookRenderModel }
  | { id: number; ok: false; message: string }
