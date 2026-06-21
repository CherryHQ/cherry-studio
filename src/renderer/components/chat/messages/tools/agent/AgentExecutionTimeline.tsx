import { usePartsMap } from '@renderer/components/chat/messages/blocks'
import type { NormalToolResponse } from '@renderer/types'
import { parse as parsePartialJson } from 'partial-json'
import { useDeferredValue, useMemo } from 'react'

import { isToolPartAwaitingApproval } from '../toolResponse'
import { AgentToolCallCard } from './AgentToolCallCard'
import { AskUserQuestionCard } from './AskUserQuestionCard'
import { getEffectiveStatus, StreamingContext } from './GenericTools'
import { NavigateToolInline } from './NavigateTool'
import { AgentToolsType, isAskUserQuestionToolName } from './types'

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

  if (isAskUserQuestionToolName(tool?.name)) {
    if (awaitingApproval) return null

    const isLoading = status === 'streaming' || status === 'invoking'
    return (
      <StreamingContext value={isLoading}>
        <AskUserQuestionCard toolResponse={toolResponse} />
      </StreamingContext>
    )
  }

  // TodoWrite is globally disabled; old DB messages may still carry it — keep hiding them.
  if (tool?.name === 'TodoWrite') {
    return null
  }

  const effectiveStatus = getEffectiveStatus(status, awaitingApproval)

  if (effectiveStatus === 'waiting') {
    return null
  }

  const isLoading = effectiveStatus === 'streaming' || effectiveStatus === 'invoking'
  const isSubagentTool = tool?.name === AgentToolsType.Agent || tool?.name === AgentToolsType.Task
  return (
    <AgentToolCallCard
      toolCallId={toolResponse.toolCallId}
      toolName={tool?.name}
      input={args ?? parsedPartialArgs}
      output={isLoading || isSubagentTool ? undefined : response}
      isStreaming={isLoading}
      status={effectiveStatus}
      hasError={status === 'error'}
      openFlowOnClick={isSubagentTool}
      showInlineDetails={!isSubagentTool}
    />
  )
}

export function AgentToolRenderer(props: { toolResponse: NormalToolResponse }) {
  return <AgentExecutionTimeline {...props} />
}
