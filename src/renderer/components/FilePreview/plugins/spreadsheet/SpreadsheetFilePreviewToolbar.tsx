import ZoomIn from 'lucide-react/dist/esm/icons/zoom-in'
import ZoomOut from 'lucide-react/dist/esm/icons/zoom-out'
import { useTranslation } from 'react-i18next'

import { FilePreviewToolbarButton } from '../../FilePreviewToolbarButton'

interface SpreadsheetFilePreviewToolbarProps {
  canZoomIn: boolean
  canZoomOut: boolean
  onZoomIn: () => void
  onZoomOut: () => void
  zoomLabel: string
}

export function SpreadsheetFilePreviewToolbar({
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  zoomLabel
}: SpreadsheetFilePreviewToolbarProps) {
  const { t } = useTranslation()

  return (
    <div role="toolbar" aria-label={t('preview.label')} className="flex shrink-0 items-center gap-1">
      <FilePreviewToolbarButton label={t('preview.zoom_out')} disabled={!canZoomOut} onClick={onZoomOut}>
        <ZoomOut aria-hidden />
      </FilePreviewToolbarButton>
      <span
        className="min-w-12 px-1 text-center text-muted-foreground text-xs tabular-nums"
        data-testid="xlsx-preview-zoom-value">
        {zoomLabel}
      </span>
      <FilePreviewToolbarButton label={t('preview.zoom_in')} disabled={!canZoomIn} onClick={onZoomIn}>
        <ZoomIn aria-hidden />
      </FilePreviewToolbarButton>
    </div>
  )
}
