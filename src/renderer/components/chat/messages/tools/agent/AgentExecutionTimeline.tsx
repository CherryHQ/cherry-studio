import { parse as parsePartialJson } from 'partial-json'
import { use, useDeferredValue, useMemo } from 'react'

import { PartsContext, useScopedPartsMap } from '@renderer/components/chat/messages/blocks/MessagePartsContext'
import type { NormalToolResponse } from '@renderer/types/mcpTool'

import { AgentToolsType, isAskUserQuestionToolName } from '../shared/agentToolTypes'
import { getEffectiveStatus, StreamingContext } from '../shared/GenericTools'
import { ToolApprovalOutcome } from '../shared/ToolApprovalOutcome'
import { isToolPartAwaitingApproval } from '../toolResponse'
import { AgentToolCallCard } from './AgentToolCallCard'
import { AskUserQuestionCard } from './AskUserQuestionCard'
import { NavigateToolInline } from './NavigateTool'
import { isCherrySessionToolResponse } from './sessionToolResult'
import { getSubagentTaskStatus } from './subagentStatus'

export function AgentExecutionTimeline({ toolResponse }: { toolResponse: NormalToolResponse }) {
  const { arguments: args, response, tool, status, partialArguments } = toolResponse

  const partsMap = useScopedPartsMap()
  const awaitingApproval = isToolPartAwaitingApproval(partsMap, toolResponse.toolCallId)

  const isSubagentTool = tool?.name === AgentToolsType.Agent || tool?.name === AgentToolsType.Task
  // A steer routes later task events to a continuation message, so only subagent cards read the complete map.
  const taskPartsMap = isSubagentTool ? use(PartsContext) : null
  const taskStatus = useMemo(
    () =>
      taskPartsMap
        ? getSubagentTaskStatus(Object.values(taskPartsMap).flat(), toolResponse.toolCallId, status)
        : undefined,
    [taskPartsMap, status, toolResponse.toolCallId]
  )

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
    if (toolResponse.approval?.approved === false) {
      return <ToolApprovalOutcome approval={toolResponse.approval} />
    }
    const isLoading = status === 'streaming' || status === 'invoking'
    return (
      <StreamingContext value={isLoading}>
        <AskUserQuestionCard toolResponse={toolResponse} />
      </StreamingContext>
    )
  }

  const effectiveStatus = taskStatus ?? getEffectiveStatus(status, awaitingApproval)

  if (effectiveStatus === 'waiting') {
    return null
  }

  const isLoading = effectiveStatus === 'streaming' || effectiveStatus === 'invoking'
  return (
    <>
      <AgentToolCallCard
        toolCallId={toolResponse.toolCallId}
        toolName={tool?.name}
        input={args ?? parsedPartialArgs}
        output={isLoading && !taskStatus ? undefined : response}
        isStreaming={isLoading}
        status={effectiveStatus}
        hasError={effectiveStatus === 'error'}
        isCherrySessionTool={isCherrySessionToolResponse(toolResponse)}
        openFlowOnClick={isSubagentTool}
        showInlineDetails={!isSubagentTool}
      />
      <ToolApprovalOutcome approval={toolResponse.approval} />
    </>
  )
}

export function AgentToolRenderer(props: { toolResponse: NormalToolResponse }) {
  return <AgentExecutionTimeline {...props} />
}
