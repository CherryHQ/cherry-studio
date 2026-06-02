import { useAppSelector } from '@renderer/store'
import { selectPendingPermission } from '@renderer/store/toolPermissions'
import type { NormalToolResponse } from '@renderer/types'
import type { CollapseProps } from 'antd'
import { Collapse } from 'antd'
import { ChevronRight } from 'lucide-react'
import { parse as parsePartialJson } from 'partial-json'
import { useMemo } from 'react'
import styled from 'styled-components'

// 导出所有类型
export * from './types'

// 导入所有渲染器
import { AskUserQuestionCard } from '../AskUserQuestionCard'
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
      <div className="flex w-full items-center justify-between gap-2">
        <div className="min-w-0 flex-1">{renderedItem.label}</div>
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
      <ToolCollapse
        expandIconPosition="end"
        size="small"
        defaultActiveKey={toolName === AgentToolsType.TodoWrite ? [AgentToolsType.TodoWrite] : []}
        items={[toolContentItem]}
        expandIcon={({ isActive }) => (
          <ExpandIconContainer $isActive={isActive}>
            <ChevronRight size={18} color="var(--color-text-3)" strokeWidth={1.5} />
          </ExpandIconContainer>
        )}
      />
    </StreamingContext>
  )
}

const ToolCollapse = styled(Collapse)`
  width: 100%;
  max-width: 100%;
  border: 0.5px solid var(--color-border) !important;
  border-radius: 10px !important;
  overflow: hidden;

  > .ant-collapse-item {
    border-bottom: none !important;
  }

  > .ant-collapse-item > .ant-collapse-header {
    box-sizing: border-box !important;
    height: 38px !important;
    min-height: 38px !important;
    padding: 0 !important;
    display: flex !important;
    align-items: center !important;
  }

  > .ant-collapse-item > .ant-collapse-header .ant-collapse-expand-icon {
    height: 38px !important;
    width: 40px;
    padding: 0 !important;
    margin-inline-start: 0 !important;
    color: var(--color-text-3) !important;
    display: flex !important;
    align-items: center;
    justify-content: center;
  }

  > .ant-collapse-item > .ant-collapse-header .ant-collapse-header-text {
    height: 38px !important;
    min-width: 0;
    display: flex !important;
    align-items: center !important;
    flex: 1 !important;
  }

  > .ant-collapse-item > .ant-collapse-content {
    border-top: 0.5px solid var(--color-border) !important;
  }
`

const ExpandIconContainer = styled.div<{ $isActive?: boolean }>`
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-3);
  transition: transform 150ms;
  transform: ${({ $isActive }) => ($isActive ? 'rotate(90deg)' : 'rotate(0deg)')};
  flex-shrink: 0;

  svg {
    color: var(--color-text-3);
    stroke: var(--color-text-3);
  }
`

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
