import { parse as parsePartialJson } from 'partial-json'
import { type ReactElement, useDeferredValue, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useAgentLaunchIndex, usePartsMap } from '@renderer/components/chat/messages/blocks/MessagePartsContext'
import { useOptionalMessageListActions } from '@renderer/components/chat/messages/MessageListProvider'
import type { NormalToolResponse } from '@renderer/types/mcpTool'

import {
  AgentToolsType,
  isAskUserQuestionToolName,
  resolveResumeReceiptState,
  type ResumeReceiptState
} from '../shared/agentToolTypes'
import { getEffectiveStatus, StreamingContext, ToolHeader } from '../shared/GenericTools'
import { ToolApprovalOutcome } from '../shared/ToolApprovalOutcome'
import { getPartLaunchToolCallId } from '../toolParentMetadata'
import { isToolPartAwaitingApproval, type ToolResponseLike } from '../toolResponse'
import { AgentToolCallCard, getAgentToolFlowTitle } from './AgentToolCallCard'
import { AskUserQuestionCard } from './AskUserQuestionCard'
import { NavigateToolInline } from './NavigateTool'
import { isCherrySessionToolResponse } from './sessionToolResult'

function getStringArg(args: unknown, key: string): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined
  const value = (args as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * The presentation of a send-then-resume receipt — "continue handling" verb plus the launch
 * identity — shared by the chat row and the tool-group header so a resume reads exactly like the
 * launch card's continuation. Returns undefined when this receipt does not resolve to a launch.
 */
export function buildResumeToolHeader(
  state: Exclude<ResumeReceiptState, { kind: 'none' }>,
  toolResponse: ToolResponseLike,
  t: ReturnType<typeof useTranslation>['t']
): { header: ReactElement } | undefined {
  if (toolResponse.tool.name !== AgentToolsType.SendMessage) return undefined
  // The label serves the resolved identity; an unresolvable receipt never reaches here, so the
  // summary is only the fallback for hosts whose index carries no description.
  const identity =
    (state.kind === 'navigable' ? state.description : undefined) ?? getStringArg(toolResponse.arguments, 'summary')
  return {
    header: (
      <ToolHeader
        label={t('message.tools.activity.continueHandle')}
        toolName={toolResponse.tool.name}
        args={toolResponse.arguments}
        params={identity}
        variant="collapse-label"
        showStatus={false}
      />
    )
  }
}

export function AgentExecutionTimeline({ toolResponse }: { toolResponse: NormalToolResponse }) {
  const { arguments: args, response, tool, status, partialArguments } = toolResponse
  const { t } = useTranslation()

  const partsMap = usePartsMap()
  const launchIndex = useAgentLaunchIndex()
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

  const effectiveStatus = getEffectiveStatus(status, awaitingApproval)

  if (effectiveStatus === 'waiting') {
    return null
  }

  const isLoading = effectiveStatus === 'streaming' || effectiveStatus === 'invoking'
  const isSubagentTool = tool?.name === AgentToolsType.Agent || tool?.name === AgentToolsType.Task
  const resumeHeader =
    resumeState && resumeState.kind !== 'none' ? buildResumeToolHeader(resumeState, toolResponse, t) : undefined
  const resumeTarget = resumeState?.kind === 'navigable' ? resumeState : undefined
  return (
    <>
      <AgentToolCallCard
        toolCallId={toolResponse.toolCallId}
        toolName={tool?.name}
        input={args ?? parsedPartialArgs}
        output={isLoading ? undefined : response}
        isStreaming={isLoading}
        status={effectiveStatus}
        hasError={status === 'error'}
        isCherrySessionTool={isCherrySessionToolResponse(toolResponse)}
        openFlowOnClick={isSubagentTool || resumeTarget !== undefined}
        flowTargetToolCallId={resumeTarget?.toolCallId}
        // The flow is the agent's whole timeline — keep its title the launch identity, not the
        // resume request's summary.
        flowTitle={resumeTarget?.description ?? getAgentToolFlowTitle(tool?.name, args ?? parsedPartialArgs)}
        labelOverride={resumeHeader?.header}
        showInlineDetails={!isSubagentTool}
      />
      <ToolApprovalOutcome approval={toolResponse.approval} />
    </>
  )
}

export function AgentToolRenderer(props: { toolResponse: NormalToolResponse }) {
  return <AgentExecutionTimeline {...props} />
}
