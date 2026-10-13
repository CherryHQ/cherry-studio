import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import ImageViewer from '@renderer/components/ImageViewer'
import { MarkdownLinkRenderer } from '@renderer/components/markdown'

import { useOptionalMessageListActions } from '../../MessageListProvider'
import type { ToolResultLinkData } from './toolResultLinks'

export function ToolResultLink({ url, isImage, name }: ToolResultLinkData) {
  const { t } = useTranslation()
  const actions = useOptionalMessageListActions()
  const [failedSource, setFailedSource] = useState<string | null>(null)

  if (isImage && failedSource !== url) {
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
