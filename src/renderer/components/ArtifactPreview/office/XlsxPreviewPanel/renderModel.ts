/**
 * xlsx 预览的中间渲染模型 — Worker 产出、UI 消费的唯一契约层。
 * 全部类型必须可结构化克隆(纯数据,无类实例、无函数)。
 * 修改时需同步更新 worker/parser 与 UI 消费侧。
 */

export interface WorkbookRenderModel {
  fileName: string
  /** 工作簿级去重样式表;CellRenderModel.styleId 指向此处 */
  styles: CellStyle[]
  sheets: SheetRenderModel[]
  /** 图片二进制,imageId → 数据;postMessage 时作为 Transferable 传输 */
  images: Record<number, { mime: string; data: ArrayBuffer }>
  /** 解析过程中的非致命问题(不支持的特性、求值失败统计等),面板负责 log */
  warnings: string[]
}

export interface SheetRenderModel {
  name: string
  hidden: boolean
  /** 使用范围(含样式/合并/浮动对象波及的最大行列),1-based */
  rowCount: number
  colCount: number
  /** 默认尺寸,px(zoom=1) */
  defaultRowHeightPx: number
  defaultColWidthPx: number
  /** 稀疏覆盖:仅存非默认值。隐藏行/列 → 0 */
  rowHeightsPx: Record<number, number>
  colWidthsPx: Record<number, number>
  /** 稀疏单元格表,key = `${row}:${col}`(1-based) */
  cells: Record<string, CellRenderModel>
  merges: MergeRange[]
  floatingImages: FloatingObjectModel[]
  charts: ChartModel[]
}

/** 1-based,闭区间 */
export interface MergeRange {
  top: number
  left: number
  bottom: number
  right: number
}

export type FormulaState =
  | 'cached' // 文件自带缓存结果
  | 'evaluated' // fast-formula-parser 算出(含 #DIV/0! 等合法错误结果)
  | 'unevaluated' // 无法求值 → UI 显示公式原文并置灰

export interface CellRenderModel {
  /** 最终显示文本(数字格式已应用)。unevaluated 公式 → 公式原文(含前导 '=') */
  text: string
  /** 底层原始值,状态栏/后续扩展用 */
  raw?: string | number | boolean | null
  /** 公式原文,不含前导 '='(与 ExcelJS 一致);非公式单元格为 undefined */
  formula?: string
  formulaState?: FormulaState
  /** 指向 WorkbookRenderModel.styles 的下标;undefined = 全默认样式 */
  styleId?: number
  hyperlink?: string
}

export interface BorderEdge {
  style: 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double' | 'hair'
  /** 已解析的 CSS 颜色 */
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
  /** 文字色,CSS 颜色 */
  color?: string
  /** 填充色,CSS 颜色(pattern 填充取 fgColor 近似为纯色) */
  bg?: string
  borderTop?: BorderEdge
  borderRight?: BorderEdge
  borderBottom?: BorderEdge
  borderLeft?: BorderEdge
  /** 未设置时 UI 按类型默认:数字右对齐、文本左对齐、布尔/错误居中 */
  hAlign?: 'left' | 'center' | 'right' | 'justify'
  vAlign?: 'top' | 'middle' | 'bottom'
  wrap?: boolean
  indent?: number
  /** 原始格式串,调试/状态栏用 */
  numFmt?: string
}

/** 浮动对象锚定矩形:zoom=1 的 px 坐标,原点为网格 A1 左上角(不含行列表头) */
export interface PxRect {
  x: number
  y: number
  width: number
  height: number
}

export interface FloatingObjectModel {
  rect: PxRect
  /** 指向 WorkbookRenderModel.images */
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
  /** type === 'unsupported' 时的原始类型名(如 'scatterChart'),占位提示用 */
  rawTypeName?: string
  title?: string
  series: ChartSeries[]
  /** bar 专用:'col' 纵向柱 | 'bar' 横向条 */
  barDirection?: 'col' | 'bar'
  stacked?: boolean
}

// ---------------------------------------------------------------------------
// Worker 协议
// ---------------------------------------------------------------------------

export interface XlsxParseRequest {
  /** 递增序号,响应回带;面板丢弃过期响应 */
  id: number
  fileName: string
  /** postMessage transfer */
  data: ArrayBuffer
}

export type XlsxParseResponse =
  | { id: number; ok: true; model: WorkbookRenderModel }
  | { id: number; ok: false; message: string }
