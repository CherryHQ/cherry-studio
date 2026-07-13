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
  /** Address in 'B4' format. */
  address: string
  cell: CellRenderModel | null
}

export interface XlsxGridProps {
  sheet: SheetRenderModel
  styles: CellStyle[]
  /** imageId -> object URL. The panel owns creation and revocation. */
  imageUrls: Record<number, string>
  /** 1 = 100%. Layout and font sizes stay at zoom=1; the content layer is scaled with CSS transform. */
  zoom: number
  onSelectCell?: (info: SelectedCellInfo | null) => void
  /** Chart rendering hook. Returns a cleanup function; the panel passes in a ChartRenderer implementation. */
  renderChart?: (chart: ChartModel, container: HTMLElement) => () => void
}

/** Baseline row/column header sizes in px at zoom=1. */
const ROW_HEADER_WIDTH_PX = 44
const COL_HEADER_HEIGHT_PX = 22
/** Extra items rendered outside the virtualized viewport. */
const OVERSCAN = 6
/** Blank rows/columns beyond the used range. Fill the viewport first, then leave a small scrollable blank area. */
const EXTRA_ROWS = 20
const EXTRA_COLS = 5
/** Default grid line when no cell border is set. Follows the DESIGN.md border token. */
const DEFAULT_GRID_LINE = '0.5px solid var(--color-border)'
/** Maximum selected-cell overlay content width in px at zoom=1. Wider content wraps at this width. */
const SELECTED_OVERLAY_MAX_WIDTH_PX = 480

/** Default cell alignment when CellStyle.hAlign is unset: numbers right, booleans/errors center, others left. */
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

/** CellStyle -> inline style in the zoom=1 coordinate space. Positioning and sizing are added by callers. */
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
  /** Covered merge placeholders must not paint default grid lines beneath the transparent merged-cell layer. */
  covered?: boolean
  /** Draw top/left grid lines for the first row/column to avoid doubled borders between adjacent cells. */
  isFirstRow: boolean
  isFirstCol: boolean
  /** Position and size in zoom=1 px. Primitive props let memo skip rerenders when the box is unchanged. */
  top: number
  left: number
  width: number
  height: number
}

/** Inline style for the cell text span: hyperlink coloring and whole-line clipping for wrapped cells. */
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

/** Shared renderer for regular and merged cells. Covered non-master cells pass cell=undefined and keep only background. */
const CellView = memo(function CellView({
  cell,
  style,
  covered = false,
  isFirstRow,
  isFirstCol,
  top,
  left,
  width,
  height
}: CellViewProps) {
  const css = cellStyleToCss(style)
  const hAlign = style?.hAlign ?? (cell ? defaultHAlign(cell) : 'left')
  // Wrapped cells show only complete lines that fit in the row height. The overlay shows the full content when selected.
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
    borderRight: covered ? undefined : (css.borderRight ?? DEFAULT_GRID_LINE),
    borderBottom: covered ? undefined : (css.borderBottom ?? DEFAULT_GRID_LINE),
    borderTop: covered ? undefined : isFirstRow ? (css.borderTop ?? DEFAULT_GRID_LINE) : css.borderTop,
    borderLeft: covered ? undefined : isFirstCol ? (css.borderLeft ?? DEFAULT_GRID_LINE) : css.borderLeft
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
  /** Pixel rect for the selected cell or merged range in zoom=1 coordinates, relative to the grid origin. */
  rect: PxRectLike
}

/**
 * Selected-cell overlay. It renders full clipped content over the original cell without changing grid layout.
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

/** Placeholder for unsupported charts: dashed border, centered label, and raw type name. */
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

/** Chart mount host. The ref callback owns the disposer returned by renderChart and calls it on unmount/replacement. */
const ChartHost = ({ chart, renderChart }: ChartHostProps) => {
  const { t } = useTranslation()
  const disposeRef = useRef<(() => void) | null>(null)
  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      disposeRef.current?.()
      disposeRef.current = node ? renderChart(chart, node) : null
    },
    [chart, renderChart]
  )

  return <div ref={setRef} className="h-full w-full" role="img" aria-label={chart.title || t('xlsx_preview.chart')} />
}

