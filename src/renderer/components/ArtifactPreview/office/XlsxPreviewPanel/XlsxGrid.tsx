import { cn } from '@cherrystudio/ui/lib/utils'
import { useVirtualizer } from '@tanstack/react-virtual'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type AxisLayout,
  axisOffset,
  buildAxisLayout,
  cellAddress,
  colName,
  DEFAULT_FONT_SIZE_PX,
  mergeRectPx,
  mergesInView,
  type PxRectLike,
  type ViewportRect,
  WRAP_LINE_HEIGHT,
  wrapClampLines
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
  /** 1 = 100%。缩放实现:布局/字号恒为 zoom=1,内容整体 CSS transform scale(照片式放大,元素不重排) */
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
/** 选中格弹层的内容最大宽度(px,zoom=1),超出按此宽度换行 */
const SELECTED_OVERLAY_MAX_WIDTH_PX = 480

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

/** CellStyle → inline style(zoom=1 坐标系,不含定位/尺寸,由调用方叠加)。v1 简化:文本溢出一律 overflow hidden(wrap 除外),不做 Excel 的相邻空单元格溢出流。 */
const cellStyleToCss = (style: CellStyle | undefined): React.CSSProperties => {
  const css: React.CSSProperties = { fontSize: style?.fontSizePx ?? DEFAULT_FONT_SIZE_PX }
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
  if (style.indent) css.paddingLeft = style.indent * 8
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
  /** 首行/首列补画 top/left 网格线,避免相邻格重叠加粗(见 05 文档) */
  isFirstRow: boolean
  isFirstCol: boolean
  /** 定位/尺寸(zoom=1 px);拆成基本类型传入,使 memo 浅比较在位置不变时能跳过重渲染 */
  top: number
  left: number
  width: number
  height: number
}

/** 单元格文本 span 的 inline style:超链接着色 + wrap 格按整行裁剪(避免半行乱码) */
const cellTextStyle = (cell: CellRenderModel, clampLines: number | undefined): React.CSSProperties | undefined => {
  if (!cell.hyperlink && !clampLines) return undefined
  return {
    ...(cell.hyperlink ? { color: 'var(--color-primary)', textDecoration: 'underline' } : undefined),
    ...(clampLines
      ? {
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical' as const,
          WebkitLineClamp: clampLines,
          overflow: 'hidden',
          lineHeight: WRAP_LINE_HEIGHT
        }
      : undefined)
  }
}

/** 普通/合并单元格共用的渲染体。合并覆盖但非 master 的单元格由调用方传入 cell=undefined 只保留背景。 */
const CellView = memo(function CellView({
  cell,
  style,
  isFirstRow,
  isFirstCol,
  top,
  left,
  width,
  height
}: CellViewProps) {
  const css = cellStyleToCss(style)
  const hAlign = style?.hAlign ?? (cell ? defaultHAlign(cell) : 'left')
  // wrap 格:格高放不下全部换行内容时只显示放得下的整行(默认行高即一行),完整内容由选中弹层展示
  const clampLines = style?.wrap ? wrapClampLines(height, css.fontSize as number) : undefined

  const finalCss: React.CSSProperties = {
    position: 'absolute',
    top,
    left,
    width,
    height,
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
    <div className="absolute px-1 text-foreground text-sm" style={finalCss}>
      {cell && (
        <span
          className={cn(cell.formulaState === 'unevaluated' && 'text-foreground-muted italic')}
          style={cellTextStyle(cell, clampLines)}>
          {cell.text}
        </span>
      )}
    </div>
  )
})

interface SelectedCellOverlayProps {
  cell: CellRenderModel | undefined
  style: CellStyle | undefined
  /** 被选中单元格(或其合并区)的像素矩形,zoom=1 坐标,相对网格原点 */
  rect: PxRectLike
}

/**
 * 选中格弹层:在原格位置覆盖展示完整内容(被格高/格宽裁剪的文本全部可见),
 * 绝对定位浮于网格之上,只遮挡不挤压——网格布局不因选中而变化。
 */
