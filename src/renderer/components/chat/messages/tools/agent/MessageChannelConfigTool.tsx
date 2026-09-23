import { useEffect, useMemo, useState } from 'react'

import ImageBlock from '@renderer/components/chat/messages/blocks/ImageBlock'
import type { NormalToolResponse } from '@renderer/types/mcpTool'
import { toSafeFileUrl } from '@shared/utils/file'

import { getChannelAuthQrResult } from '../channelConfigTool'
import { AgentExecutionTimeline } from './AgentExecutionTimeline'

export function MessageChannelConfigTool({ toolResponse }: { toolResponse: NormalToolResponse }) {
  const qrResult = useMemo(() => getChannelAuthQrResult(toolResponse), [toolResponse])
  const [images, setImages] = useState<string[]>(
    () => qrResult?.images.flatMap((image) => (image.data ? [`data:${image.mimeType};base64,${image.data}`] : [])) ?? []
  )

  useEffect(() => {
    let cancelled = false
    if (!qrResult) {
      setImages([])
      return
    }
    void Promise.all(
      qrResult.images.map(async (image) => {
        if (image.assetId) {
          try {
            return toSafeFileUrl(await window.api.file.getPhysicalPath({ id: image.assetId }), null)
          } catch {
            // Fall back to the current-turn bytes when the asset has already been reclaimed.
          }
        }
        return image.data ? `data:${image.mimeType};base64,${image.data}` : null
      })
    ).then((resolved) => {
      if (!cancelled) setImages(resolved.filter((url): url is string => Boolean(url)))
    })
    return () => {
      cancelled = true
    }
  }, [qrResult])

  if (!qrResult) {
    return <AgentExecutionTimeline toolResponse={toolResponse} />
  }

  return (
    <div className="group/tool my-px flex flex-col gap-1">
      <AgentExecutionTimeline
        toolResponse={{
          ...toolResponse,
          response: qrResult.responseWithoutImages
        }}
      />
      <ImageBlock images={images} isSingle={images.length === 1} />
    </div>
  )
}
