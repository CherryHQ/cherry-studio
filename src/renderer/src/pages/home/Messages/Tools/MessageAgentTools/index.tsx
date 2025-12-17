import { loggerService } from '@logger'
import { useAppSelector } from '@renderer/store'
import { selectPendingPermission } from '@renderer/store/toolPermissions'
import type { NormalToolResponse } from '@renderer/types'
import type { CollapseProps } from 'antd'
import { Collapse, Spin } from 'antd'
import { useTranslation } from 'react-i18next'

// 导出所有类型
export * from './types'

// 导入所有渲染器
import ToolPermissionRequestCard from '../ToolPermissionRequestCard'
import { BashOutputTool } from './BashOutputTool'
import { BashTool } from './BashTool'
import { EditTool } from './EditTool'
import { ExitPlanModeTool } from './ExitPlanModeTool'
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

const logger = loggerService.withContext('MessageAgentTools')

// 创建工具渲染器映射，这样就实现了完全的类型安全
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
} as const

// 类型守卫函数
export function isValidAgentToolsType(toolName: unknown): toolName is AgentToolsType {
  return typeof toolName === 'string' && Object.values(AgentToolsType).includes(toolName as AgentToolsType)
}

// 统一的渲染组件
function ToolContent({ toolName, input, output }: { toolName: AgentToolsType; input: ToolInput; output?: ToolOutput }) {
  const Renderer = toolRenderers[toolName]
  const renderedItem = Renderer
    ? Renderer({ input: input as any, output: output as any })
    : UnknownToolRenderer({ input: input as any, output: output as any, toolName })

  const toolContentItem: NonNullable<CollapseProps['items']>[number] = {
    ...renderedItem,
    classNames: {
      body: 'bg-foreground-50 p-2 text-foreground-900 dark:bg-foreground-100 max-h-96 p-2 overflow-scroll'
    }
  }

  return (
    <Collapse
      className="w-max max-w-full"
      expandIconPosition="end"
      size="small"
      defaultActiveKey={toolName === AgentToolsType.TodoWrite ? [AgentToolsType.TodoWrite] : []}
      items={[toolContentItem]}
    />
  )
}

// 统一的组件渲染入口
export function MessageAgentTools({ toolResponse }: { toolResponse: NormalToolResponse }) {
  const { arguments: args, response, tool, status } = toolResponse
  logger.debug('Rendering agent tool response', {
    tool: tool,
    arguments: args,
    status,
    response
  })

  const pendingPermission = useAppSelector((state) =>
    selectPendingPermission(state.toolPermissions, toolResponse.toolCallId)
  )

  if (status === 'pending') {
    if (pendingPermission) {
      return <ToolPermissionRequestCard toolResponse={toolResponse} />
    }
    return <ToolPendingIndicator toolName={tool?.name} description={tool?.description} />
  }

  return (
    <ToolContent toolName={tool.name as AgentToolsType} input={args as ToolInput} output={response as ToolOutput} />
  )
}

function ToolPendingIndicator({ toolName, description }: { toolName?: string; description?: string }) {
  const { t } = useTranslation()
  const label = toolName || t('agent.toolPermission.toolPendingFallback', 'Tool')
  const detail = description?.trim() || t('agent.toolPermission.executing')

  return (
    <div className="flex w-full max-w-xl items-center gap-3 rounded-xl border border-default-200 bg-default-100 px-4 py-3 shadow-sm">
      <Spin size="small" />
      <div className="flex flex-col gap-1">
        <span className="font-semibold text-default-700 text-sm">{label}</span>
        <span className="text-default-500 text-xs">{detail}</span>
      </div>
    </div>
  )
}
