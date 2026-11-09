import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FilePreviewLayout, FilePreviewToolbar } from '@cherrystudio/file-preview/react'
import { ImagePreviewToolbar, ImagePreviewViewport, useImagePreviewTransform } from '@cherrystudio/ui'
import { useHeifRendition } from '@renderer/hooks/useHeifRendition'

import type { FilePreviewPluginProps } from '../../types'

export default function HeifFilePreview({ filePath, fileName, refreshKey }: FilePreviewPluginProps) {
  const { t } = useTranslation()
  const { url, loading, error } = useHeifRendition(filePath, undefined, fileName, refreshKey)
  const [failedUrl, setFailedUrl] = useState<string>()
  const transformControls = useImagePreviewTransform()
  const item = { id: filePath, src: url ?? '', alt: fileName, title: fileName }
  const labels = {
    close: t('preview.close'),
    next: t('preview.next'),
    previous: t('preview.previous'),
    flipHorizontal: t('preview.flip_horizontal'),
    flipVertical: t('preview.flip_vertical'),
    reset: t('preview.reset'),
    rotateLeft: t('preview.rotate_left'),
    rotateRight: t('preview.rotate_right'),
    zoomIn: t('preview.zoom_in'),
    zoomOut: t('preview.zoom_out')
  }
  const imageError = error ?? (url && url === failedUrl ? 'error.heif_detail_convert' : undefined)
  return (
    <FilePreviewLayout.Frame>
      {url && !imageError ? (
        <FilePreviewToolbar aria-label={t('preview.label')}>
          <ImagePreviewToolbar
            item={item}
            labels={labels}
            transformControls={transformControls}
            context={{
              close: () => {},
              index: 0,
              items: [item],
              resetTransform: transformControls.reset,
              transform: transformControls.transform
            }}
          />
        </FilePreviewToolbar>
      ) : null}
      <FilePreviewLayout.Content>
        {imageError ? (
          <div role="alert" className="p-4 text-muted-foreground">
            {t(imageError)}
          </div>
        ) : loading ? (
          <div role="status" className="p-4 text-muted-foreground">
            {t('file_preview.loading')}
          </div>
        ) : url ? (
          <ImagePreviewViewport
            className="h-full w-full"
            item={item}
            transformControls={transformControls}
            onError={() => setFailedUrl(url)}
          />
        ) : null}
      </FilePreviewLayout.Content>
    </FilePreviewLayout.Frame>
  )
}
