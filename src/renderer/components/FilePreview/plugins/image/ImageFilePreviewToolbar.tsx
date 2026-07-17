import type { ImagePreviewTransformControls } from '@cherrystudio/ui'
import FlipHorizontal from 'lucide-react/dist/esm/icons/flip-horizontal'
import FlipVertical from 'lucide-react/dist/esm/icons/flip-vertical'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw'
import RotateCw from 'lucide-react/dist/esm/icons/rotate-cw'
import Undo2 from 'lucide-react/dist/esm/icons/undo-2'
import ZoomIn from 'lucide-react/dist/esm/icons/zoom-in'
import ZoomOut from 'lucide-react/dist/esm/icons/zoom-out'
import { useTranslation } from 'react-i18next'

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
        <RotateCcw aria-hidden />
      </FilePreviewToolbarButton>
      <FilePreviewToolbarButton
        label={t('preview.rotate_right')}
        disabled={disabled}
        onClick={transformControls.rotateRight}>
        <RotateCw aria-hidden />
      </FilePreviewToolbarButton>
      <FilePreviewToolbarButton
        label={t('preview.flip_horizontal')}
        disabled={disabled}
        onClick={transformControls.flipHorizontal}>
        <FlipHorizontal aria-hidden />
      </FilePreviewToolbarButton>
      <FilePreviewToolbarButton
        label={t('preview.flip_vertical')}
        disabled={disabled}
        onClick={transformControls.flipVertical}>
        <FlipVertical aria-hidden />
      </FilePreviewToolbarButton>
      <FilePreviewToolbarButton label={t('preview.reset')} disabled={disabled} onClick={transformControls.reset}>
        <Undo2 aria-hidden />
      </FilePreviewToolbarButton>
    </FilePreviewToolbar>
  )
}
