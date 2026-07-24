import { Button, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
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
  className?: string
  canPreviousPage: boolean
  canNextPage: boolean
  canZoomOut?: boolean
  canZoomIn?: boolean
  canResetZoom?: boolean
  onPreviousPage: () => void
  onNextPage: () => void
  onZoomOut: () => void
  onZoomIn: () => void
  onResetZoom: () => void
}

interface ZoomControlsProps {
  zoomLabel: string
  zoomIndicatorTestId?: string
  canZoomOut?: boolean
  canZoomIn?: boolean
  canResetZoom?: boolean
  onZoomOut: () => void
  onZoomIn: () => void
  onResetZoom?: () => void
}

/** Shared zoom cluster for document previews. The caller owns toolbar placement and page-specific controls. */
export const ZoomControls = ({
  zoomLabel,
  zoomIndicatorTestId,
  canZoomOut = true,
  canZoomIn = true,
  canResetZoom = true,
  onZoomOut,
  onZoomIn,
  onResetZoom
}: ZoomControlsProps) => {
  const { t } = useTranslation()

  return (
    <>
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
      {onResetZoom && (
        <Tooltip content={t('preview.reset')} delay={800}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            aria-label={t('preview.reset')}
            disabled={!canResetZoom}
            onClick={onResetZoom}>
            <RotateCcw size={14} />
          </Button>
        </Tooltip>
      )}
    </>
  )
}

const DocumentPreviewToolbar = ({
  currentPage,
  pageCount,
  zoomLabel,
  pageIndicatorTestId,
  zoomIndicatorTestId,
  className,
  canPreviousPage,
  canNextPage,
  canZoomOut = true,
  canZoomIn = true,
  canResetZoom = true,
  onPreviousPage,
  onNextPage,
  onZoomOut,
  onZoomIn,
  onResetZoom
}: DocumentPreviewToolbarProps) => {
  const { t } = useTranslation()

  return (
    <div
      className={cn(
        'absolute top-2 right-3 z-10 flex items-center gap-1 rounded-lg border border-border-subtle bg-popover p-1 text-popover-foreground shadow-md',
        className
      )}
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
      <ZoomControls
        zoomLabel={zoomLabel}
        zoomIndicatorTestId={zoomIndicatorTestId}
        canZoomOut={canZoomOut}
        canZoomIn={canZoomIn}
        canResetZoom={canResetZoom}
        onZoomOut={onZoomOut}
        onZoomIn={onZoomIn}
        onResetZoom={onResetZoom}
      />
    </div>
  )
}

export default DocumentPreviewToolbar
