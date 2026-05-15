import { usePartsMap } from '@renderer/components/chat/messages/blocks'
import type { NormalToolResponse } from '@renderer/types'
import { parse as parsePartialJson } from 'partial-json'
import { useDeferredValue, useMemo } from 'react'

import { isToolPartAwaitingApproval } from '../toolResponse'
import { AgentToolCallCard } from './AgentToolCallCard'
import { AskUserQuestionCard } from './AskUserQuestionCard'
import { getEffectiveStatus, StreamingContext } from './GenericTools'
import { NavigateToolInline } from './NavigateTool'
import ToolPermissionCard from './ToolPermissionCard'
import { AgentToolsType } from './types'

export function AgentExecutionTimeline({ toolResponse }: { toolResponse: NormalToolResponse }) {
  const { arguments: args, response, tool, status, partialArguments } = toolResponse

  const partsMap = usePartsMap()
  const awaitingApproval = isToolPartAwaitingApproval(partsMap, toolResponse.toolCallId)

  const deferredPartialArguments = useDeferredValue(partialArguments)
  const parsedPartialArgs = useMemo(() => {
    if (!deferredPartialArguments) return undefined
    try {
      return parsePartialJson(deferredPartialArguments)
    } catch {
      return undefined
    }
  }, [deferredPartialArguments])

  if (tool?.name === 'mcp__assistant__navigate') {
    return <NavigateToolInline input={args ?? parsedPartialArgs} output={response} />
  }

  if (tool?.name === AgentToolsType.AskUserQuestion) {
    const isLoading = status === 'streaming' || status === 'invoking'
    return (
      <StreamingContext value={isLoading}>
        <AskUserQuestionCard toolResponse={toolResponse} />
      </StreamingContext>
    )
  }

  if (tool?.name === AgentToolsType.TodoWrite) {
    return null
  }

  const effectiveStatus = getEffectiveStatus(status, awaitingApproval)

  if (effectiveStatus === 'waiting') {
    return <ToolPermissionCard toolResponse={toolResponse} />
  }

  const isLoading = effectiveStatus === 'streaming' || effectiveStatus === 'invoking'
  return (
    <AgentToolCallCard
      toolName={tool?.name}
      input={args ?? parsedPartialArgs}
      output={isLoading ? undefined : response}
      isStreaming={isLoading}
      status={effectiveStatus}
      hasError={status === 'error'}
    />
  )
}

export function AgentToolRenderer(props: { toolResponse: NormalToolResponse }) {
  return <AgentExecutionTimeline {...props} />
}
