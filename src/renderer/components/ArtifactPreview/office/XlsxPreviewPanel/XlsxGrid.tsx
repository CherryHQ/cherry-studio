import { cn } from '@cherrystudio/ui/lib/utils'
import { useVirtualizer } from '@tanstack/react-virtual'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type AxisLayout,
  buildAxisLayout,
  cellAddress,
  colName,
  mergesInView,
  scaledFontSizePx,
  type ViewportRect
} from './gridLayout'
import type { BorderEdge, CellRenderModel, CellStyle, ChartModel, SheetRenderModel } from './renderModel'

export interface SelectedCellInfo {
  /** 'B4' 风格地址 */
  address: string
  cell: CellRenderModel | null
}

export interface XlsxGridProps {
  sheet: SheetRenderModel
  styles: CellStyle[]
  /** imageId → object URL;生命周期由面板管理(创建/revoke) */
  imageUrls: Record<number, string>
  /** 1 = 100%。缩放实现:布局尺寸乘系数(含字号),不用 CSS transform */
  zoom: number
  onSelectCell?: (info: SelectedCellInfo | null) => void
  /** 图表渲染注入点;返回清理函数。面板传入 ChartRenderer 实现 */
  renderChart?: (chart: ChartModel, container: HTMLElement) => () => void
}

/** 行/列表头基准尺寸(px,zoom=1) */
const ROW_HEADER_WIDTH_PX = 44
const COL_HEADER_HEIGHT_PX = 22
/** 虚拟滚动的可视区外预渲染项数 */
const OVERSCAN = 6
/** 使用范围之外额外渲染的空白行/列:网格先铺满视口,再留一段可滚动的空白区(对齐 Excel) */
const EXTRA_ROWS = 20
const EXTRA_COLS = 5
/** 默认(未设置边框时)网格线,跟随 DESIGN.md 的边框语义 token */
const DEFAULT_GRID_LINE = '0.5px solid var(--color-border)'

/** 单元格内容默认对齐:数字右对齐,布尔/错误居中,其余左对齐(CellStyle.hAlign 未设置时的规则) */
const defaultHAlign = (cell: CellRenderModel): 'left' | 'center' | 'right' => {
  if (typeof cell.raw === 'number') return 'right'
  if (typeof cell.raw === 'boolean') return 'center'
  return 'left'
}

const BORDER_STYLE_CSS: Record<BorderEdge['style'], string> = {
  thin: 'solid',
  medium: 'solid',
  thick: 'solid',
  dashed: 'dashed',
  dotted: 'dotted',
  hair: 'dotted',
  double: 'double'
}
const BORDER_WIDTH_PX: Record<BorderEdge['style'], number> = {
  thin: 1,
  hair: 1,
  dashed: 1,
  dotted: 1,
  medium: 1.5,
  thick: 2,
  double: 3
}

const borderEdgeToCss = (edge: BorderEdge | undefined): string | undefined =>
  edge ? `${BORDER_WIDTH_PX[edge.style]}px ${BORDER_STYLE_CSS[edge.style]} ${edge.color}` : undefined

const H_ALIGN_TO_JUSTIFY: Record<NonNullable<CellStyle['hAlign']>, React.CSSProperties['justifyContent']> = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
  justify: 'stretch'
}
const V_ALIGN_TO_ITEMS: Record<NonNullable<CellStyle['vAlign']>, React.CSSProperties['alignItems']> = {
  top: 'flex-start',
  middle: 'center',
  bottom: 'flex-end'
}

/** CellStyle → inline style(不含定位/尺寸,由调用方叠加)。v1 简化:文本溢出一律 overflow hidden(wrap 除外),不做 Excel 的相邻空单元格溢出流。 */
const cellStyleToCss = (style: CellStyle | undefined, zoom: number): React.CSSProperties => {
  const css: React.CSSProperties = { fontSize: scaledFontSizePx(style?.fontSizePx, zoom) }
  if (!style) return css
  if (style.fontFamily) css.fontFamily = style.fontFamily
  if (style.bold) css.fontWeight = 'bold'
  if (style.italic) css.fontStyle = 'italic'
  if (style.underline && style.strike) css.textDecoration = 'underline line-through'
  else if (style.underline) css.textDecoration = 'underline'
  else if (style.strike) css.textDecoration = 'line-through'
  if (style.color) css.color = style.color
  if (style.bg) css.backgroundColor = style.bg
  if (style.hAlign) css.justifyContent = H_ALIGN_TO_JUSTIFY[style.hAlign]
  if (style.vAlign) css.alignItems = V_ALIGN_TO_ITEMS[style.vAlign]
  if (style.wrap) {
    css.whiteSpace = 'normal'
    css.wordBreak = 'break-word'
  }
  if (style.indent) css.paddingLeft = style.indent * 8 * zoom
  const borderRight = borderEdgeToCss(style.borderRight)
  const borderBottom = borderEdgeToCss(style.borderBottom)
  const borderTop = borderEdgeToCss(style.borderTop)
  const borderLeft = borderEdgeToCss(style.borderLeft)
  if (borderRight) css.borderRight = borderRight
  if (borderBottom) css.borderBottom = borderBottom
  if (borderTop) css.borderTop = borderTop
  if (borderLeft) css.borderLeft = borderLeft
  return css
}

