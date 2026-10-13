import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWRImmutable from 'swr/immutable'

import ImageViewer from '@renderer/components/ImageViewer'
import { MarkdownLinkRenderer } from '@renderer/components/markdown'

import { useOptionalMessageListActions } from '../../MessageListProvider'
import type { ToolResultLinkData } from './toolResultLinks'

export function ToolResultLink({ url, isImage, mimeType, name }: ToolResultLinkData) {
  const { t } = useTranslation()
  const actions = useOptionalMessageListActions()
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const { data: detectedImage } = useSWRImmutable(
    mimeType ? null : ['tool-result-image', url],
    async ([, targetUrl]) => {
      try {
        const response = await fetch(targetUrl, {
          method: 'HEAD',
          credentials: 'omit',
          signal: AbortSignal.timeout(5000)
        })
        const contentType = response.headers.get('Content-Type')?.trim().toLowerCase()
        return response.ok && contentType ? contentType.startsWith('image/') : null
      } catch {
        return null
      }
    },
    { shouldRetryOnError: false }
  )
  const showImage = mimeType || detectedImage === null ? isImage : detectedImage === true

  if (showImage && failedSource !== url) {
    return (
      <ImageViewer
        src={url}
        alt={name ?? t('message.tools.sections.output')}
        className="my-2 max-h-80 max-w-full rounded object-contain"
        loading="lazy"
        onError={() => setFailedSource(url)}
      />
    )
  }

  return (
    <div className="my-1 break-all">
      <MarkdownLinkRenderer href={url} openExternalUrl={actions?.openExternalUrl}>
        {name ?? url}
      </MarkdownLinkRenderer>
    </div>
  )
}
