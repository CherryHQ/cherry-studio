import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWRImmutable from 'swr/immutable'

import { Button } from '@cherrystudio/ui'
import ImageViewer from '@renderer/components/ImageViewer'
import { ipcApi } from '@renderer/ipc'

import { useOptionalMessageListActions } from '../../MessageListProvider'
import type { ToolResultLinkData } from './toolResultLinks'

export function ToolResultLink({ url, isImage, name }: ToolResultLinkData) {
  const { t } = useTranslation()
  const actions = useOptionalMessageListActions()
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const { data: imageSource } = useSWRImmutable(
    ['tool-result-image', url, isImage],
    ([, targetUrl, imageHint]) => ipcApi.request('tool_result.preview_image', { url: targetUrl, imageHint }),
    { shouldRetryOnError: false }
  )

  if (imageSource && failedSource !== url) {
    return (
      <ImageViewer
        src={imageSource}
        alt={name ?? t('message.tools.sections.output')}
        className="my-2 max-h-80 max-w-full rounded object-contain"
        loading="lazy"
        onError={() => setFailedSource(url)}
      />
    )
  }

  return (
    <Button
      variant="link"
      asChild
      className="my-1 h-auto max-w-full justify-start whitespace-normal p-0 text-left break-all">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void (actions?.openExternalUrl
            ? actions.openExternalUrl(url)
            : ipcApi.request('system.shell.open_external_website', url))
        }}>
        {name ?? url}
      </a>
    </Button>
  )
}
