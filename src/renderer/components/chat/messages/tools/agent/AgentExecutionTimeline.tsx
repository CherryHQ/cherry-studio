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
  toolResponse: ToolResponseLike,
  fullPartsMap: Record<string, CherryMessagePart[]> | null,
  t: ReturnType<typeof useTranslation>['t'],
  resumedLaunch?: { toolCallId: string; description?: string }
): { resumedLaunch?: { toolCallId: string; description?: string }; header: ReactElement } | undefined {
  // Resume detection only needs the receipt's own output; launch-identity resolution is an
  // enhancement that must never gate the label. Gated to SendMessage — only its receipts carry
  // agent ids, and this header drives labels for every tool row.
  if (toolResponse.tool.name !== AgentToolsType.SendMessage) return undefined
  if (!getResumedAgentId(toolResponse.response)) return undefined
  const resolved = resumedLaunch ?? resolveResumedAgent(toolResponse.response, fullPartsMap)
  const identity = resolved?.description ?? getStringArg(toolResponse.arguments, 'summary')
  return {
    resumedLaunch: resolved,
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
  // Primary source: adapter-stamped launch root (zero scanning). Fallback: cross-message scan.
  const stampedLaunchId = tool?.name === AgentToolsType.SendMessage ? getPartLaunchToolCallId(toolResponse) : undefined
  const resumedLaunch = useMemo(() => {
    if (stampedLaunchId) return { toolCallId: stampedLaunchId }
    return resumedAgentId ? resolveResumedAgent(response, fullPartsMap) : undefined
  }, [response, fullPartsMap, resumedAgentId, stampedLaunchId])

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
  // Reuse the memoized launch resolution instead of re-scanning — buildResumeToolHeader keeps
  // its own scan for the group header, which has no memo here.
  const resumeHeader = buildResumeToolHeader(toolResponse, fullPartsMap, t, resumedLaunch)
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
        openFlowOnClick={isSubagentTool || (resumeHeader !== undefined && resumedLaunch !== undefined)}
        flowTargetToolCallId={resumedLaunch?.toolCallId}
        // The flow is the agent's whole timeline — keep its title the launch identity, not the
        // resume request's summary.
        flowTitle={resumedLaunch?.description ?? getAgentToolFlowTitle(tool?.name, args ?? parsedPartialArgs)}
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
