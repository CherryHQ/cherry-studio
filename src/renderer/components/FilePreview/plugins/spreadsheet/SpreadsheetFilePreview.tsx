import { EmptyState, Tabs, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { SELECTION_EXCERPT_MAX_LENGTH } from '@renderer/types/selectionReference'
import { formatFileSize } from '@renderer/utils/file'
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle'
import FileSpreadsheet from 'lucide-react/dist/esm/icons/file-spreadsheet'
import LoaderCircle from 'lucide-react/dist/esm/icons/loader-circle'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FilePreviewLayout } from '../../FilePreviewLayout'
import { createSelectionReference } from '../../selectionReference'
import type { FilePreviewPluginProps } from '../../types'
import type { ChartRenderer } from './charts/ChartRenderer'
import type { CellRangeRect } from './gridLayout'
import type { ChartModel, MergeRange, SheetRenderModel, WorkbookRenderModel } from './renderModel'
import { SpreadsheetFilePreviewToolbar } from './SpreadsheetFilePreviewToolbar'
import { useXlsxWorkbook, XLSX_PREVIEW_MAX_SIZE_BYTES } from './useXlsxWorkbook'
import type { SelectedCellInfo } from './XlsxGrid'
import XlsxGrid from './XlsxGrid'

const logger = loggerService.withContext('SpreadsheetFilePreview')

/** Zoom levels. The default index is 2 (=1). */
const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2]
const DEFAULT_ZOOM = 1

const formatZoomLabel = (zoom: number) => `${Math.round(zoom * 100)}%`

/** Visible sheets from model.sheets. If all are hidden, fall back to the first sheet so one tab remains selectable. */
const visibleSheets = (model: WorkbookRenderModel): SheetRenderModel[] => {
  const visible = model.sheets.filter((sheet) => !sheet.hidden)
  if (visible.length > 0) return visible
  return model.sheets.slice(0, 1)
}

let chartRendererPromise: Promise<ChartRenderer> | null = null

const loadChartRenderer = () => {
  chartRendererPromise ??= import('./charts/EchartsChartRenderer')
    .then((module) => module.echartsChartRenderer)
    .catch((error: unknown) => {
      chartRendererPromise = null
      throw error
    })
  return chartRendererPromise
}

const sheetHasChart = (sheet: SheetRenderModel | undefined): boolean => Boolean(sheet && sheet.charts.length > 0)

/**
 * Hard cap on cells visited while building a selection excerpt. sheet.cells is sparse but the rect is not, so a
 * whole-column selection would otherwise walk millions of empty coordinates on the main thread.
 */
const EXCERPT_MAX_SCAN_CELLS = 50_000

/**
 * Plain-text snapshot of a selected range: tab-separated cells, newline-separated rows.
 * Both budgets are checked while scanning — building the full text first and truncating afterwards is what makes a
 * full-column selection hang. createSelectionReference does the exact normalization and truncation.
 *
 * Only text that survives normalization counts against the character budget: separators around blank cells collapse
 * away, so charging for them would let a run of empty cells exhaust the budget and normalize down to an empty
 * excerpt. The scan cap stays separate — it is what bounds the walk over a sparse selection.
 *
 * ExcelJS reports a merged range's value through every cell it covers, so each range is emitted once, at its master.
 * Merges are swept row by row rather than searched per cell, keeping the walk linear in the scan cap.
 */
const buildRangeExcerpt = (sheet: SheetRenderModel, rect: CellRangeRect): string => {
  const intersecting = sheet.merges
    .filter((m) => m.top <= rect.bottom && m.bottom >= rect.top && m.left <= rect.right && m.right >= rect.left)
    .sort((a, b) => a.top - b.top)

  const lines: string[] = []
  let length = 0
  let scanned = 0
  let nextMerge = 0
  let active: MergeRange[] = []

  for (let row = rect.top; row <= rect.bottom; row++) {
    while (nextMerge < intersecting.length && intersecting[nextMerge].top <= row) active.push(intersecting[nextMerge++])
    if (active.length > 0) active = active.filter((merge) => merge.bottom >= row)

    const values: string[] = []
    for (let col = rect.left; col <= rect.right; col++) {
      if (scanned >= EXCERPT_MAX_SCAN_CELLS || length >= SELECTION_EXCERPT_MAX_LENGTH) break
      scanned++
      const covering = active.find((merge) => merge.left <= col && merge.right >= col)
      const isMergeFollower = covering !== undefined && (covering.top !== row || covering.left !== col)
      const text = isMergeFollower ? '' : (sheet.cells[`${row}:${col}`]?.text ?? '')
      values.push(text)
      if (text.length > 0) length += text.length + 1
    }
    lines.push(values.join('\t'))
    if (scanned >= EXCERPT_MAX_SCAN_CELLS || length >= SELECTION_EXCERPT_MAX_LENGTH) break
  }
  return lines.join('\n')
}

