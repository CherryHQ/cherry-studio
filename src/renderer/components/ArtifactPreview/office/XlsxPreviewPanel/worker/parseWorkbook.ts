import ExcelJS from 'exceljs'
import JSZip from 'jszip'

import { charWidthToPx, DEFAULT_COL_WIDTH_PX, DEFAULT_ROW_HEIGHT_PX, MAX_COLS, MAX_ROWS, ptToPx } from '../gridLayout'
import type {
  BorderEdge,
  CellRenderModel,
  CellStyle,
  FloatingObjectModel,
  FormulaState,
  MergeRange,
  SheetRenderModel,
  WorkbookRenderModel
} from '../renderModel'
import { parseCharts, type SheetDataAccessor, type SheetLayoutAccessor } from './chartXmlParser'
import { createFormulaEvaluator, type EvalContext, type FormulaCellRef } from './formulaEvaluator'
import { formatCellValue } from './numberFormat'
import { type ExcelColorRef, parseTheme, resolveColor, type ResolvedTheme } from './themeResolver'

const FORMULA_BUDGET_MS = 5000

/** 内部:公式流水线第一遍收集到的待求值单元格 */
interface PendingFormulaCell {
  sheetName: string
  row: number
  col: number
  formula: string
  numFmt: string | undefined
}

/** ExcelJS 富文本单元格值 */
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
 * ExcelJS 的 `WorksheetModel` 类型声明未包含 `cols`(见 index.d.ts),但运行时
 * `worksheet.model.cols` 确有输出(稀疏,仅含非默认列定义)。这里补充本地类型
 * 覆盖实际使用面,避免用 `any`。
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
 * 行定义必须直接读 Worksheet 私有 `_rows` 上的 Row 对象:公开的 `worksheet.model.rows`
 * 走 Row.model getter 重新序列化,对「无单元格且无高度」的行(如 `<row r="7" hidden="1"/>`
 * 空隐藏行)返回 null 整行丢弃,导致隐藏行按默认行高显示出来。load 路径在 Row 对象上保留了
 * 完整行属性(仅 `ht="0"` 因 falsy 判断不可恢复;Excel 对隐藏行总会写 hidden 标记,可忽略)。
 */
interface WorksheetWithInternalRows {
  _rows?: ({ number: number; height?: number; hidden?: boolean } | null | undefined)[]
}

/**
 * ExcelJS `ImageRange` 类型声明遗漏了 oneCellAnchor 场景下的 `ext`,运行时确有输出。
 * 注意单位是 **px**:ExcelJS 的 ExtXform.parseOpen 读取时已做 EMU/9525 换算,勿再除。
 */
interface ImageRangeWithExt {
  ext?: { width: number; height: number }
}

/** 'A1:D1' → MergeRange(1-based,闭区间) */
function parseMergeRef(ref: string): MergeRange | null {
  const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref)
  if (!match) return null
  const left = colNameToIndex(match[1])
  const top = Number(match[2])
  const right = colNameToIndex(match[3])
  const bottom = Number(match[4])
  return { top, left, bottom, right }
}

/** 提取错误结果字符串形态(formula.result 可能是 CellErrorValue 对象) */
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

/** A1 风格区间引用(可含 sheet 名,如 `Sheet1!$A$1:$B$3` 或 `A1`)解析结果 */
interface ParsedA1Range {
  sheet?: string
  top: number
  left: number
  bottom: number
  right: number
}

