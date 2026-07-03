import { Button, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { EmptyState, LoadingState } from '@renderer/components/chat'
import { AlertCircle, FileSpreadsheet, ZoomIn, ZoomOut } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ChartRenderer } from './charts/ChartRenderer'
import type { ChartModel, SheetRenderModel, WorkbookRenderModel } from './renderModel'
import { useXlsxWorkbook } from './useXlsxWorkbook'
import type { SelectedCellInfo } from './XlsxGrid'
import XlsxGrid from './XlsxGrid'

interface XlsxPreviewPanelProps {
  filePath: string
  fileName: string
  refreshKey: number
  sourceSize?: number
  actions?: ReactNode
}

/** 缩放档位,默认下标 2(=1) */
const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2]
const DEFAULT_ZOOM = 1

/** 与 ArtifactPane 的 2MB 文本预览上限文案保持同样"静态标签"风格,而非动态格式化 */
const XLSX_PREVIEW_MAX_SIZE_LABEL = '20 MB'

const formatZoomLabel = (zoom: number) => `${Math.round(zoom * 100)}%`

/** model.sheets 中可见的 sheet;全部 hidden 时退化显示第一个,保证至少有一个 tab 可选 */
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
 * xlsx 只读预览面板:XlsxGrid + 底部栏(sheet 标签 + 选中格公式 + 缩放,对齐 Excel 布局)。
 * 状态机/主题背景/懒加载接线对齐 PdfPreviewPanel。
 */
const XlsxPreviewPanel = ({ filePath, fileName, refreshKey, sourceSize, actions }: XlsxPreviewPanelProps) => {
  const { t } = useTranslation()
  const state = useXlsxWorkbook(filePath, refreshKey, sourceSize)
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const [activeSheetName, setActiveSheetName] = useState<string | null>(null)
  const [selectedCell, setSelectedCell] = useState<SelectedCellInfo | null>(null)
  const [chartRenderer, setChartRenderer] = useState<ChartRenderer | null>(null)
  const imageUrlsRef = useRef<Record<number, string>>({})
  const [imageUrls, setImageUrls] = useState<Record<number, string>>({})

  const model = state.status === 'ready' ? state.model : null
  const sheets = useMemo(() => (model ? visibleSheets(model) : []), [model])
  const activeSheet = sheets.find((sheet) => sheet.name === activeSheetName) ?? sheets[0] ?? null

  // sheet 切换/模型替换时重置选中单元格,并把当前 sheet 落到有效值上
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

  // 图片 object URL:ready 时按 model.images 建表,model 替换/卸载时 revoke 旧表
  useEffect(() => {
    if (!model) return

    const nextUrls: Record<number, string> = {}
    for (const [imageId, image] of Object.entries(model.images)) {
      nextUrls[Number(imageId)] = URL.createObjectURL(new Blob([image.data], { type: image.mime }))
    }
    imageUrlsRef.current = nextUrls
    setImageUrls(nextUrls)

    return () => {
      for (const url of Object.values(nextUrls)) {
        URL.revokeObjectURL(url)
      }
    }
  }, [model])

  // 图表懒加载:首个含图表的 model 出现才触发
  useEffect(() => {
    if (chartRenderer || !sheets.some((sheet) => sheetHasChart(sheet))) return
    let cancelled = false
    void loadChartRenderer().then((renderer) => {
      if (!cancelled) setChartRenderer(renderer)
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
    return <EmptyState icon={AlertCircle} title={t('common.error')} description={state.message} actions={actions} />
  }

  if (state.status === 'oversize') {
    return (
      <EmptyState
        icon={FileSpreadsheet}
        title={t('xlsx_preview.too_large.title')}
        description={t('xlsx_preview.too_large.description', { limit: XLSX_PREVIEW_MAX_SIZE_LABEL })}
        actions={actions}
      />
    )
  }

  if (!model || !activeSheet) return null

  // 选中格:地址 + 内容(公式格显示 `= 公式原文`,值在网格内);无选中不显示
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
          sheet={activeSheet}
          styles={model.styles}
          imageUrls={imageUrls}
          zoom={zoom}
          onSelectCell={setSelectedCell}
          renderChart={renderChart}
        />
      </div>

      {/* 底部栏(对齐 Excel):sheet 标签在左,选中格信息居右,缩放控件在最右 */}
      <div className="flex shrink-0 items-center gap-2 border-border-subtle border-t bg-background px-2 py-1">
        <div
          role="tablist"
          aria-label={t('xlsx_preview.sheet_tabs_label')}
          className="flex min-w-0 shrink gap-1 overflow-x-auto">
          {sheets.map((sheet) => (
            <button
              key={sheet.name}
              type="button"
              role="tab"
              aria-selected={sheet.name === activeSheet.name}
              className={cn(
                'shrink-0 whitespace-nowrap rounded px-2 py-1 text-xs',
                sheet.name === activeSheet.name
                  ? 'bg-accent font-medium text-foreground'
                  : 'text-foreground-muted hover:bg-accent hover:text-foreground'
              )}
              onClick={() => setActiveSheetName(sheet.name)}>
              {sheet.name}
            </button>
          ))}
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 text-foreground-muted text-xs">
          {statusBarText && (
            <span className="truncate" data-testid="xlsx-preview-status-bar">
              {statusBarText}
            </span>
          )}
          {selectedCell?.cell?.formulaState === 'unevaluated' && (
            <span className="shrink-0 italic">{t('xlsx_preview.formula_not_evaluated')}</span>
          )}
        </div>

        <div className="flex shrink-0 items-center" role="toolbar" aria-label={t('agent.preview_pane.preview')}>
          <Tooltip content={t('preview.zoom_out')} delay={800}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              aria-label={t('preview.zoom_out')}
              disabled={zoomIndex <= 0}
              onClick={zoomOut}>
              <ZoomOut size={14} />
            </Button>
          </Tooltip>
          <span
            className="min-w-10 px-1 text-center text-muted-foreground text-xs tabular-nums"
            data-testid="xlsx-preview-zoom-value">
            {formatZoomLabel(zoom)}
          </span>
          <Tooltip content={t('preview.zoom_in')} delay={800}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              aria-label={t('preview.zoom_in')}
              disabled={zoomIndex < 0 || zoomIndex >= ZOOM_LEVELS.length - 1}
              onClick={zoomIn}>
              <ZoomIn size={14} />
            </Button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

export default XlsxPreviewPanel
