import type { TFunction } from 'i18next'

import type { ImagePreviewLabels } from '@cherrystudio/ui'

export function getImagePreviewLabels(t: TFunction): Partial<ImagePreviewLabels> {
  return {
    close: t('preview.close'),
    dialogTitle: t('preview.label'),
    flipHorizontal: t('preview.flip_horizontal'),
    flipVertical: t('preview.flip_vertical'),
    next: t('preview.next'),
    previous: t('preview.previous'),
    reset: t('preview.reset'),
    rotateLeft: t('preview.rotate_left'),
    rotateRight: t('preview.rotate_right'),
    zoomIn: t('preview.zoom_in'),
    zoomOut: t('preview.zoom_out')
  }
}
