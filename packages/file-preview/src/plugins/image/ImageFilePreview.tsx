import { ImageOff, LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState, ImagePreviewViewport, useImagePreviewTransform } from '@cherrystudio/ui'

import { FilePreviewLayout } from '../../FilePreviewLayout'
import { FilePreviewTooLarge } from '../../FilePreviewTooLarge'
import { usePreviewHost } from '../../previewContext'
import { PreviewError, readPreviewDocument } from '../../source'
import type { FilePreviewPluginProps } from '../../types'
import { imageFilePreviewPlugin } from './imageFilePreviewPlugin'
import { ImageFilePreviewToolbar } from './ImageFilePreviewToolbar'

const IMAGE_PREVIEW_MAX_SIZE_BYTES = 64 * 1024 * 1024
const IMAGE_MEDIA_TYPE_BY_EXTENSION: Record<string, string> = {
  svg: 'image/svg+xml',
  jpg: 'image/jpeg',
  ico: 'image/x-icon'
}

export default function ImageFilePreview({ sourceId, fileName, document, mediaType }: FilePreviewPluginProps) {
  const { t } = useTranslation()
  const { failDocument } = usePreviewHost()
  const [url, setUrl] = useState<string | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const [status, setStatus] = useState<'error' | 'loading' | 'ready' | 'too_large'>('loading')
  const transformControls = useImagePreviewTransform()
  const releaseImageUrl = useCallback(() => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = null
  }, [])
  const item = useMemo(
    () => ({
      id: `${sourceId}:${document.revision}`,
      src: url ?? '',
      alt: fileName,
      title: fileName
    }),
    [fileName, sourceId, document.revision, url]
  )

  useEffect(() => {
    const controller = new AbortController()
    setStatus('loading')
    setUrl(null)
    void readPreviewDocument(document, IMAGE_PREVIEW_MAX_SIZE_BYTES, controller.signal)
      .then((bytes) => {
        if (controller.signal.aborted) return
        const extension = fileName.split('.').at(-1)?.toLowerCase()
        const normalizedMediaType = mediaType?.split(';', 1)[0].trim().toLowerCase()
        const mime =
          normalizedMediaType && imageFilePreviewPlugin.mediaTypes.includes(normalizedMediaType)
            ? normalizedMediaType
            : (IMAGE_MEDIA_TYPE_BY_EXTENSION[extension ?? ''] ?? `image/${extension}`)
        objectUrlRef.current = URL.createObjectURL(new Blob([bytes], { type: mime }))
        setUrl(objectUrlRef.current)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        failDocument?.(error)
        setStatus(error instanceof PreviewError && error.code === 'too_large' ? 'too_large' : 'error')
      })
    return () => {
      controller.abort()
      releaseImageUrl()
    }
  }, [document, fileName, mediaType, failDocument, releaseImageUrl])

  if (status === 'too_large') {
    return (
      <FilePreviewLayout.Frame>
        <FilePreviewLayout.Content>
          <FilePreviewTooLarge sizeBytes={document.size} limitBytes={IMAGE_PREVIEW_MAX_SIZE_BYTES} />
        </FilePreviewLayout.Content>
      </FilePreviewLayout.Frame>
    )
  }

  if (status === 'error') {
    return (
      <FilePreviewLayout.Frame>
        <FilePreviewLayout.Content>
          <div role="alert" className="h-full">
            <EmptyState
              icon={ImageOff}
              title={t('file_preview.load_error.title')}
              description={t('file_preview.load_error.description')}
              className="h-full"
            />
          </div>
        </FilePreviewLayout.Content>
      </FilePreviewLayout.Frame>
    )
  }

  return (
    <FilePreviewLayout.Frame>
      <ImageFilePreviewToolbar disabled={status !== 'ready'} transformControls={transformControls} />
      <FilePreviewLayout.Content>
        <div className="relative flex h-full min-h-full min-w-full items-center justify-center p-4">
          {status === 'loading' && (
            <div
              role="status"
              className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              <span>{t('file_preview.loading')}</span>
            </div>
          )}
          {url ? (
            <ImagePreviewViewport
              className="h-full min-h-full w-full"
              imageClassName={status === 'loading' ? 'opacity-0' : undefined}
              item={item}
              transformControls={transformControls}
              onLoad={() => setStatus('ready')}
              onError={() => {
                const error = new Error(`Failed to load image preview: ${sourceId}`)
                failDocument?.(error)
                releaseImageUrl()
                setUrl(null)
                setStatus('error')
              }}
            />
          ) : null}
        </div>
      </FilePreviewLayout.Content>
    </FilePreviewLayout.Frame>
  )
}
