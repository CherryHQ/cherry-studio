import { useMemo } from 'react'

import ImageBlock from '@renderer/components/chat/messages/blocks/ImageBlock'
import type { NormalToolResponse } from '@renderer/types/mcpTool'

import { getChannelAuthQrResult } from '../channelConfigTool'
import { AgentExecutionTimeline } from './AgentExecutionTimeline'

export function MessageChannelConfigTool({ toolResponse }: { toolResponse: NormalToolResponse }) {
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
