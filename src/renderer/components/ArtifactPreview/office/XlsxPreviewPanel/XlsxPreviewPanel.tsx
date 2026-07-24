import { Tabs, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { EmptyState, LoadingState } from '@renderer/components/chat/primitives'
import { formatFileSize } from '@renderer/utils/file'
import { AlertCircle, FileSpreadsheet } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ZoomControls } from '../../DocumentPreviewToolbar'
import type { ChartRenderer } from './charts/ChartRenderer'
import type { ChartModel, SheetRenderModel, WorkbookRenderModel } from './renderModel'
import { useXlsxWorkbook, XLSX_PREVIEW_MAX_SIZE_BYTES } from './useXlsxWorkbook'
import type { SelectedCellInfo } from './XlsxGrid'
import XlsxGrid from './XlsxGrid'

const logger = loggerService.withContext('XlsxPreviewPanel')

interface XlsxPreviewPanelProps {
  filePath: string
  fileName: string
  refreshKey: number
  sourceSize?: number
  actions?: ReactNode
}

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
    .catch((err: unknown) => {
      chartRendererPromise = null
      throw err
    })
  return chartRendererPromise
}

const sheetHasChart = (sheet: SheetRenderModel | undefined): boolean => Boolean(sheet && sheet.charts.length > 0)

/**
 * Read-only xlsx preview panel: XlsxGrid plus a bottom bar for sheet tabs, selected-cell formula, and zoom.
 * State handling, themed background, and lazy loading follow PdfPreviewPanel.
 */
const XlsxPreviewPanel = ({ filePath, fileName, refreshKey, sourceSize, actions }: XlsxPreviewPanelProps) => {
  const { t } = useTranslation()
  const state = useXlsxWorkbook(filePath, refreshKey, sourceSize)
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const [activeSheetName, setActiveSheetName] = useState<string | null>(null)
  const [selectedCell, setSelectedCell] = useState<SelectedCellInfo | null>(null)
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
      .catch((err: unknown) => {
        if (cancelled) return
        const normalized = err instanceof Error ? err : new Error(String(err))
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

  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <LoadingState label={t('common.loading')} />
      </div>
    )
  }

  if (state.status === 'error') {
    // state.message carries the raw technical detail (hardcoded English from the worker/parse path); it is logged at
    // the failure site in useXlsxWorkbook. Show a translated, generic description instead of the internal string.
    return (
      <EmptyState
        icon={AlertCircle}
        title={t('common.error')}
        description={t('xlsx_preview.error.description')}
        actions={actions}
      />
    )
  }

  if (state.status === 'oversize') {
    return (
      <EmptyState
        icon={FileSpreadsheet}
        title={t('xlsx_preview.too_large.title')}
        description={t('xlsx_preview.too_large.description', {
          size: formatFileSize(state.sizeBytes),
          limit: formatFileSize(XLSX_PREVIEW_MAX_SIZE_BYTES)
        })}
        actions={actions}
      />
    )
  }

  if (!model || !activeSheet) return null

  // Selected cell status: address plus content. Formula cells show the raw formula; values stay in the grid.
  const selectedCellContent = selectedCell?.cell?.formula ? `= ${selectedCell.cell.formula}` : selectedCell?.cell?.text
  const statusBarText = selectedCell
    ? selectedCellContent
      ? `${selectedCell.address}  ${selectedCellContent}`
      : selectedCell.address
    : null

  return (
    <div
      data-testid="xlsx-preview-panel"
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
          onSelectCell={setSelectedCell}
          renderChart={renderChart}
        />
      </div>

      {/* Bottom bar: sheet tabs on the left, selected-cell info on the right, and zoom controls at the far right. */}
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

        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 text-foreground-muted text-xs">
          {statusBarText && (
            <span className="selectable cursor-text select-text truncate" data-testid="xlsx-preview-status-bar">
              {statusBarText}
            </span>
          )}
          {selectedCell?.cell?.formulaState === 'unevaluated' && (
            <span className="shrink-0 italic">{t('xlsx_preview.formula_not_evaluated')}</span>
          )}
        </div>

        <div className="flex shrink-0 items-center" role="toolbar" aria-label={t('agent.preview_pane.preview')}>
          <ZoomControls
            zoomLabel={formatZoomLabel(zoom)}
            zoomIndicatorTestId="xlsx-preview-zoom-value"
            canZoomOut={zoomIndex > 0}
            canZoomIn={zoomIndex >= 0 && zoomIndex < ZOOM_LEVELS.length - 1}
            onZoomOut={zoomOut}
            onZoomIn={zoomIn}
          />
        </div>
      </div>
    </div>
  )
}

export default XlsxPreviewPanel
