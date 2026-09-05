import { SESSION_CREATE_TOOL_NAME, SESSION_SEND_TOOL_NAME } from '@shared/ai/agentSessionDelivery'
import type { ReactNode } from 'react'

import { useOptionalMessageListActions } from '../../MessageListProvider'
import {
  AgentToolsType,
  TO_MARKDOWN_RUNTIME_TOOL_NAME,
  type ToolInput,
  type ToolOutput
} from '../shared/agentToolTypes'
import { type ToolStatus, ToolStatusIndicator } from '../shared/GenericTools'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import { extractToolErrorText } from '../toolError'
import { AgentToolDisclosure, AgentToolDisclosureLabel } from './AgentToolDisclosure'
import { SessionCreateTool } from './SessionCreateTool'
import { SessionSendTool } from './SessionSendTool'
import { ToMarkdownTool } from './ToMarkdownTool'
import { isValidAgentToolsType, renderTool } from './toolRendererRegistry'
import { UnknownToolRenderer } from './UnknownToolRenderer'

function shouldShowHeaderErrorText(toolName: string | undefined, renderedItem: ToolDisclosureItem) {
  return renderedItem.children === undefined || renderedItem.children === null || toolName === AgentToolsType.Write
}

export function getAgentToolFlowTitle(
  toolName: string | undefined,
  input: ToolInput | Record<string, unknown> | undefined
) {
  if (typeof input === 'string') return input.trim() || toolName
  if (!input || typeof input !== 'object' || Array.isArray(input)) return toolName

  const inputEntries = Object.entries(input)
  for (const key of ['description', 'subject', 'title', 'name', 'summary']) {
    const value = inputEntries.find(([field]) => field === key)?.[1]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }

  const prompt = inputEntries.find(([field]) => field === 'prompt')?.[1]
  if (typeof prompt === 'string')
    return (
      prompt
        .split(/\r?\n/)
        .find((line) => line.trim())
        ?.trim() || toolName
    )

  return toolName
}

export function AgentToolCallCard({
  toolCallId,
  toolName,
  input,
  output,
  isStreaming = false,
  status,
  hasError = false,
  isCherrySessionTool = false,
  openFlowOnClick = false,
  flowTargetToolCallId,
  flowTitle,
  labelOverride,
  showInlineDetails = true
}: {
  toolCallId?: string
  toolName?: string
  input?: ToolInput | Record<string, unknown>
  output?: ToolOutput
  isStreaming?: boolean
  status?: ToolStatus
  hasError?: boolean
  isCherrySessionTool?: boolean
  openFlowOnClick?: boolean
  /** Opens a different flow than this card's own call — e.g. a resume entry pointing at the launch root. */
  flowTargetToolCallId?: string
  /** Title for the opened flow; by default derived from this card's input. */
  flowTitle?: string
  /** Replaces the renderer's label — used when a caller knows a more identifying one. */
  labelOverride?: ReactNode
  showInlineDetails?: boolean
}) {
  const actions = useOptionalMessageListActions()
  const renderedItem =
    isCherrySessionTool &&
    (toolName === SESSION_CREATE_TOOL_NAME || toolName === `mcp__cherry-tools__${SESSION_CREATE_TOOL_NAME}`)
      ? SessionCreateTool({ input, output, hasError, isStreaming, status })
      : isCherrySessionTool &&
          (toolName === SESSION_SEND_TOOL_NAME || toolName === `mcp__cherry-tools__${SESSION_SEND_TOOL_NAME}`)
        ? SessionSendTool({ input, output, hasError, isStreaming, status })
        : isValidAgentToolsType(toolName)
          ? renderTool(toolName, input ?? {}, output, hasError)
          : toolName === TO_MARKDOWN_RUNTIME_TOOL_NAME
            ? ToMarkdownTool({ input, output })
            : UnknownToolRenderer({ toolName: toolName ?? 'Tool', input, output })
  const openToolFlow =
    openFlowOnClick && actions?.openAgentToolFlow && toolCallId
      ? () =>
          actions.openAgentToolFlow?.({
            toolCallId: flowTargetToolCallId ?? toolCallId,
            toolName,
            title: flowTitle ?? getAgentToolFlowTitle(toolName, input)
          })
      : undefined
  const errorText = shouldShowHeaderErrorText(toolName, renderedItem) ? extractToolErrorText(output) : undefined

  const toolContentItem: ToolDisclosureItem = {
    ...renderedItem,
    label: (
      <AgentToolDisclosureLabel
        label={
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="min-w-0">{labelOverride ?? renderedItem.label}</div>
            {status && (status !== 'done' || hasError) && (
              <ToolStatusIndicator status={status} hasError={hasError} errorText={errorText} />
            )}
          </div>
        }
      />
    ),
    classNames: {
      header: 'min-h-7 px-0 py-0.5 font-normal text-[13px] leading-5 text-muted-foreground'
    }
  }
  const canShowInlineDetails =
    showInlineDetails && renderedItem.children !== undefined && renderedItem.children !== null

  return (
    <AgentToolDisclosure
      className="w-full max-w-full rounded-none border-0 bg-transparent"
      defaultActiveKey={isStreaming && toolName === AgentToolsType.Workflow ? [String(renderedItem.key)] : []}
      isStreaming={isStreaming}
      item={toolContentItem}
      onOpenDetails={openToolFlow}
      stateId={toolCallId}
      showInlineDetails={canShowInlineDetails}
    />
  )
}
