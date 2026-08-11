import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw'
import ZoomIn from 'lucide-react/dist/esm/icons/zoom-in'
import ZoomOut from 'lucide-react/dist/esm/icons/zoom-out'
import { useTranslation } from 'react-i18next'

import { FilePreviewToolbar } from '../../FilePreviewToolbar'
import { FilePreviewToolbarButton } from '../../FilePreviewToolbarButton'

interface PowerPointFilePreviewToolbarProps {
  canNextPage: boolean
  canPreviousPage: boolean
  canResetZoom: boolean
  canZoomIn: boolean
  canZoomOut: boolean
  currentPage: number
  onNextPage: () => void
  onPreviousPage: () => void
  onResetZoom: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  pageCount: number
  zoomLabel: string
}

export function PowerPointFilePreviewToolbar({
  canNextPage,
  canPreviousPage,
  canResetZoom,
  canZoomIn,
  canZoomOut,
  currentPage,
  onNextPage,
  onPreviousPage,
  onResetZoom,
  onZoomIn,
  onZoomOut,
  pageCount,
  zoomLabel
}: PowerPointFilePreviewToolbarProps) {
  const { t } = useTranslation()

  return (
    <FilePreviewToolbar aria-label={t('preview.label')}>
      <FilePreviewToolbarButton label={t('common.previous')} disabled={!canPreviousPage} onClick={onPreviousPage}>
        <ChevronLeft aria-hidden />
      </FilePreviewToolbarButton>
      <span
        aria-live="polite"
        className="min-w-14 px-1 text-center text-muted-foreground text-xs tabular-nums"
        data-testid="pptx-preview-page-indicator">
        {currentPage} / {pageCount}
      </span>
      <FilePreviewToolbarButton label={t('common.next')} disabled={!canNextPage} onClick={onNextPage}>
        <ChevronRight aria-hidden />
      </FilePreviewToolbarButton>
      <span className="mx-1 h-4 w-px bg-border-subtle" aria-hidden />
      <FilePreviewToolbarButton label={t('preview.zoom_out')} disabled={!canZoomOut} onClick={onZoomOut}>
        <ZoomOut aria-hidden />
      </FilePreviewToolbarButton>
      <span
        className="min-w-12 px-1 text-center text-muted-foreground text-xs tabular-nums"
        data-testid="pptx-preview-zoom-value">
        {zoomLabel}
      </span>
      <FilePreviewToolbarButton label={t('preview.zoom_in')} disabled={!canZoomIn} onClick={onZoomIn}>
        <ZoomIn aria-hidden />
      </FilePreviewToolbarButton>
      <FilePreviewToolbarButton label={t('preview.reset')} disabled={!canResetZoom} onClick={onResetZoom}>
        <RotateCcw aria-hidden />
      </FilePreviewToolbarButton>
    </FilePreviewToolbar>
  )
}