const SelectedCellOverlay = ({ cell, style, rect }: SelectedCellOverlayProps) => {
  const css = cellStyleToCss(style)
  const hAlign = style?.hAlign ?? (cell ? defaultHAlign(cell) : 'left')

  const finalCss: React.CSSProperties = {
    ...css,
    position: 'absolute',
    top: rect.y,
    left: rect.x,
    minWidth: rect.width,
    minHeight: rect.height,
    maxWidth: SELECTED_OVERLAY_MAX_WIDTH_PX,
    width: 'max-content',
    display: 'flex',
    justifyContent: css.justifyContent ?? H_ALIGN_TO_JUSTIFY[hAlign],
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    lineHeight: WRAP_LINE_HEIGHT,
    boxSizing: 'border-box',
    backgroundColor: css.backgroundColor ?? 'var(--color-background)'
  }

  return (
    <div
      data-testid="xlsx-grid-selected-overlay"
      className="z-10 px-1 text-foreground text-sm shadow-md outline outline-primary"
      style={finalCss}>
      {cell && (
        <span
          className={cn(cell.formulaState === 'unevaluated' && 'text-foreground-muted italic')}
          style={cellTextStyle(cell, undefined)}>
          {cell.text}
        </span>
      )}
    </div>
  )
}

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

  // 布局恒为 zoom=1;缩放由内容层整体 transform scale 完成(照片式放大,元素不重排)
  const rowLayout: AxisLayout = useMemo(
    () => buildAxisLayout(rowCount, sheet.defaultRowHeightPx, sheet.rowHeightsPx, 1),
    [rowCount, sheet.defaultRowHeightPx, sheet.rowHeightsPx]
  )
  const colLayout: AxisLayout = useMemo(
    () => buildAxisLayout(colCount, sheet.defaultColWidthPx, sheet.colWidthsPx, 1),
    [colCount, sheet.defaultColWidthPx, sheet.colWidthsPx]
  )

  // 滚动坐标系(× zoom)中的表头尺寸;transform 层内部一律用 zoom=1 坐标
  const scaledHeaderWidth = ROW_HEADER_WIDTH_PX * zoom
  const scaledHeaderHeight = COL_HEADER_HEIGHT_PX * zoom
  const zoomTransform: React.CSSProperties = { transform: `scale(${zoom})`, transformOrigin: 'top left' }

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollElRef.current,
    // 虚拟化在滚动坐标系工作,尺寸 × zoom;渲染坐标由 rowLayout/colLayout(zoom=1)提供
    estimateSize: (index) => rowLayout.sizes[index] * zoom,
    overscan: OVERSCAN
  })
  const colVirtualizer = useVirtualizer({
    horizontal: true,
    count: colCount,
    getScrollElement: () => scrollElRef.current,
    estimateSize: (index) => colLayout.sizes[index] * zoom,
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

  // 合并层可视计算在 zoom=1 坐标系进行:滚动视口先除以 zoom 折算回内容坐标
  const contentViewport = useMemo<ViewportRect>(
    () => ({
      top: viewport.top / zoom,
      left: viewport.left / zoom,
      bottom: viewport.bottom / zoom,
      right: viewport.right / zoom
    }),
    [viewport, zoom]
  )
  const mergesVisible = useMemo(
    () => mergesInView(sheet.merges, contentViewport, rowLayout, colLayout),
    [sheet.merges, contentViewport, rowLayout, colLayout]
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

  // 选中格(或其合并区)的像素矩形,供弹层定位;selected 恒为 master(见 selectCell)
  const selectedRect = useMemo(() => {
    if (!selected) return null
    const merge = findMerge(selected.row, selected.col)
    if (merge) return mergeRectPx(merge, rowLayout, colLayout)
    return {
      x: axisOffset(colLayout, selected.col - 1),
      y: axisOffset(rowLayout, selected.row - 1),
      width: colLayout.sizes[selected.col - 1] ?? 0,
      height: rowLayout.sizes[selected.row - 1] ?? 0
    }
  }, [selected, findMerge, rowLayout, colLayout])

  const totalWidth = colLayout.totalSize * zoom + scaledHeaderWidth
  const totalHeight = rowLayout.totalSize * zoom + scaledHeaderHeight

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
        {/* 列表头(sticky top):A B C…。盒子在滚动坐标系定位,内容整体缩放 */}
        <div
          className="sticky top-0 z-20 border-border border-b bg-muted"
          style={{ height: scaledHeaderHeight, marginLeft: scaledHeaderWidth, width: colLayout.totalSize * zoom }}>
          <div className="absolute" style={zoomTransform}>
            {virtualCols.map((vc) => (
              <div
                key={vc.key}
                className="absolute flex items-center justify-center border-border border-r text-foreground-muted text-xs"
                style={{
                  left: axisOffset(colLayout, vc.index),
                  width: colLayout.sizes[vc.index],
                  height: COL_HEADER_HEIGHT_PX
                }}>
                {colName(vc.index + 1)}
              </div>
            ))}
          </div>
        </div>

        {/* 行表头(sticky left):1 2 3… */}
        <div
          className="sticky left-0 z-20 border-border border-r bg-muted"
          style={{ width: scaledHeaderWidth, height: rowLayout.totalSize * zoom, top: scaledHeaderHeight }}>
          <div className="absolute" style={zoomTransform}>
            {virtualRows.map((vr) => (
              <div
                key={vr.key}
                className="absolute flex items-center justify-center border-border border-b text-foreground-muted text-xs"
                style={{
                  top: axisOffset(rowLayout, vr.index),
                  height: rowLayout.sizes[vr.index],
                  width: ROW_HEADER_WIDTH_PX
                }}>
                {vr.index + 1}
              </div>
            ))}
          </div>
        </div>

        {/* 内容缩放层:单元格/合并/浮动/选中弹层全部以 zoom=1 坐标渲染,整体 transform 放大 */}
        <div
          className="absolute"
          data-testid="xlsx-grid-zoom-layer"
          style={{ top: scaledHeaderHeight, left: scaledHeaderWidth, ...zoomTransform }}>
          {/* 单元格层:双向虚拟滚动。任何被合并覆盖的单元格(含 master)在此层置空内容——
              master 的内容+样式由下方独立的合并层渲染,避免重复;这里只保留背景占位。 */}
          <div className="absolute">
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
                      isFirstRow={row === 1}
                      isFirstCol={col === 1}
                      top={axisOffset(rowLayout, vr.index)}
                      left={axisOffset(colLayout, vc.index)}
                      width={colLayout.sizes[vc.index]}
                      height={rowLayout.sizes[vr.index]}
                    />
                  </div>
                )
              })
            )}
          </div>

          {/* 合并层:独立于单元格虚拟化,master 滚出视口但合并区与视口相交时依然渲染;命中测试优先于单元格层(DOM 顺序在后) */}
          <div className="absolute">
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
                    isFirstRow={masterRow === 1}
                    isFirstCol={masterCol === 1}
                    top={rect.y}
                    left={rect.x}
                    width={rect.width}
                    height={rect.height}
                  />
                </div>
              )
            })}
          </div>

          {/* 浮动层:图片 + 图表,按 PxRect(zoom=1)绝对定位;视觉缩放由外层 transform 完成,
              图表容器 layout 尺寸不随 zoom 变化,ECharts 不会因缩放而重排 */}
          <div className="pointer-events-none absolute">
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
                    top: img.rect.y,
                    left: img.rect.x,
                    width: img.rect.width,
                    height: img.rect.height
                  }}
                />
              )
            })}
            {sheet.charts.map((chart, i) => {
              const positionStyle: React.CSSProperties = {
                top: chart.rect.y,
                left: chart.rect.x,
                width: chart.rect.width,
                height: chart.rect.height
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

          {/* 选中格弹层:覆盖展示完整内容,DOM 序在最后、z-10 低于 sticky 表头(z-20) */}
          {selected && selectedRect && (
            <SelectedCellOverlay
              cell={getCell(selected.row, selected.col)}
              style={getStyle(getCell(selected.row, selected.col))}
              rect={selectedRect}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default memo(XlsxGrid)
