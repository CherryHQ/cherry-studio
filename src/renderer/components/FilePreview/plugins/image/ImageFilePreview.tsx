import { EmptyState, ImagePreviewImage, useImagePreviewTransform } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { getFilePreviewExtension } from '@renderer/utils/filePreview'
import { toSafeFileUrl } from '@shared/utils/file'
import ImageOff from 'lucide-react/dist/esm/icons/image-off'
import LoaderCircle from 'lucide-react/dist/esm/icons/loader-circle'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FilePreviewLayout } from '../../FilePreviewLayout'
import type { FilePreviewPluginProps } from '../../types'
import { ImageFilePreviewToolbar } from './ImageFilePreviewToolbar'

const logger = loggerService.withContext('ImageFilePreview')

export default function ImageFilePreview({ filePath, fileName, refreshKey }: FilePreviewPluginProps) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<'error' | 'loading' | 'ready'>('loading')
  const transformControls = useImagePreviewTransform()
  const item = useMemo(
    () => ({
      id: `${filePath}:${refreshKey}`,
      src: toSafeFileUrl(filePath, getFilePreviewExtension(filePath)),
      alt: fileName,
      title: fileName
    }),
    [fileName, filePath, refreshKey]
  )

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
        <div className="relative flex h-full min-h-full min-w-full items-center justify-center">
          {status === 'loading' && (
            <div
              role="status"
              className="absolute inset-0 flex items-center justify-center gap-2 text-muted-foreground text-sm">
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              <span>{t('file_preview.loading')}</span>
            </div>
          )}
          <ImagePreviewImage
            className={status === 'loading' ? 'opacity-0' : undefined}
            item={item}
            transform={transformControls.transform}
            onLoad={() => setStatus('ready')}
            onError={() => {
              const error = new Error(`Failed to load image preview: ${filePath}`)
              logger.error(`Failed to load image preview: ${filePath}`, error)
              setStatus('error')
            }}
          />
        </div>
      </FilePreviewLayout.Content>
    </FilePreviewLayout.Frame>
  )
}
