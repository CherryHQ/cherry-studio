import { parse as parsePartialJson } from 'partial-json'
import { use, useDeferredValue, useMemo } from 'react'

import { useScopedPartsMap } from '@renderer/components/chat/messages/blocks/MessagePartsContext'
import type { NormalToolResponse } from '@renderer/types/mcpTool'

import { SubagentStatusContext } from '../../blocks/SubagentStatusContext'
import { AgentToolsType, isAskUserQuestionToolName } from '../shared/agentToolTypes'
import { getEffectiveStatus, StreamingContext } from '../shared/GenericTools'
import { ToolApprovalOutcome } from '../shared/ToolApprovalOutcome'
import { isToolPartAwaitingApproval } from '../toolResponse'
import { useToolResponsePreview } from '../useToolResponsePreview'
import { AgentToolCallCard } from './AgentToolCallCard'
import { AskUserQuestionCard } from './AskUserQuestionCard'
import { NavigateToolInline } from './NavigateTool'
import { isCherrySessionToolResponse } from './sessionToolResult'

export function AgentExecutionTimeline({ toolResponse: originalResponse }: { toolResponse: NormalToolResponse }) {
  const name = originalResponse.tool.name
  const { toolResponse } = useToolResponsePreview(
    originalResponse,
    isAskUserQuestionToolName(name) ||
      name === AgentToolsType.Agent ||
      name === AgentToolsType.Task ||
      name === AgentToolsType.WebSearch ||
      name === AgentToolsType.WebFetch ||
      name === AgentToolsType.ToolSearch ||
      name === 'mcp__assistant__navigate' ||
      isCherrySessionToolResponse(originalResponse)
  )
  const { arguments: args, response, tool, status, partialArguments } = toolResponse

  const partsMap = useScopedPartsMap()
  const awaitingApproval = isToolPartAwaitingApproval(partsMap, toolResponse.toolCallId)

  const isSubagentTool = tool?.name === AgentToolsType.Agent || tool?.name === AgentToolsType.Task
  const taskStatus = isSubagentTool ? use(SubagentStatusContext)(toolResponse.toolCallId, status) : undefined

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
        output={response}
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
