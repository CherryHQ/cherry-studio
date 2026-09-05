import { EmptyState } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { toFileUrl } from '@shared/utils/file'
import FileWarning from 'lucide-react/dist/esm/icons/file-warning'
import LoaderCircle from 'lucide-react/dist/esm/icons/loader-circle'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FilePreviewLayout } from '../../FilePreviewLayout'
import type { FilePreviewPluginProps } from '../../types'

const logger = loggerService.withContext('VideoFilePreview')

export default function VideoFilePreview({ filePath, fileName, refreshKey }: FilePreviewPluginProps) {
  const { t } = useTranslation()
  const mediaKey = `${filePath}:${refreshKey}`
  const src = useMemo(() => toFileUrl(filePath), [filePath])
  const [readyKey, setReadyKey] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const status = errorKey === mediaKey ? 'error' : readyKey === mediaKey ? 'ready' : 'loading'

  if (status === 'error') {
    return (
      <FilePreviewLayout.Frame>
        <FilePreviewLayout.Content>
          <div role="alert" className="h-full">
            <EmptyState
              icon={FileWarning}
              title={t('file_preview.video.load_error.title')}
              description={t('file_preview.load_error.description')}
              className="h-full"
            />
          </div>
        </FilePreviewLayout.Content>
      </FilePreviewLayout.Frame>
    )
  }

  const markReady = () => setReadyKey(mediaKey)
  const handleError = () => {
    logger.error('Failed to load video preview', new Error(`Browser rejected video file: ${filePath}`))
    setErrorKey(mediaKey)
  }

  return (
    <FilePreviewLayout.Frame>
      <FilePreviewLayout.Content>
        <div className="relative flex h-full min-h-full min-w-full items-center justify-center overflow-hidden p-4">
          {status === 'loading' ? (
            <div
              role="status"
              className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 text-muted-foreground text-sm">
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              <span>{t('file_preview.loading')}</span>
            </div>
          ) : null}
          <video
            key={mediaKey}
            aria-label={fileName}
            className="block h-full w-full rounded-md bg-black object-contain"
            controls
            playsInline
            preload="metadata"
            src={src}
            onLoadedMetadata={markReady}
            onLoadedData={markReady}
            onCanPlay={markReady}
            onError={handleError}
          />
        </div>
      </FilePreviewLayout.Content>
    </FilePreviewLayout.Frame>
  )
}
