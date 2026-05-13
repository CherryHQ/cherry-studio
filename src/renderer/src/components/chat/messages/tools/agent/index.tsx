import { usePartsMap } from '@renderer/components/chat/messages/blocks'
import type { NormalToolResponse } from '@renderer/types'
import { parse as parsePartialJson } from 'partial-json'
import { useDeferredValue, useMemo } from 'react'

import { isToolPartAwaitingApproval } from '../toolResponse'

// 导出所有类型
export * from './types'

// 导入所有渲染器
import { AskUserQuestionCard } from '../AskUserQuestionCard'
import { ToolDisclosure, type ToolDisclosureItem } from '../shared/ToolDisclosure'
import ToolPermissionRequestCard from '../ToolPermissionRequestCard'
import { BashOutputTool } from './BashOutputTool'
import { BashTool } from './BashTool'
import { EditTool } from './EditTool'
import { ExitPlanModeTool } from './ExitPlanModeTool'
import { getEffectiveStatus, StreamingContext, type ToolStatus, ToolStatusIndicator } from './GenericTools'
import { GlobTool } from './GlobTool'
import { GrepTool } from './GrepTool'
import { MultiEditTool } from './MultiEditTool'
import { NavigateToolInline } from './NavigateTool'
import { NotebookEditTool } from './NotebookEditTool'
import { ReadTool } from './ReadTool'
import { SearchTool } from './SearchTool'
import { SkillTool } from './SkillTool'
import { TaskTool } from './TaskTool'
import { ToolSearchTool } from './ToolSearchTool'
import type { ToolInput, ToolOutput } from './types'
import { AgentToolsType } from './types'
import { UnknownToolRenderer } from './UnknownToolRenderer'
import { WebFetchTool } from './WebFetchTool'
import { WebSearchTool } from './WebSearchTool'
import { WriteTool } from './WriteTool'

// 创建工具渲染器映射
export const toolRenderers = {
  [AgentToolsType.Read]: ReadTool,
  [AgentToolsType.Task]: TaskTool,
  [AgentToolsType.Bash]: BashTool,
  [AgentToolsType.Search]: SearchTool,
  [AgentToolsType.Glob]: GlobTool,
  [AgentToolsType.WebSearch]: WebSearchTool,
  [AgentToolsType.Grep]: GrepTool,
  [AgentToolsType.Write]: WriteTool,
  [AgentToolsType.WebFetch]: WebFetchTool,
  [AgentToolsType.Edit]: EditTool,
  [AgentToolsType.MultiEdit]: MultiEditTool,
  [AgentToolsType.BashOutput]: BashOutputTool,
  [AgentToolsType.NotebookEdit]: NotebookEditTool,
  [AgentToolsType.ExitPlanMode]: ExitPlanModeTool,
  [AgentToolsType.Skill]: SkillTool,
  [AgentToolsType.ToolSearch]: ToolSearchTool
}

/**
 * Type-safe tool renderer invocation function.
 * Use this function to call a tool renderer with proper type checking,
 * avoiding the need for `as any` type assertions at call sites.
 *
 * @param toolName - The name of the tool (must be a valid AgentToolsType)
 * @param input - The input for the tool (accepts various input formats)
 * @param output - Optional output from the tool
 * @returns The rendered collapse item
 */
export function renderTool(
  toolName: AgentToolsType,
  input: ToolInput | Record<string, unknown> | string | undefined,
  output?: ToolOutput | unknown
): ToolDisclosureItem {
  const renderer = toolRenderers[toolName] as (props: { input?: unknown; output?: unknown }) => ToolDisclosureItem
  return renderer({ input, output })
}

// 类型守卫函数
export function isValidAgentToolsType(toolName: unknown): toolName is AgentToolsType {
  return typeof toolName === 'string' && Object.values(AgentToolsType).includes(toolName as AgentToolsType)
}

function ToolContent({
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
        defaultActiveKey={toolName === AgentToolsType.TodoWrite ? [AgentToolsType.TodoWrite] : []}
        items={[toolContentItem]}
      />
    </StreamingContext>
  )
}

// 统一的组件渲染入口
export function AgentToolRenderer({ toolResponse }: { toolResponse: NormalToolResponse }) {
  const { arguments: args, response, tool, status, partialArguments } = toolResponse

  const partsMap = usePartsMap()
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

  // Navigate tool renders as a simple inline button, not a tool card
  if (tool?.name === 'mcp__assistant__navigate') {
    return <NavigateToolInline input={args ?? parsedPartialArgs} output={response} />
  }

  // AskUserQuestion uses a unified card for both pending and completed states
  if (tool?.name === AgentToolsType.AskUserQuestion) {
    const isLoading = status === 'streaming' || status === 'invoking'
    return (
      <StreamingContext value={isLoading}>
        <AskUserQuestionCard toolResponse={toolResponse} />
      </StreamingContext>
    )
  }

  // TodoWrite tools are always shown in PinnedTodoPanel, never in message stream
  if (tool?.name === AgentToolsType.TodoWrite) {
    return null
  }

  const effectiveStatus = getEffectiveStatus(status, awaitingApproval)

  if (effectiveStatus === 'waiting') {
    return <ToolPermissionRequestCard toolResponse={toolResponse} />
  }

  const isLoading = effectiveStatus === 'streaming' || effectiveStatus === 'invoking'
  return (
    <ToolContent
      toolName={tool?.name}
      input={args ?? parsedPartialArgs}
      output={isLoading ? undefined : response}
      isStreaming={isLoading}
      status={effectiveStatus}
      hasError={status === 'error'}
    />
  )
}