const XlsxGrid = ({ sheet, styles, imageUrls, zoom, onSelectCell, renderChart }: XlsxGridProps) => {
  const scrollElRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null)
  const [viewport, setViewport] = useState<ViewportRect>({ top: 0, left: 0, bottom: 0, right: 0 })

  // Displayed rows/columns are the larger of the used range and the default-sized cells needed to fill the viewport.
  const viewportHeight = viewport.bottom - viewport.top
  const viewportWidth = viewport.right - viewport.left
  const rowCount = Math.max(sheet.rowCount, Math.ceil(viewportHeight / (sheet.defaultRowHeightPx * zoom))) + EXTRA_ROWS
  const colCount = Math.max(sheet.colCount, Math.ceil(viewportWidth / (sheet.defaultColWidthPx * zoom))) + EXTRA_COLS

  // Layout always uses zoom=1; scaling is applied to the whole content layer so elements do not reflow.
  const rowLayout: AxisLayout = useMemo(
    () => buildAxisLayout(rowCount, sheet.defaultRowHeightPx, sheet.rowHeightsPx, 1),
    [rowCount, sheet.defaultRowHeightPx, sheet.rowHeightsPx]
  )
  const colLayout: AxisLayout = useMemo(
    () => buildAxisLayout(colCount, sheet.defaultColWidthPx, sheet.colWidthsPx, 1),
    [colCount, sheet.defaultColWidthPx, sheet.colWidthsPx]
  )

  // Header sizes in the scroll coordinate space. Everything inside the transformed layer uses zoom=1 coordinates.
  const scaledHeaderWidth = ROW_HEADER_WIDTH_PX * zoom
  const scaledHeaderHeight = COL_HEADER_HEIGHT_PX * zoom
  const zoomTransform: React.CSSProperties = { transform: `scale(${zoom})`, transformOrigin: 'top left' }

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollElRef.current,
    // Virtualization works in scroll coordinates, with sizes multiplied by zoom. Render coordinates come from layouts.
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
  const virtualRows = rowVirtualizer.getVirtualItems()
  const virtualCols = colVirtualizer.getVirtualItems()

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

  // Panel resizes do not emit scroll events, so ResizeObserver remeasures the viewport.
  useEffect(() => {
    const el = scrollElRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setViewport(readViewport(el)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [readViewport])

  // Merge visibility is computed at zoom=1 by converting the scroll viewport back to content coordinates.
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

  // Index only the virtualized viewport intersection. Expanding every merge across the full sheet could itself be
  // unbounded, while this map stays O(visible cells) and makes the render loop's lookup O(1).
  const mergeKeyStride = colCount + 1
  const visibleMergeByCell = useMemo(() => {
    const index = new Map<number, SheetRenderModel['merges'][number]>()
    const firstRow = (virtualRows[0]?.index ?? 0) + 1
    const lastRow = (virtualRows[virtualRows.length - 1]?.index ?? -1) + 1
    const firstCol = (virtualCols[0]?.index ?? 0) + 1
    const lastCol = (virtualCols[virtualCols.length - 1]?.index ?? -1) + 1
    if (lastRow < firstRow || lastCol < firstCol) return index

    for (const { merge } of mergesVisible) {
      const top = Math.max(merge.top, firstRow)
      const bottom = Math.min(merge.bottom, lastRow)
      const left = Math.max(merge.left, firstCol)
      const right = Math.min(merge.right, lastCol)
      for (let row = top; row <= bottom; row++) {
        const rowKey = row * mergeKeyStride
        for (let col = left; col <= right; col++) {
          index.set(rowKey + col, merge)
        }
      }
    }
    return index
  }, [mergeKeyStride, mergesVisible, virtualCols, virtualRows])

  const getCell = useCallback((row: number, col: number) => sheet.cells[`${row}:${col}`], [sheet.cells])
  const getStyle = useCallback(
    (cell: CellRenderModel | undefined) => (cell?.styleId !== undefined ? styles[cell.styleId] : undefined),
    [styles]
  )

  /** Returns the merged range containing (row, col), if any. */
  const findMerge = useCallback(
    (row: number, col: number) => {
      const visible = visibleMergeByCell.get(row * mergeKeyStride + col)
      if (visible) return visible
      // Non-render interactions may target a cell just outside the current virtual window. This path runs only on
      // keyboard/selection events, not per rendered cell, and merge parsing is capped upstream.
      return sheet.merges.find(
        (merge) => row >= merge.top && row <= merge.bottom && col >= merge.left && col <= merge.right
      )
    },
    [mergeKeyStride, sheet.merges, visibleMergeByCell]
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

  // Keyboard navigation may target an unmounted virtualized cell, so scroll to it after moving.
  const moveSelection = useCallback(
    (dRow: number, dCol: number) => {
      // With no current selection, the first arrow key lands on A1 instead of advancing from A1.
      if (!selected) {
        selectCell(1, 1)
        rowVirtualizer.scrollToIndex(0)
        colVirtualizer.scrollToIndex(0)
        return
      }
      // When starting from a merged range, jump past the whole range in the travel direction to avoid looping on master.
      const merge = findMerge(selected.row, selected.col)
      let nextRow = selected.row
      let nextCol = selected.col
      if (dRow > 0) nextRow = (merge?.bottom ?? selected.row) + 1
      else if (dRow < 0) nextRow = selected.row - 1
      if (dCol > 0) nextCol = (merge?.right ?? selected.col) + 1
      else if (dCol < 0) nextCol = selected.col - 1
      nextRow = Math.min(Math.max(nextRow, 1), rowCount)
      nextCol = Math.min(Math.max(nextCol, 1), colCount)
      selectCell(nextRow, nextCol)
      rowVirtualizer.scrollToIndex(nextRow - 1)
      colVirtualizer.scrollToIndex(nextCol - 1)
    },
    [selected, findMerge, rowCount, colCount, selectCell, rowVirtualizer, colVirtualizer]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      switch (e.key) {
        case 'Escape':
          clearSelection()
          return
        case 'ArrowUp':
          e.preventDefault()
          moveSelection(-1, 0)
          return
        case 'ArrowDown':
          e.preventDefault()
          moveSelection(1, 0)
          return
        case 'ArrowLeft':
          e.preventDefault()
          moveSelection(0, -1)
          return
        case 'ArrowRight':
          e.preventDefault()
          moveSelection(0, 1)
          return
        case 'Enter':
        case ' ': {
          e.preventDefault()
          const target = selected ?? { row: 1, col: 1 }
          selectCell(target.row, target.col)
          rowVirtualizer.scrollToIndex(target.row - 1)
          colVirtualizer.scrollToIndex(target.col - 1)
          return
        }
      }
    },
    [clearSelection, moveSelection, selected, selectCell, rowVirtualizer, colVirtualizer]
  )

  // Pixel rect for the selected cell or merged range. selected always points to the master cell; see selectCell.
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

  return (
    <div
      ref={scrollElCallback}
      data-testid="xlsx-grid-scroll"
      className="relative h-full w-full overflow-auto bg-background"
      onScroll={handleScroll}
      onKeyDown={handleKeyDown}
      role="grid"
      aria-label={sheet.name}
      aria-readonly
      aria-rowcount={rowCount}
      aria-colcount={colCount}
      tabIndex={0}>
      <div className="relative" style={{ width: totalWidth, height: totalHeight }}>
        {/* Column header (sticky top): A, B, C... The box is positioned in scroll coordinates; content is scaled. */}
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

        {/* Row header (sticky left): 1, 2, 3... */}
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

        {/* Content scale layer: cells, merges, floating objects, and the selection overlay all render at zoom=1. */}
        <div
          className="absolute"
          data-testid="xlsx-grid-zoom-layer"
          style={{ top: scaledHeaderHeight, left: scaledHeaderWidth, ...zoomTransform }}>
          {/* Cell layer with two-axis virtualization. Cells inside a merge render empty here — the merge layer below
              paints the visual — but the master keeps the semantic gridcell, with span metadata and an aria-label
              carrying the cell text so the merge is exposed as one spanning cell in its real row. */}
          <div className="absolute">
            {virtualRows.map((vr) => {
              const row = vr.index + 1
              return (
                <div key={vr.key} role="row" aria-rowindex={row}>
                  {virtualCols.map((vc) => {
                    const col = vc.index + 1
                    const merge = visibleMergeByCell.get(row * mergeKeyStride + col)
                    const isMaster = merge !== undefined && merge.top === row && merge.left === col
                    const isCovered = merge !== undefined && !isMaster
                    const cell = merge ? undefined : getCell(row, col)
                    const style = merge ? undefined : getStyle(cell)
                    const isSelected = !isCovered && selected?.row === row && selected?.col === col
                    return (
                      <div
                        key={vc.key}
                        onClick={() => selectCell(row, col)}
                        role={isCovered ? undefined : 'gridcell'}
                        aria-hidden={isCovered || undefined}
                        aria-colindex={isCovered ? undefined : col}
                        aria-selected={isCovered ? undefined : isSelected}
                        aria-colspan={isMaster ? merge.right - merge.left + 1 : undefined}
                        aria-rowspan={isMaster ? merge.bottom - merge.top + 1 : undefined}
                        aria-label={isMaster ? getCell(row, col)?.text || undefined : undefined}>
                        <CellView
                          cell={cell}
                          style={style}
                          covered={isCovered}
                          isFirstRow={row === 1}
                          isFirstCol={col === 1}
                          top={axisOffset(rowLayout, vr.index)}
                          left={axisOffset(colLayout, vc.index)}
                          width={colLayout.sizes[vc.index]}
                          height={rowLayout.sizes[vr.index]}
                        />
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>

          {/* Merge layer independent of cell virtualization. Merges render while their rect intersects the viewport.
              Presentation-only (aria-hidden): the semantic gridcell for a merge is the master cell in the row layer. */}
          <div className="absolute">
            {mergesVisible.map(({ merge, masterRow, masterCol, rect }) => {
              const cell = getCell(masterRow, masterCol)
              const style = getStyle(cell)
              return (
                <div
                  key={`merge:${merge.top}:${merge.left}:${merge.bottom}:${merge.right}`}
                  aria-hidden
                  onClick={() => selectCell(masterRow, masterCol)}>
                  <div data-testid="xlsx-grid-merge-cell">
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
                </div>
              )
            })}
          </div>

          {/* Floating layer: images and charts are absolutely positioned in zoom=1 PxRect coordinates. */}
          <div className="pointer-events-none absolute">
            {sheet.floatingImages.map((img, i) => {
              const src = imageUrls[img.imageId]
              if (!src) return null
              return (
                <img
                  // imageId is deduplicated across anchors (one workbook image reused at multiple placements), so the
                  // list index disambiguates repeated placements that would otherwise share a React key.
                  key={`img:${img.imageId}:${i}`}
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

          {/* Selected-cell overlay. It is last in DOM order and stays below the sticky headers. */}
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
