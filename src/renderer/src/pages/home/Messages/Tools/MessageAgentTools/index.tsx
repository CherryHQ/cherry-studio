import { useAppSelector } from '@renderer/store'
import { selectPendingPermission } from '@renderer/store/toolPermissions'
import type { NormalToolResponse } from '@renderer/types'
import type { CollapseProps } from 'antd'
import { Collapse } from 'antd'
import { parse as parsePartialJson } from 'partial-json'
import { useMemo } from 'react'

// 导出所有类型
export * from './types'

// 导入所有渲染器
import ToolPermissionRequestCard from '../ToolPermissionRequestCard'
import { BashOutputTool } from './BashOutputTool'
import { BashTool } from './BashTool'
import { EditTool } from './EditTool'
import { ExitPlanModeTool } from './ExitPlanModeTool'
import { getEffectiveStatus, StreamingContext, type ToolStatus, ToolStatusIndicator } from './GenericTools'
import { GlobTool } from './GlobTool'
import { GrepTool } from './GrepTool'
import { MultiEditTool } from './MultiEditTool'
import { NotebookEditTool } from './NotebookEditTool'
import { ReadTool } from './ReadTool'
import { SearchTool } from './SearchTool'
import { SkillTool } from './SkillTool'
import { TaskTool } from './TaskTool'
import { TodoWriteTool } from './TodoWriteTool'
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
  [AgentToolsType.TodoWrite]: TodoWriteTool,
  [AgentToolsType.WebSearch]: WebSearchTool,
  [AgentToolsType.Grep]: GrepTool,
  [AgentToolsType.Write]: WriteTool,
  [AgentToolsType.WebFetch]: WebFetchTool,
  [AgentToolsType.Edit]: EditTool,
  [AgentToolsType.MultiEdit]: MultiEditTool,
  [AgentToolsType.BashOutput]: BashOutputTool,
  [AgentToolsType.NotebookEdit]: NotebookEditTool,
  [AgentToolsType.ExitPlanMode]: ExitPlanModeTool,
  [AgentToolsType.Skill]: SkillTool
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
): NonNullable<CollapseProps['items']>[number] {
  const renderer = toolRenderers[toolName] as (props: {
    input?: unknown
    output?: unknown
  }) => NonNullable<CollapseProps['items']>[number]
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

  const toolContentItem: NonNullable<CollapseProps['items']>[number] = {
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
      body: 'bg-foreground-50 p-2 text-foreground-900 dark:bg-foreground-100 max-h-96 overflow-scroll'
    }
  }

  return (
    <StreamingContext value={isStreaming}>
      <Collapse
        className="w-max max-w-full"
        expandIconPosition="end"
        size="small"
        defaultActiveKey={toolName === AgentToolsType.TodoWrite ? [AgentToolsType.TodoWrite] : []}
        items={[toolContentItem]}
      />
    </StreamingContext>
  )
}

// 统一的组件渲染入口
export function MessageAgentTools({ toolResponse }: { toolResponse: NormalToolResponse }) {
  const { arguments: args, response, tool, status, partialArguments } = toolResponse

  const pendingPermission = useAppSelector((state) =>
    selectPendingPermission(state.toolPermissions, toolResponse.toolCallId)
  )

  const parsedPartialArgs = useMemo(() => {
    if (!partialArguments) return undefined
    try {
      return parsePartialJson(partialArguments)
    } catch {
      return undefined
    }
  }, [partialArguments])

  const effectiveStatus = getEffectiveStatus(status, !!pendingPermission)

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