/** 解析 chartXmlParser 需要的 A1 区间引用;不合法返回 null */
function parseA1Range(ref: string): ParsedA1Range | null {
  let sheet: string | undefined
  let rest = ref
  const bangIndex = ref.lastIndexOf('!')
  if (bangIndex !== -1) {
    sheet = ref.slice(0, bangIndex).replace(/^'|'$/g, '')
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

/** 将 ExcelJS Style.font/fill/border/alignment 映射为 CellStyle,颜色经 theme 解析 */
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
      // 非 solid pattern:近似取 fgColor 为纯色
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
    const sides = ['top', 'right', 'bottom', 'left'] as const
    const styleKeys = ['borderTop', 'borderRight', 'borderBottom', 'borderLeft'] as const
    const supportedBorderStyles = new Set<BorderEdge['style']>([
      'thin',
      'medium',
      'thick',
      'dashed',
      'dotted',
      'double',
      'hair'
    ])
    sides.forEach((side, i) => {
      const edge = border[side]
      if (edge?.style && supportedBorderStyles.has(edge.style as BorderEdge['style'])) {
        const color = resolveColor(edge.color as ExcelColorRef, theme) ?? '#000000'
        style[styleKeys[i]] = { style: edge.style as BorderEdge['style'], color }
        hasAny = true
      } else if (edge?.style) {
        warnings.add('border-style-unsupported-approximated-as-thin')
        const color = resolveColor(edge.color as ExcelColorRef, theme) ?? '#000000'
        style[styleKeys[i]] = { style: 'thin', color }
        hasAny = true
      }
    })
  }

  const alignment = cell.alignment
  if (alignment) {
    if (alignment.horizontal) {
      const hMap: Record<string, CellStyle['hAlign']> = {
        left: 'left',
        center: 'center',
        centerContinuous: 'center',
        right: 'right',
        justify: 'justify'
      }
      const mapped = hMap[alignment.horizontal]
      if (mapped) {
        style.hAlign = mapped
        hasAny = true
      }
    }
    if (alignment.vertical) {
      const vMap: Record<string, CellStyle['vAlign']> = { top: 'top', middle: 'middle', bottom: 'bottom' }
      const mapped = vMap[alignment.vertical]
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

/** 工作簿级样式去重表 */
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
 * openpyxl 等生成器把 drawing XML 写成默认命名空间(<wsDr xmlns=...>,元素无 xdr: 前缀)。
 * ExcelJS 的 DrawingXform 按字面量 'xdr:wsDr' 匹配,解析结果为 undefined,并在 reconcile
 * 阶段以 "Cannot read properties of undefined (reading 'anchors')" 崩溃——任何含图表的
 * openpyxl 文件都无法打开。喂给 ExcelJS 前把无前缀 drawing 部件重写为 xdr: 前缀
 * (drawing 的默认命名空间即 spreadsheetDrawing,前缀化语义不变;a:/c:/r: 等已带前缀的
 * 元素不受影响)。图表/主题走我们自己的命名空间无关解析器,不依赖此转换。
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
 * 解析总入口:纯函数,Node 下可直接由 Vitest 测试(不经 Worker)。
 * 流水线顺序(固定):unzip → ExcelJS 单元格/样式 → 公式求值 → 图表 → 图片 → 组装。
 */
export async function parseWorkbook(data: ArrayBuffer, fileName: string): Promise<WorkbookRenderModel> {
  let zip: JSZip
  let dataForExcelJs = data
  try {
    zip = await JSZip.loadAsync(data)
    dataForExcelJs = await normalizeDrawingsForExcelJs(zip, data)
  } catch (err) {
    throw new Error(`Failed to parse xlsx file: ${err instanceof Error ? err.message : String(err)}`)
  }

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
  const warnings = new Set<string>()
  const styleTable = new StyleTable()
  const images: Record<number, { mime: string; data: ArrayBuffer }> = {}
  const imageIdCache = new Map<number, number>() // ExcelJS imageId -> WorkbookRenderModel imageId
  let nextImageId = 0

  const sheets: SheetRenderModel[] = []
  // 跨 sheet 单元格原始值查表,供公式求值使用
  const rawValueTable = new Map<string, string | number | boolean | null>()
  const pendingFormulas: PendingFormulaCell[] = []
  // sheet 名 -> 待填充的 cells 表(公式求值结果二次回填要用)
  const sheetCellsByName = new Map<string, Record<string, CellRenderModel>>()

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
          rawValueTable.set(`${worksheet.name}!${rowNumber}:${colNumber}`, null)
          return
        }

        if (isFormulaValue(value)) {
          const errorStr = errorResultToString(value.result)
          const hasResult = value.result !== undefined
          // sharedFormula 从属单元格只有 result/sharedFormula(master 地址),没有 formula 原文
          const formulaText = value.formula

          if (hasResult) {
            const rawResult: string | number | boolean | null =
              errorStr !== undefined
                ? errorStr
                : value.result instanceof Date
                  ? value.result.toISOString()
                  : (value.result as string | number | boolean)
            cellModel.raw = rawResult
            cellModel.formula = value.formula ?? undefined
            cellModel.formulaState = 'cached' as FormulaState
            cellModel.text = formatCellValue(
              value.result instanceof Date ? value.result : rawResult,
              cell.numFmt,
              date1904
            )
            rawValueTable.set(`${worksheet.name}!${rowNumber}:${colNumber}`, rawResult)
          } else if (formulaText) {
            // 有公式原文但无缓存值:进入第二遍求值
            cellModel.formula = formulaText
            cellModel.text = `=${formulaText}`
            cellModel.formulaState = 'unevaluated' as FormulaState
            pendingFormulas.push({
              sheetName: worksheet.name,
              row: rowNumber,
              col: colNumber,
              formula: formulaText,
              numFmt: cell.numFmt
            })
            rawValueTable.set(`${worksheet.name}!${rowNumber}:${colNumber}`, null)
          } else {
            // shared-formula 从属单元格且无缓存值:v1 不做引用平移,标 unevaluated
            cellModel.formulaState = 'unevaluated' as FormulaState
            cellModel.text = ''
            warnings.add('shared-formula-without-cache-unevaluated')
            rawValueTable.set(`${worksheet.name}!${rowNumber}:${colNumber}`, null)
          }
          cells[key] = cellModel
          return
        }

        if (isErrorValue(value)) {
          cellModel.raw = value.error
          cellModel.text = value.error
          cells[key] = cellModel
          rawValueTable.set(`${worksheet.name}!${rowNumber}:${colNumber}`, value.error)
          return
        }

        if (isHyperlinkValue(value)) {
          cellModel.hyperlink = value.hyperlink
          const text = typeof value.text === 'string' ? value.text : String(value.text)
          cellModel.raw = text
          cellModel.text = text
          cells[key] = cellModel
          rawValueTable.set(`${worksheet.name}!${rowNumber}:${colNumber}`, text)
          return
        }

        if (isRichTextValue(value)) {
          const text = value.richText.map((seg) => seg.text).join('')
          cellModel.raw = text
          cellModel.text = text
          warnings.add('richtext-run-styles-dropped')
          cells[key] = cellModel
          rawValueTable.set(`${worksheet.name}!${rowNumber}:${colNumber}`, text)
          return
        }

        if (value instanceof Date) {
          cellModel.raw = value.toISOString()
          cellModel.text = formatCellValue(value, cell.numFmt, date1904)
          cells[key] = cellModel
          // 供公式引用:用 serial 数值近似不可行(需 date1904 上下文),此处退化为 ISO 字符串
          rawValueTable.set(`${worksheet.name}!${rowNumber}:${colNumber}`, value.toISOString())
          return
        }

        // string / number / boolean
        cellModel.raw = value as string | number | boolean
        cellModel.text = formatCellValue(value, cell.numFmt, date1904)
        cells[key] = cellModel
        rawValueTable.set(`${worksheet.name}!${rowNumber}:${colNumber}`, value as string | number | boolean)
      })
    })

    // 合并区
    const merges: MergeRange[] = []
    for (const ref of worksheet.model.merges ?? []) {
      const range = parseMergeRef(ref)
      if (range) {
        merges.push(range)
        maxRow = Math.max(maxRow, range.bottom)
        maxCol = Math.max(maxCol, range.right)
      }
    }

    // 每 sheet 自定义默认行高/列宽(sheetFormatPr);属性缺失时 ExcelJS 可能给 0,回退全局默认
    const sheetProps = worksheet.properties
    const defaultRowHeightPx = sheetProps?.defaultRowHeight
      ? ptToPx(sheetProps.defaultRowHeight)
      : DEFAULT_ROW_HEIGHT_PX
    const defaultColWidthPx = sheetProps?.defaultColWidth
      ? charWidthToPx(sheetProps.defaultColWidth)
      : DEFAULT_COL_WIDTH_PX

    // 行高列宽(稀疏)
    const rowHeightsPx: Record<number, number> = {}
    const colWidthsPx: Record<number, number> = {}
    const worksheetModel = worksheet.model as ExcelJS.WorksheetModel & WorksheetModelWithLayout

    for (const row of (worksheet as unknown as WorksheetWithInternalRows)._rows ?? []) {
      if (!row) continue
      if (row.hidden) {
        rowHeightsPx[row.number] = 0
      } else if (row.height !== undefined) {
        rowHeightsPx[row.number] = ptToPx(row.height)
      }
    }

    for (const colModel of worksheetModel.cols ?? []) {
      const min = colModel.min ?? 0
      const max = colModel.max ?? min
      for (let c = min; c <= max; c++) {
        if (colModel.hidden) {
          colWidthsPx[c] = 0
        } else if (colModel.width !== undefined) {
          colWidthsPx[c] = charWidthToPx(colModel.width)
        }
      }
    }

    // 浮动图片
    const floatingImages: FloatingObjectModel[] = []
    const colX = (col: number): number => {
      let x = 0
      for (let c = 1; c < col; c++) {
        x += colWidthsPx[c] ?? defaultColWidthPx
      }
      return x
    }
    const rowY = (row: number): number => {
      let y = 0
      for (let r = 1; r < row; r++) {
        y += rowHeightsPx[r] ?? defaultRowHeightPx
      }
      return y
    }

    for (const img of worksheet.getImages()) {
      const excelImageId = Number(img.imageId)
      let renderImageId = imageIdCache.get(excelImageId)
      if (renderImageId === undefined) {
        const stored = workbook.getImage(excelImageId)
        if (stored?.buffer) {
          const nodeBuffer = stored.buffer as unknown as Uint8Array
          const copy = new ArrayBuffer(nodeBuffer.byteLength)
          new Uint8Array(copy).set(nodeBuffer)
          renderImageId = nextImageId++
          images[renderImageId] = { mime: `image/${stored.extension}`, data: copy }
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
        // ExcelJS 已把 ext 的 EMU 换算成 px(ExtXform.parseOpen),直接使用
        width = ext.width
        height = ext.height
      } else {
        warnings.add('image-anchor-missing-extent')
        continue
      }

      floatingImages.push({ rect: { x, y, width, height }, imageId: renderImageId })
      maxRow = Math.max(maxRow, Math.ceil(tl.nativeRow + 1))
      maxCol = Math.max(maxCol, Math.ceil(tl.nativeCol + 1))
    }

    // frozen panes
    const view = worksheet.views?.[0]
    const frozen = view && view.state === 'frozen' ? { xSplit: view.xSplit ?? 0, ySplit: view.ySplit ?? 0 } : undefined

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
      charts: [],
      ...(frozen ? { frozen } : {})
    })
  }

  // 公式求值第二遍
  if (pendingFormulas.length > 0) {
    // 前向引用(公式引用文件顺序靠后的公式单元格)必须递归求值,而不是读第一遍
    // 留在 rawValueTable 里的 null 占位——求值器自带 memo 与环检测,可安全重入。
    const pendingByKey = new Map<string, PendingFormulaCell>()
    for (const pending of pendingFormulas) {
      pendingByKey.set(`${pending.sheetName}!${pending.row}:${pending.col}`, pending)
    }

    // eslint-disable-next-line prefer-const -- 与 evalContext 闭包互相引用,先声明后赋值
    let evaluator: ReturnType<typeof createFormulaEvaluator>
    const evalContext: EvalContext = {
      getCellValue(ref: FormulaCellRef) {
        const refKey = `${ref.sheet}!${ref.row}:${ref.col}`
        const pending = pendingByKey.get(refKey)
        if (pending) {
          // memo 保证已算过的 O(1) 返回;环/失败由求值器判定为 unevaluated → null
          const outcome = evaluator.evaluate(pending.formula, { sheet: ref.sheet, row: ref.row, col: ref.col })
          if (outcome.state === 'evaluated') {
            const value = outcome.value ?? null
            rawValueTable.set(refKey, value)
            return value
          }
          return null
        }
        return rawValueTable.get(refKey) ?? null
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
        rawValueTable.set(`${pending.sheetName}!${pending.row}:${pending.col}`, value)
      } else {
        warnings.add('formula-unevaluated')
      }
    }
  }

  // 图表(需要在公式求值之后,以便引用回填用求值后的单元格值)
  for (const worksheet of workbook.worksheets) {
    const sheetModel = sheets.find((s) => s.name === worksheet.name)
    if (!sheetModel) continue

    const layout: SheetLayoutAccessor = {
      colX(col: number) {
        let x = 0
        for (let c = 1; c < col; c++) {
          x += sheetModel.colWidthsPx[c] ?? sheetModel.defaultColWidthPx
        }
        return x
      },
      rowY(row: number) {
        let y = 0
        for (let r = 1; r < row; r++) {
          y += sheetModel.rowHeightsPx[r] ?? sheetModel.defaultRowHeightPx
        }
        return y
      }
    }

    const dataAccessor: SheetDataAccessor = {
      readRange(ref: string): (string | number | null)[][] | null {
        const parsed = parseA1Range(ref)
        if (!parsed) return null
        const refSheet = parsed.sheet ?? worksheet.name
        const result: (string | number | null)[][] = []
        for (let r = parsed.top; r <= parsed.bottom; r++) {
          const rowValues: (string | number | null)[] = []
          for (let c = parsed.left; c <= parsed.right; c++) {
            const raw = rawValueTable.get(`${refSheet}!${r}:${c}`)
            rowValues.push(typeof raw === 'boolean' ? (raw ? 1 : 0) : (raw ?? null))
          }
          result.push(rowValues)
        }
        return result
      }
    }

    try {
      const { charts, warnings: chartWarnings } = await parseCharts(zip, worksheet.name, layout, dataAccessor)
      sheetModel.charts = charts
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
