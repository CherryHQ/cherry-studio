import { useOptionalMessageListActions } from '../../MessageListProvider'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import { extractToolErrorText } from '../toolError'
import { AgentToolDisclosure, AgentToolDisclosureLabel } from './AgentToolDisclosure'
import { type ToolStatus, ToolStatusIndicator } from './GenericTools'
import { isValidAgentToolsType, renderTool } from './toolRendererRegistry'
import { AgentToolsType, type ToolInput, type ToolOutput } from './types'
import { UnknownToolRenderer } from './UnknownToolRenderer'

function shouldShowHeaderErrorText(toolName: string | undefined, renderedItem: ToolDisclosureItem) {
  return renderedItem.children === undefined || renderedItem.children === null || toolName === AgentToolsType.Write
}

function getAgentToolFlowTitle(toolName: string | undefined, input: ToolInput | Record<string, unknown> | undefined) {
  if (typeof input === 'string') return input.trim() || toolName
  if (!input || typeof input !== 'object' || Array.isArray(input)) return toolName

  const inputEntries = Object.entries(input)
  for (const key of ['description', 'subject', 'title', 'name']) {
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
  openFlowOnClick = false,
  showInlineDetails = true
}: {
  toolCallId?: string
  toolName?: string
  input?: ToolInput | Record<string, unknown>
  output?: ToolOutput
  isStreaming?: boolean
  status?: ToolStatus
  hasError?: boolean
  openFlowOnClick?: boolean
  showInlineDetails?: boolean
}) {
  const actions = useOptionalMessageListActions()
  const renderedItem = isValidAgentToolsType(toolName)
    ? renderTool(toolName, input ?? {}, output)
    : UnknownToolRenderer({ toolName: toolName ?? 'Tool', input, output })
  const openToolFlow =
    openFlowOnClick && actions?.openAgentToolFlow && toolCallId
      ? () =>
          actions.openAgentToolFlow?.({
            toolCallId,
            toolName,
            title: getAgentToolFlowTitle(toolName, input)
          })
      : undefined
  const errorText = shouldShowHeaderErrorText(toolName, renderedItem) ? extractToolErrorText(output) : undefined

  const toolContentItem: ToolDisclosureItem = {
    ...renderedItem,
    label: (
      <AgentToolDisclosureLabel
        label={renderedItem.label}
        trailing={
          status &&
          (status !== 'done' || hasError) && (
            <ToolStatusIndicator status={status} hasError={hasError} errorText={errorText} />
          )
        }
      />
    ),
    classNames: {
      header: 'min-h-7 px-0 py-0.5 font-normal text-[13px] leading-5 text-foreground-secondary'
    }
  }
  const canShowInlineDetails =
    showInlineDetails && renderedItem.children !== undefined && renderedItem.children !== null

  return (
    <AgentToolDisclosure
      className="w-full max-w-full rounded-none border-0 bg-transparent"
      isStreaming={isStreaming}
      item={toolContentItem}
      onOpenDetails={openToolFlow}
      showInlineDetails={canShowInlineDetails}
    />
  )
}
