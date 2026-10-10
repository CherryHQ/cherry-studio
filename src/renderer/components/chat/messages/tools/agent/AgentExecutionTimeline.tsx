import { parse as parsePartialJson } from 'partial-json'
import { useDeferredValue, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { usePartsMap } from '@renderer/components/chat/messages/blocks/MessagePartsContext'
import { useOptionalMessageListActions } from '@renderer/components/chat/messages/MessageListProvider'
import type { NormalToolResponse } from '@renderer/types/mcpTool'

import {
  AgentToolsType,
  getPartLaunchToolCallId,
  isAskUserQuestionToolName,
  resolveResumeReceiptState
} from '../shared/agentToolTypes'
import { getEffectiveStatus, StreamingContext } from '../shared/GenericTools'
import { ToolApprovalOutcome } from '../shared/ToolApprovalOutcome'
import { isToolPartAwaitingApproval } from '../toolResponse'
import { useAgentLaunchIndex } from './AgentLaunchIndexContext'
import { buildResumeToolHeader } from './agentResumeHeader'
import { AgentToolCallCard, getAgentToolFlowTitle } from './AgentToolCallCard'
import { resolveAgentToolFlowTarget } from './agentToolFlowTarget'
import { AskUserQuestionCard } from './AskUserQuestionCard'
import { NavigateToolInline } from './NavigateTool'
import { isCherrySessionToolResponse } from './sessionToolResult'
import { getSubagentTaskStatus } from './subagentStatus'

export function AgentExecutionTimeline({ toolResponse }: { toolResponse: NormalToolResponse }) {
  const { arguments: args, response, tool, status, partialArguments } = toolResponse
  const { t } = useTranslation()

  const partsMap = usePartsMap()
  const launchIndex = useAgentLaunchIndex()
  const awaitingApproval = isToolPartAwaitingApproval(partsMap, toolResponse.toolCallId)

  const isSubagentTool = tool?.name === AgentToolsType.Agent || tool?.name === AgentToolsType.Task
  const taskStatus = useMemo(
    () =>
      isSubagentTool
        ? getSubagentTaskStatus(Object.values(partsMap ?? {}).flat(), toolResponse.toolCallId, status)
        : undefined,
    [isSubagentTool, partsMap, status, toolResponse.toolCallId]
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

  // Hooks stay above every early return below: a tool flipping out of its approval wait must not
  // change this component's hook count (React #310).
  const listActions = useOptionalMessageListActions()
  const resumeState = useMemo(
    () =>
      tool?.name === AgentToolsType.SendMessage
        ? resolveResumeReceiptState(
            response,
            getPartLaunchToolCallId(toolResponse),
            launchIndex,
            Boolean(listActions?.openAgentToolFlow)
          )
        : undefined,
    [tool?.name, response, toolResponse, launchIndex, listActions]
  )
  // A cold-resumed child streams under its own receipt, so that receipt is the flow's root:
  // redirecting to the launch root would drop everything the resume produced. The index is read
  // rather than the parts map, which a settled tool group deliberately empties, and the target
  // comes from the shared resolver so the row, the disclosure and the pane agree on it.
  const flowTarget = resolveAgentToolFlowTarget(toolResponse, launchIndex, Boolean(listActions?.openAgentToolFlow))
  const receiptRootsItsFlow = flowTarget !== undefined && flowTarget === toolResponse.toolCallId

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
  const resumeHeader =
    resumeState && resumeState.kind !== 'none' ? buildResumeToolHeader(resumeState, toolResponse, t) : undefined
  const resumeTarget = resumeState?.kind === 'navigable' ? resumeState : undefined
  // A receipt that owns its flow is an entry too, but it opens on its own call id: no target is
  // passed, so the card defaults to the call it renders.
  const resumeEntry = resumeTarget !== undefined || resumeState?.kind === 'self'
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
        openFlowOnClick={isSubagentTool || resumeEntry}
        flowTargetToolCallId={receiptRootsItsFlow ? undefined : flowTarget}
        // The flow is the agent's whole timeline — keep its title the launch identity, not the
        // resume request's summary.
        flowTitle={resumeTarget?.description ?? getAgentToolFlowTitle(tool?.name, args ?? parsedPartialArgs)}
        labelOverride={resumeEntry ? undefined : resumeHeader?.header}
        showInlineDetails={!isSubagentTool}
      />
      <ToolApprovalOutcome approval={toolResponse.approval} />
    </>
  )
}

export function AgentToolRenderer(props: { toolResponse: NormalToolResponse }) {
  return <AgentExecutionTimeline {...props} />
}