/** Read-only XLSX preview with virtualized sheets, formula status, images, and lazily loaded charts. */
export default function SpreadsheetFilePreview({
  filePath,
  fileName,
  metadata,
  refreshKey,
  onSelectionReference
}: FilePreviewPluginProps) {
  const { t } = useTranslation()
  const state = useXlsxWorkbook(filePath, refreshKey, metadata.size)
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const [activeSheetName, setActiveSheetName] = useState<string | null>(null)
  // The sheet is stored with the selection: an A1 range means nothing without the sheet it was taken from.
  const [selectedCell, setSelectedCell] = useState<(SelectedCellInfo & { sheet: SheetRenderModel }) | null>(null)
  const [chartRenderer, setChartRenderer] = useState<ChartRenderer | null>(null)
  const [imageUrls, setImageUrls] = useState<Record<number, string>>({})

  const model = state.status === 'ready' ? state.model : null
  const sheets = useMemo(() => (model ? visibleSheets(model) : []), [model])
  const activeSheet = sheets.find((sheet) => sheet.name === activeSheetName) ?? sheets[0] ?? null

  // Reset the selected cell when switching sheets or replacing the model, and clamp the active sheet to a valid value.
  useEffect(() => {
    setSelectedCell(null)
    if (sheets.length === 0) {
      setActiveSheetName(null)
      return
    }
    if (!sheets.some((sheet) => sheet.name === activeSheetName)) {
      setActiveSheetName(sheets[0].name)
    }
  }, [sheets, activeSheetName])

  const handleSelectCell = useCallback(
    (info: SelectedCellInfo | null) => setSelectedCell(info && activeSheet ? { ...info, sheet: activeSheet } : null),
    [activeSheet]
  )

  // The reference is derived from the selection rather than emitted by the selection callback, so clearing the
  // selection — including the sheet switch and model replacement handled above — reports null on its own. The
  // sheet is compared rather than assumed: the switch resets the selection in an effect, one commit later.
  const selectionReference = useMemo(() => {
    if (!selectedCell || !activeSheet || selectedCell.sheet !== activeSheet) return null
    return createSelectionReference({
      filePath,
      anchor: { format: 'xlsx', sheet: activeSheet.name, range: selectedCell.range },
      excerpt: buildRangeExcerpt(activeSheet, selectedCell.rect),
      metadata: { size: metadata.size, modifiedAt: metadata.modifiedAt }
    })
  }, [selectedCell, activeSheet, filePath, metadata.size, metadata.modifiedAt])

  useEffect(() => {
    onSelectionReference?.(selectionReference)
  }, [selectionReference, onSelectionReference])

  // Build image object URLs from model.images when ready, then revoke the previous table on replacement/unmount.
  useEffect(() => {
    if (!model) return

    const nextUrls: Record<number, string> = {}
    for (const [imageId, image] of Object.entries(model.images)) {
      nextUrls[Number(imageId)] = URL.createObjectURL(new Blob([image.data], { type: image.mime }))
    }
    setImageUrls(nextUrls)

    return () => {
      for (const url of Object.values(nextUrls)) {
        URL.revokeObjectURL(url)
      }
    }
  }, [model])

  // Lazy-load chart rendering only after the first model containing charts appears.
  useEffect(() => {
    if (chartRenderer || !sheets.some((sheet) => sheetHasChart(sheet))) return
    let cancelled = false
    void loadChartRenderer()
      .then((renderer) => {
        if (!cancelled) setChartRenderer(renderer)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const normalized = error instanceof Error ? error : new Error(String(error))
        logger.error('Failed to load xlsx chart renderer', normalized)
      })
    return () => {
      cancelled = true
    }
  }, [sheets, chartRenderer])

  const renderChart = useMemo(() => {
    if (!chartRenderer) return undefined
    return (chart: ChartModel, container: HTMLElement) => chartRenderer.render(chart, container)
  }, [chartRenderer])

  const zoomIndex = ZOOM_LEVELS.indexOf(zoom)
  const zoomOut = useCallback(() => {
    setZoom((current) => {
      const index = ZOOM_LEVELS.indexOf(current)
      return index > 0 ? ZOOM_LEVELS[index - 1] : current
    })
  }, [])
  const zoomIn = useCallback(() => {
    setZoom((current) => {
      const index = ZOOM_LEVELS.indexOf(current)
      return index >= 0 && index < ZOOM_LEVELS.length - 1 ? ZOOM_LEVELS[index + 1] : current
    })
  }, [])

  let content: ReactNode

  if (state.status === 'loading' || state.status === 'idle') {
    content = (
      <div
        role="status"
        className="flex h-full w-full items-center justify-center gap-2 bg-background text-muted-foreground text-sm">
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
        <span>{t('file_preview.loading')}</span>
      </div>
    )
  } else if (state.status === 'error') {
    // state.message carries raw technical detail from the worker and is logged by useXlsxWorkbook.
    content = (
      <EmptyState
        icon={AlertCircle}
        title={t('file_preview.load_error.title')}
        description={t('xlsx_preview.error.description')}
        className="h-full"
      />
    )
  } else if (state.status === 'oversize') {
    content = (
      <EmptyState
        icon={FileSpreadsheet}
        title={t('xlsx_preview.too_large.title')}
        description={t('xlsx_preview.too_large.description', {
          size: formatFileSize(state.sizeBytes),
          limit: formatFileSize(XLSX_PREVIEW_MAX_SIZE_BYTES)
        })}
        className="h-full"
      />
    )
  } else if (!model || !activeSheet) {
    content = null
  } else {
    // Selection status: the A1 range, plus the cell content when the selection is a single cell (formula cells show
    // the raw formula). A multi-cell range reports no cell, so only the range is shown.
    // The sheet is compared for the same reason selectionReference compares it: the effect that clears
    // selectedCell on a sheet switch runs one commit later, so the new sheet's tabs would otherwise render
    // beside the previous sheet's range for a frame.
    const cellOnActiveSheet = selectedCell && selectedCell.sheet === activeSheet ? selectedCell : null
    const selectedCellContent = cellOnActiveSheet?.cell?.formula
      ? `= ${cellOnActiveSheet.cell.formula}`
      : cellOnActiveSheet?.cell?.text
    const statusBarText = cellOnActiveSheet
      ? selectedCellContent
        ? `${cellOnActiveSheet.range}  ${selectedCellContent}`
        : cellOnActiveSheet.range
      : null

    content = (
      <div
        data-testid="spreadsheet-file-preview"
        role="region"
        aria-label={fileName}
        className="relative flex h-full w-full flex-col overflow-hidden bg-background">
        <div className="min-h-0 flex-1">
          <XlsxGrid
            // Remount the grid on sheet changes to reset its internal selection state.
            key={activeSheet.name}
            sheet={activeSheet}
            styles={model.styles}
            imageUrls={imageUrls}
            zoom={zoom}
            onSelectCell={handleSelectCell}
            renderChart={renderChart}
          />
        </div>

        <div className="flex shrink-0 items-center gap-2 border-border-subtle border-t bg-background px-2 py-1">
          <Tabs value={activeSheet.name} onValueChange={setActiveSheetName} variant="line" className="min-w-0 shrink">
            <TabsList aria-label={t('xlsx_preview.sheet_tabs_label')} className="min-w-0 gap-1 overflow-x-auto">
              {sheets.map((sheet) => (
                <TabsTrigger key={sheet.name} value={sheet.name} className="shrink-0 px-2 py-1 text-xs">
                  {sheet.name}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 text-muted-foreground text-xs">
            {statusBarText ? (
              <span className="selectable cursor-text select-text truncate" data-testid="xlsx-preview-status-bar">
                {statusBarText}
              </span>
            ) : null}
            {cellOnActiveSheet?.cell?.formulaState === 'unevaluated' ? (
              <span className="shrink-0 italic">{t('xlsx_preview.formula_not_evaluated')}</span>
            ) : null}
          </div>

          <SpreadsheetFilePreviewToolbar
            zoomLabel={formatZoomLabel(zoom)}
            canZoomOut={zoomIndex > 0}
            canZoomIn={zoomIndex >= 0 && zoomIndex < ZOOM_LEVELS.length - 1}
            onZoomOut={zoomOut}
            onZoomIn={zoomIn}
          />
        </div>

        <div aria-hidden className="hidden h-24 shrink-0 [[data-shell-maximized-overlay]_&]:block" />
      </div>
    )
  }

  return (
    <FilePreviewLayout.Frame>
      <FilePreviewLayout.Content>{content}</FilePreviewLayout.Content>
    </FilePreviewLayout.Frame>
  )
}
