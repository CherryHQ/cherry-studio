import { ImageOff, LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState, ImagePreviewViewport, useImagePreviewTransform } from '@cherrystudio/ui'

import { FilePreviewLayout } from '../../FilePreviewLayout'
import { usePreviewHost, usePreviewLogger } from '../../previewContext'
import { readPreviewDocument } from '../../source'
import type { FilePreviewPluginProps } from '../../types'
import { ImageFilePreviewToolbar } from './ImageFilePreviewToolbar'

export default function ImageFilePreview({ sourceId, fileName, document, mediaType }: FilePreviewPluginProps) {
  const logger = usePreviewLogger('ImageFilePreview')
  const { t } = useTranslation()
  const { failDocument } = usePreviewHost()
  const [url, setUrl] = useState<string | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const [status, setStatus] = useState<'error' | 'loading' | 'ready'>('loading')
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
    void readPreviewDocument(document, 64 * 1024 * 1024, controller.signal)
      .then((bytes) => {
        if (controller.signal.aborted) return
        const extension = fileName.split('.').at(-1)?.toLowerCase()
        const mime =
          mediaType?.trim() ||
          (extension === 'svg' ? 'image/svg+xml' : extension === 'jpg' ? 'image/jpeg' : `image/${extension}`)
        objectUrlRef.current = URL.createObjectURL(new Blob([bytes], { type: mime }))
        setUrl(objectUrlRef.current)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        logger.error(`Failed to load image preview: ${sourceId}`, error)
        failDocument?.(error)
        setStatus('error')
      })
    return () => {
      controller.abort()
      releaseImageUrl()
    }
  }, [document, fileName, mediaType, sourceId, logger, failDocument, releaseImageUrl])

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
                logger.error(`Failed to load image preview: ${sourceId}`, error)
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
