import { useFullPartsMap, usePartsMap } from '@renderer/components/chat/messages/blocks/MessagePartsContext'
import type { NormalToolResponse } from '@renderer/types/mcpTool'
import type { CherryMessagePart } from '@shared/data/types/message'
import { parse as parsePartialJson } from 'partial-json'
import { type ReactElement, useDeferredValue, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AgentToolsType,
  getResumedAgentId,
  isAskUserQuestionToolName,
  resolveResumedAgent
} from '../shared/agentToolTypes'
import { getEffectiveStatus, StreamingContext, ToolHeader } from '../shared/GenericTools'
import { isToolPartAwaitingApproval, type ToolResponseLike } from '../toolResponse'
import { AgentToolCallCard, getAgentToolFlowTitle } from './AgentToolCallCard'
import { AskUserQuestionCard } from './AskUserQuestionCard'
import { NavigateToolInline } from './NavigateTool'
import { isCherrySessionToolResponse } from './sessionToolResult'

/**
 * The presentation of a send-then-resume receipt — "continue handling" verb plus the launch
 * identity — shared by the chat row and the tool-group header so a resume reads exactly like the
 * launch card's continuation. Returns undefined when this receipt does not resolve to a launch.
 */
export function buildResumeToolHeader(
  toolResponse: ToolResponseLike,
  fullPartsMap: Record<string, CherryMessagePart[]> | null,
  t: ReturnType<typeof useTranslation>['t']
): { resumedLaunch: { toolCallId: string; description?: string }; header: ReactElement } | undefined {
  const resumedLaunch = resolveResumedAgent(toolResponse.response, fullPartsMap)
  if (!resumedLaunch?.description) return undefined
  return {
    resumedLaunch,
    header: (
      <ToolHeader
        label={t('message.tools.activity.continueHandle')}
        toolName={toolResponse.tool.name}
        args={toolResponse.arguments}
        params={resumedLaunch.description}
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
  const fullPartsMap = useFullPartsMap()
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
  const resumedAgentId = tool?.name === AgentToolsType.SendMessage ? getResumedAgentId(response) : undefined
  const resumedLaunch = useMemo(
    () => (resumedAgentId ? resolveResumedAgent(response, fullPartsMap) : undefined),
    [response, fullPartsMap, resumedAgentId]
  )

  if (tool?.name === 'mcp__assistant__navigate') {
    return <NavigateToolInline input={args ?? parsedPartialArgs} output={response} />
  }

  if (isAskUserQuestionToolName(tool?.name)) {
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
  // Reuse the memoized launch resolution instead of re-scanning — buildResumeToolHeader keeps
  // its own scan for the group header, which has no memo here.
  const resumeHeader =
    resumedLaunch && typeof resumedLaunch.description === 'string'
      ? {
          resumedLaunch,
          header: (
            <ToolHeader
              label={t('message.tools.activity.continueHandle')}
              toolName={tool?.name}
              args={args}
              params={resumedLaunch.description}
              variant="collapse-label"
              showStatus={false}
            />
          )
        }
      : undefined
  return (
    <AgentToolCallCard
      toolCallId={toolResponse.toolCallId}
      toolName={tool?.name}
      input={args ?? parsedPartialArgs}
      output={isLoading ? undefined : response}
      isStreaming={isLoading}
      status={effectiveStatus}
      hasError={status === 'error'}
      isCherrySessionTool={isCherrySessionToolResponse(toolResponse)}
      openFlowOnClick={isSubagentTool || resumedLaunch !== undefined}
      flowTargetToolCallId={resumedLaunch?.toolCallId}
      // The flow is the agent's whole timeline — keep its title the launch identity, not the
      // resume request's summary.
      flowTitle={resumedLaunch?.description ?? getAgentToolFlowTitle(tool?.name, args ?? parsedPartialArgs)}
      labelOverride={resumeHeader?.header}
      showInlineDetails={!isSubagentTool}
    />
  )
}

export function AgentToolRenderer(props: { toolResponse: NormalToolResponse }) {
  return <AgentExecutionTimeline {...props} />
}