interface CellViewProps {
  cell: CellRenderModel | undefined
  style: CellStyle | undefined
  zoom: number
  /** 首行/首列补画 top/left 网格线,避免相邻格重叠加粗(见 05 文档) */
  isFirstRow: boolean
  isFirstCol: boolean
  selected: boolean
  positionStyle: React.CSSProperties
}

/** 普通/合并单元格共用的渲染体。合并覆盖但非 master 的单元格由调用方传入 cell=undefined 只保留背景。 */
const CellView = memo(function CellView({
  cell,
  style,
  zoom,
  isFirstRow,
  isFirstCol,
  selected,
  positionStyle
}: CellViewProps) {
  const css = cellStyleToCss(style, zoom)
  const hAlign = style?.hAlign ?? (cell ? defaultHAlign(cell) : 'left')

  const finalCss: React.CSSProperties = {
    ...positionStyle,
    ...css,
    display: 'flex',
    justifyContent: css.justifyContent ?? H_ALIGN_TO_JUSTIFY[hAlign],
    overflow: 'hidden',
    whiteSpace: css.whiteSpace ?? 'nowrap',
    boxSizing: 'border-box',
    borderRight: css.borderRight ?? DEFAULT_GRID_LINE,
    borderBottom: css.borderBottom ?? DEFAULT_GRID_LINE,
    borderTop: isFirstRow ? (css.borderTop ?? DEFAULT_GRID_LINE) : css.borderTop,
    borderLeft: isFirstCol ? (css.borderLeft ?? DEFAULT_GRID_LINE) : css.borderLeft
  }

  return (
    <div
      className={cn('absolute px-1 text-foreground text-sm', selected && 'z-10 outline outline-primary')}
      style={finalCss}>
      {cell && (
        <span
          className={cn(cell.formulaState === 'unevaluated' && 'text-foreground-muted italic')}
          style={cell.hyperlink ? { color: 'var(--color-primary)', textDecoration: 'underline' } : undefined}>
          {cell.text}
        </span>
      )}
    </div>
  )
})

interface UnsupportedChartPlaceholderProps {
  chart: ChartModel
}

/** unsupported 图表占位框:虚线边框 + 居中文案 + 原始类型名 */
const UnsupportedChartPlaceholder = ({ chart }: UnsupportedChartPlaceholderProps) => {
  const { t } = useTranslation()
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-md border border-border border-dashed text-center text-foreground-muted text-xs">
      <span>{t('xlsx_preview.chart_unsupported')}</span>
      {chart.rawTypeName && <span>{chart.rawTypeName}</span>}
    </div>
  )
}

interface ChartHostProps {
  chart: ChartModel
  renderChart: (chart: ChartModel, container: HTMLElement) => () => void
}

/** 图表挂载宿主:ref 回调管理 renderChart 返回的 dispose,节点卸载/替换时调用。 */
const ChartHost = ({ chart, renderChart }: ChartHostProps) => {
  const disposeRef = useRef<(() => void) | null>(null)
  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      disposeRef.current?.()
      disposeRef.current = node ? renderChart(chart, node) : null
    },
    [chart, renderChart]
  )

  return <div ref={setRef} className="h-full w-full" />
}

