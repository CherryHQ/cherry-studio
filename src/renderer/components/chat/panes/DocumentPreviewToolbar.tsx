import { Button, Tooltip } from '@cherrystudio/ui'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw'
import ZoomIn from 'lucide-react/dist/esm/icons/zoom-in'
import ZoomOut from 'lucide-react/dist/esm/icons/zoom-out'
import { useTranslation } from 'react-i18next'

interface DocumentPreviewToolbarProps {
  currentPage: number
  pageCount: number
  zoomLabel: string
  pageIndicatorTestId?: string
  zoomIndicatorTestId?: string
  canPreviousPage: boolean
  canNextPage: boolean
  canZoomOut?: boolean
  canZoomIn?: boolean
  onPreviousPage: () => void
  onNextPage: () => void
  onZoomOut: () => void
  onZoomIn: () => void
  onResetZoom: () => void
}

const DocumentPreviewToolbar = ({
  currentPage,
  pageCount,
  zoomLabel,
  pageIndicatorTestId,
  zoomIndicatorTestId,
  canPreviousPage,
  canNextPage,
  canZoomOut = true,
  canZoomIn = true,
  onPreviousPage,
  onNextPage,
  onZoomOut,
  onZoomIn,
  onResetZoom
}: DocumentPreviewToolbarProps) => {
  const { t } = useTranslation()

  return (
    <div
      className="absolute top-2 right-3 z-10 flex items-center gap-1 rounded-lg border border-border-subtle bg-popover p-1 text-popover-foreground shadow-md"
      role="toolbar"
      aria-label={t('agent.preview_pane.preview')}>
      <Tooltip content={t('common.previous')} delay={800}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          aria-label={t('common.previous')}
          disabled={!canPreviousPage}
          onClick={onPreviousPage}>
          <ChevronLeft size={14} />
        </Button>
      </Tooltip>
      <span
        className="min-w-12 px-1 text-center text-muted-foreground text-xs tabular-nums"
        data-testid={pageIndicatorTestId}>
        {currentPage} / {pageCount}
      </span>
      <Tooltip content={t('common.next')} delay={800}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          aria-label={t('common.next')}
          disabled={!canNextPage}
          onClick={onNextPage}>
          <ChevronRight size={14} />
        </Button>
      </Tooltip>
      <span className="mx-1 h-4 w-px bg-border-subtle" />
      <Tooltip content={t('preview.zoom_out')} delay={800}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          aria-label={t('preview.zoom_out')}
          disabled={!canZoomOut}
          onClick={onZoomOut}>
          <ZoomOut size={14} />
        </Button>
      </Tooltip>
      <span
        className="min-w-10 px-1 text-center text-muted-foreground text-xs tabular-nums"
        data-testid={zoomIndicatorTestId}>
        {zoomLabel}
      </span>
      <Tooltip content={t('preview.zoom_in')} delay={800}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          aria-label={t('preview.zoom_in')}
          disabled={!canZoomIn}
          onClick={onZoomIn}>
          <ZoomIn size={14} />
        </Button>
      </Tooltip>
      <Tooltip content={t('preview.reset')} delay={800}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          aria-label={t('preview.reset')}
          onClick={onResetZoom}>
          <RotateCcw size={14} />
        </Button>
      </Tooltip>
    </div>
  )
}

export default DocumentPreviewToolbar
