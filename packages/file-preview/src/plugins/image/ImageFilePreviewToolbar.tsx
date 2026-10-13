import {
  FlipHorizontal,
  FlipVertical,
  RefreshCcw,
  RotateCcwSquare,
  RotateCwSquare,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
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
