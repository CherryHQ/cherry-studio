import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import { AgentToolDisclosure, AgentToolDisclosureLabel } from './AgentToolDisclosure'
import { type ToolStatus, ToolStatusIndicator } from './GenericTools'
import { isValidAgentToolsType, renderTool } from './toolRendererRegistry'
import type { ToolInput, ToolOutput } from './types'
import { UnknownToolRenderer } from './UnknownToolRenderer'

export function AgentToolCallCard({
  toolName,
  input,
  output,
  isStreaming = false,
  status,
  hasError = false
}: {
  toolName?: string
  input?: ToolInput | Record<string, unknown>
  output?: ToolOutput | unknown
  isStreaming?: boolean
  status?: ToolStatus
  hasError?: boolean
}) {
  const renderedItem = isValidAgentToolsType(toolName)
    ? renderTool(toolName, (input ?? {}) as Record<string, unknown>, output)
    : UnknownToolRenderer({ toolName: toolName ?? 'Tool', input, output })

  const toolContentItem: ToolDisclosureItem = {
    ...renderedItem,
    label: (
      <AgentToolDisclosureLabel
        label={renderedItem.label}
        trailing={
          status && (status !== 'done' || hasError) && <ToolStatusIndicator status={status} hasError={hasError} />
        }
      />
    ),
    classNames: {
      header: 'px-0 py-0 [--agent-tool-toggle-left:0px]',
      body: 'max-h-96 overflow-auto bg-transparent p-0 text-foreground-900 dark:bg-transparent'
    }
  }

  return (
    <AgentToolDisclosure
      className="w-full max-w-full rounded-none border-0 bg-transparent"
      isStreaming={isStreaming}
      item={toolContentItem}
    />
  )
}
