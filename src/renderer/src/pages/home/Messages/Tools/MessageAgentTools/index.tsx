import { Accordion } from '@heroui/react'
import { loggerService } from '@logger'
import type { NormalToolResponse } from '@renderer/types'

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

// 统一的渲染函数
function renderToolContent(toolName: AgentToolsType, input: ToolInput, output?: ToolOutput) {
  const Renderer = toolRenderers[toolName]

  return (
    <div className="w-max max-w-full rounded-md bg-foreground-100 py-1 transition-all duration-300 ease-in-out dark:bg-foreground-100">
      <Accordion
        className="w-max max-w-full"
        itemClasses={{
          trigger:
            'p-0 [&>div:first-child]:!flex-none [&>div:first-child]:flex [&>div:first-child]:flex-col [&>div:first-child]:text-start [&>div:first-child]:max-w-full',
          indicator: 'flex-shrink-0',
          subtitle: 'text-xs',
          content:
            'rounded-md bg-foreground-50 p-2 text-foreground-900 dark:bg-foreground-100 max-h-96 p-2 overflow-scroll',
          base: 'space-y-1'
        }}
        defaultExpandedKeys={toolName === AgentToolsType.TodoWrite ? [AgentToolsType.TodoWrite] : []}>
        {Renderer
          ? Renderer({ input: input as any, output: output as any })
          : UnknownToolRenderer({ input: input as any, output: output as any, toolName })}
      </Accordion>
    </div>
  )
}

// 统一的组件渲染入口
export function MessageAgentTools({ toolResponse }: { toolResponse: NormalToolResponse }) {
  const { arguments: args, response, tool, status } = toolResponse
  logger.info('Rendering agent tool response', {
    tool: tool,
    arguments: args,
    response
  })

  if (status === 'pending') {
    return <ToolPermissionRequestCard toolResponse={toolResponse} />
  }

  return renderToolContent(tool.name as AgentToolsType, args as ToolInput, response as ToolOutput)
}
