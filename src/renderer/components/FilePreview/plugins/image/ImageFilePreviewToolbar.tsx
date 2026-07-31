import FlipHorizontal from 'lucide-react/dist/esm/icons/flip-horizontal'
import FlipVertical from 'lucide-react/dist/esm/icons/flip-vertical'
import RefreshCcw from 'lucide-react/dist/esm/icons/refresh-ccw'
import RotateCcwSquare from 'lucide-react/dist/esm/icons/rotate-ccw-square'
import RotateCwSquare from 'lucide-react/dist/esm/icons/rotate-cw-square'
import ZoomIn from 'lucide-react/dist/esm/icons/zoom-in'
import ZoomOut from 'lucide-react/dist/esm/icons/zoom-out'
import { useTranslation } from 'react-i18next'

import type { ImagePreviewTransformControls } from '@cherrystudio/ui'

import { FilePreviewToolbar } from '../../FilePreviewToolbar'
import { FilePreviewToolbarButton } from '../../FilePreviewToolbarButton'

interface ImageFilePreviewToolbarProps {
  disabled: boolean
  transformControls: ImagePreviewTransformControls
}

export function ImageFilePreviewToolbar({ disabled, transformControls }: ImageFilePreviewToolbarProps) {
  const { t } = useTranslation()

  return (
    <FilePreviewToolbar aria-label={t('preview.label')}>
      <FilePreviewToolbarButton
        label={t('preview.zoom_out')}
        disabled={disabled || !transformControls.canZoomOut}
        onClick={transformControls.zoomOut}>
        <ZoomOut aria-hidden />
      </FilePreviewToolbarButton>
      <FilePreviewToolbarButton
        label={t('preview.zoom_in')}
        disabled={disabled || !transformControls.canZoomIn}
        onClick={transformControls.zoomIn}>
        <ZoomIn aria-hidden />
      </FilePreviewToolbarButton>
      <FilePreviewToolbarButton
        label={t('preview.rotate_left')}
        disabled={disabled}
        onClick={transformControls.rotateLeft}>
        <RotateCcwSquare aria-hidden />
      </FilePreviewToolbarButton>
      <FilePreviewToolbarButton
        label={t('preview.rotate_right')}
        disabled={disabled}
        onClick={transformControls.rotateRight}>
        <RotateCwSquare aria-hidden />
      </FilePreviewToolbarButton>
      <FilePreviewToolbarButton
        label={t('preview.flip_horizontal')}
        disabled={disabled}
        onClick={transformControls.flipHorizontal}
        pressed={transformControls.transform.flipX}>
        <FlipHorizontal aria-hidden />
      </FilePreviewToolbarButton>
      <FilePreviewToolbarButton
        label={t('preview.flip_vertical')}
        disabled={disabled}
        onClick={transformControls.flipVertical}
        pressed={transformControls.transform.flipY}>
        <FlipVertical aria-hidden />
      </FilePreviewToolbarButton>
      <FilePreviewToolbarButton label={t('preview.reset')} disabled={disabled} onClick={transformControls.reset}>
        <RefreshCcw aria-hidden />
      </FilePreviewToolbarButton>
    </FilePreviewToolbar>
  )
}
