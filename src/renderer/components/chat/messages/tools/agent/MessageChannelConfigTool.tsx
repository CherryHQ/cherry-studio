import { useMemo } from 'react'

import ImageBlock from '@renderer/components/chat/messages/blocks/ImageBlock'

import { getChannelAuthQrResult } from '../channelConfigTool'
import type { ToolResponseLike } from '../toolResponse'
import { AgentExecutionTimeline } from './AgentExecutionTimeline'

export function MessageChannelConfigTool({ toolResponse }: { toolResponse: ToolResponseLike }) {
  const qrResult = useMemo(() => getChannelAuthQrResult(toolResponse), [toolResponse])

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
      <ImageBlock images={qrResult.images} isSingle={qrResult.images.length === 1} />
    </div>
  )
}
