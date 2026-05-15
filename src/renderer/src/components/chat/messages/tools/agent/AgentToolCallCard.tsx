import { ToolDisclosure, type ToolDisclosureItem } from '../shared/ToolDisclosure'
import { StreamingContext, type ToolStatus, ToolStatusIndicator } from './GenericTools'
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
      <div className="flex w-full items-start justify-between gap-2">
        <div className="min-w-0">{renderedItem.label}</div>
        {status && (
          <div className="shrink-0">
            <ToolStatusIndicator status={status} hasError={hasError} />
          </div>
        )}
      </div>
    ),
    classNames: {
      body: 'max-h-96 overflow-scroll bg-foreground-50 p-2 text-foreground-900 dark:bg-foreground-100'
    }
  }

  return (
    <StreamingContext value={isStreaming}>
      <ToolDisclosure
        className="w-max max-w-full data-[expanded=true]:w-full"
        defaultActiveKey={[]}
        items={[toolContentItem]}
      />
    </StreamingContext>
  )
}