const XlsxGrid = ({ sheet, styles, imageUrls, zoom, onSelectCell, renderChart }: XlsxGridProps) => {
  const scrollElRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null)
  const [viewport, setViewport] = useState<ViewportRect>({ top: 0, left: 0, bottom: 0, right: 0 })

  // 展示行/列数:使用范围与"铺满视口所需的默认尺寸格数"取大,再加一段空白缓冲
  const viewportHeight = viewport.bottom - viewport.top
  const viewportWidth = viewport.right - viewport.left
  const rowCount = Math.max(sheet.rowCount, Math.ceil(viewportHeight / (sheet.defaultRowHeightPx * zoom))) + EXTRA_ROWS
  const colCount = Math.max(sheet.colCount, Math.ceil(viewportWidth / (sheet.defaultColWidthPx * zoom))) + EXTRA_COLS

  const rowLayout: AxisLayout = useMemo(
    () => buildAxisLayout(rowCount, sheet.defaultRowHeightPx, sheet.rowHeightsPx, zoom),
    [rowCount, sheet.defaultRowHeightPx, sheet.rowHeightsPx, zoom]
  )
  const colLayout: AxisLayout = useMemo(
    () => buildAxisLayout(colCount, sheet.defaultColWidthPx, sheet.colWidthsPx, zoom),
    [colCount, sheet.defaultColWidthPx, sheet.colWidthsPx, zoom]
  )

  const rowHeaderWidth = ROW_HEADER_WIDTH_PX * zoom
  const colHeaderHeight = COL_HEADER_HEIGHT_PX * zoom

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollElRef.current,
    estimateSize: (index) => rowLayout.sizes[index],
    overscan: OVERSCAN
  })
  const colVirtualizer = useVirtualizer({
    horizontal: true,
    count: colCount,
    getScrollElement: () => scrollElRef.current,
    estimateSize: (index) => colLayout.sizes[index],
    overscan: OVERSCAN
  })

  const readViewport = useCallback(
    (el: HTMLDivElement): ViewportRect => ({
      top: el.scrollTop,
      left: el.scrollLeft,
      bottom: el.scrollTop + el.clientHeight,
      right: el.scrollLeft + el.clientWidth
    }),
    []
  )

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => setViewport(readViewport(e.currentTarget)),
    [readViewport]
  )

  const scrollElCallback = useCallback(
    (node: HTMLDivElement | null) => {
      scrollElRef.current = node
      if (node) setViewport(readViewport(node))
    },
    [readViewport]
  )

  // 面板尺寸变化不触发 scroll 事件,需 ResizeObserver 重新量测视口(空白区铺满 + 合并层可视计算都依赖它)
  useEffect(() => {
    const el = scrollElRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setViewport(readViewport(el)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [readViewport])

  const mergesVisible = useMemo(
    () => mergesInView(sheet.merges, viewport, rowLayout, colLayout),
    [sheet.merges, viewport, rowLayout, colLayout]
  )

  const getCell = useCallback((row: number, col: number) => sheet.cells[`${row}:${col}`], [sheet.cells])
  const getStyle = useCallback(
    (cell: CellRenderModel | undefined) => (cell?.styleId !== undefined ? styles[cell.styleId] : undefined),
    [styles]
  )

  /** 命中(row,col)所在的合并区,若有 */
  const findMerge = useCallback(
    (row: number, col: number) =>
      sheet.merges.find((m) => row >= m.top && row <= m.bottom && col >= m.left && col <= m.right),
    [sheet.merges]
  )

  const selectCell = useCallback(
    (row: number, col: number) => {
      const merge = findMerge(row, col)
      const masterRow = merge?.top ?? row
      const masterCol = merge?.left ?? col
      setSelected({ row: masterRow, col: masterCol })
      onSelectCell?.({ address: cellAddress(masterRow, masterCol), cell: getCell(masterRow, masterCol) ?? null })
    },
    [findMerge, getCell, onSelectCell]
  )

  const clearSelection = useCallback(() => {
    setSelected(null)
    onSelectCell?.(null)
  }, [onSelectCell])

  const totalWidth = colLayout.totalSize + rowHeaderWidth
  const totalHeight = rowLayout.totalSize + colHeaderHeight

  const virtualRows = rowVirtualizer.getVirtualItems()
  const virtualCols = colVirtualizer.getVirtualItems()

  return (
    <div
      ref={scrollElCallback}
      data-testid="xlsx-grid-scroll"
      className="relative h-full w-full overflow-auto bg-background"
      onScroll={handleScroll}
      onKeyDown={(e) => {
        if (e.key === 'Escape') clearSelection()
      }}
      tabIndex={0}>
      <div className="relative" style={{ width: totalWidth, height: totalHeight }}>
        {/* 列表头(sticky top):A B C… */}
        <div
          className="sticky top-0 z-20 border-border border-b bg-muted"
          style={{ height: colHeaderHeight, marginLeft: rowHeaderWidth, width: colLayout.totalSize }}>
          {virtualCols.map((vc) => (
            <div
              key={vc.key}
              className="absolute flex items-center justify-center border-border border-r text-foreground-muted text-xs"
              style={{ left: vc.start, width: vc.size, height: colHeaderHeight }}>
              {colName(vc.index + 1)}
            </div>
          ))}
        </div>

        {/* 行表头(sticky left):1 2 3… */}
        <div
          className="sticky left-0 z-20 border-border border-r bg-muted"
          style={{ width: rowHeaderWidth, height: rowLayout.totalSize, top: colHeaderHeight }}>
          {virtualRows.map((vr) => (
            <div
              key={vr.key}
              className="absolute flex items-center justify-center border-border border-b text-foreground-muted text-xs"
              style={{ top: vr.start, height: vr.size, width: rowHeaderWidth }}>
              {vr.index + 1}
            </div>
          ))}
        </div>

        {/* 单元格层:双向虚拟滚动。任何被合并覆盖的单元格(含 master)在此层置空内容——
            master 的内容+样式由下方独立的合并层渲染,避免重复;这里只保留背景占位。 */}
        <div className="absolute" style={{ top: colHeaderHeight, left: rowHeaderWidth }}>
          {virtualRows.map((vr) =>
            virtualCols.map((vc) => {
              const row = vr.index + 1
              const col = vc.index + 1
              const isCovered = Boolean(findMerge(row, col))
              const cell = isCovered ? undefined : getCell(row, col)
              const style = isCovered ? undefined : getStyle(cell)
              const isSelected = !isCovered && selected?.row === row && selected?.col === col
              return (
                <div
                  key={`${vr.key}:${vc.key}`}
                  onClick={() => selectCell(row, col)}
                  role="gridcell"
                  aria-selected={isSelected}>
                  <CellView
                    cell={cell}
                    style={style}
                    zoom={zoom}
                    isFirstRow={row === 1}
                    isFirstCol={col === 1}
                    selected={isSelected}
                    positionStyle={{
                      position: 'absolute',
                      top: vr.start,
                      left: vc.start,
                      width: vc.size,
                      height: vr.size
                    }}
                  />
                </div>
              )
            })
          )}
        </div>

        {/* 合并层:独立于单元格虚拟化,master 滚出视口但合并区与视口相交时依然渲染;命中测试优先于单元格层(DOM 顺序在后) */}
        <div className="absolute" style={{ top: colHeaderHeight, left: rowHeaderWidth }}>
          {mergesVisible.map(({ merge, masterRow, masterCol, rect }) => {
            const cell = getCell(masterRow, masterCol)
            const style = getStyle(cell)
            const isSelected = selected?.row === masterRow && selected?.col === masterCol
            return (
              <div
                key={`merge:${merge.top}:${merge.left}:${merge.bottom}:${merge.right}`}
                onClick={() => selectCell(masterRow, masterCol)}
                role="gridcell"
                aria-selected={isSelected}
                data-testid="xlsx-grid-merge-cell">
                <CellView
                  cell={cell}
                  style={style}
                  zoom={zoom}
                  isFirstRow={masterRow === 1}
                  isFirstCol={masterCol === 1}
                  selected={isSelected}
                  positionStyle={{
                    position: 'absolute',
                    top: rect.y,
                    left: rect.x,
                    width: rect.width,
                    height: rect.height
                  }}
                />
              </div>
            )
          })}
        </div>

        {/* 浮动层:图片 + 图表,按 PxRect * zoom 绝对定位 */}
        <div className="pointer-events-none absolute" style={{ top: colHeaderHeight, left: rowHeaderWidth }}>
          {sheet.floatingImages.map((img) => {
            const src = imageUrls[img.imageId]
            if (!src) return null
            return (
              <img
                key={`img:${img.imageId}`}
                src={src}
                alt=""
                data-testid="xlsx-grid-floating-image"
                className="pointer-events-auto absolute object-contain"
                style={{
                  top: img.rect.y * zoom,
                  left: img.rect.x * zoom,
                  width: img.rect.width * zoom,
                  height: img.rect.height * zoom
                }}
              />
            )
          })}
          {sheet.charts.map((chart, i) => {
            const positionStyle: React.CSSProperties = {
              top: chart.rect.y * zoom,
              left: chart.rect.x * zoom,
              width: chart.rect.width * zoom,
              height: chart.rect.height * zoom
            }
            return (
              <div
                key={`chart:${i}`}
                className="pointer-events-auto absolute"
                style={positionStyle}
                data-testid="xlsx-grid-chart">
                {chart.type === 'unsupported' || !renderChart ? (
                  <UnsupportedChartPlaceholder chart={chart} />
                ) : (
                  <ChartHost chart={chart} renderChart={renderChart} />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default memo(XlsxGrid)
