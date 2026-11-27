import { FileWarning } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@cherrystudio/ui'

import { formatFileSize } from './formatFileSize'
import { usePreviewHost } from './previewContext'

export function FilePreviewTooLarge({ sizeBytes, limitBytes }: { sizeBytes: number; limitBytes: number }) {
  const { t } = useTranslation()
  const { onRequestOpen } = usePreviewHost()

  return (
    <EmptyState
      icon={FileWarning}
      title={t('file_preview.too_large.title')}
      // A file within the package cap was rejected by a host policy whose limit is unknown here.
      description={
        sizeBytes > limitBytes
          ? t('file_preview.too_large.description', {
              size: formatFileSize(sizeBytes),
              limit: formatFileSize(limitBytes)
            })
          : t('file_preview.too_large.generic_description')
      }
      actionLabel={onRequestOpen ? t('file_preview.too_large.action') : undefined}
      onAction={onRequestOpen ? () => onRequestOpen('too_large') : undefined}
      className="h-full"
    />
  )
}
