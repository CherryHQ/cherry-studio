import { Accordion } from '@heroui/react'
import { loggerService } from '@logger'
import { NormalToolResponse } from '@renderer/types'

// 导出所有类型
export * from './types'

// 导入所有渲染器
import { BashTool } from './BashTool'
import { GlobTool } from './GlobTool'
import { GrepTool } from './GrepTool'
import { ReadTool } from './ReadTool'
import { SearchTool } from './SearchTool'
import { TaskTool } from './TaskTool'
import { TodoWriteTool } from './TodoWriteTool'
import { AgentToolsType, ToolInput, ToolOutput } from './types'
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
  [AgentToolsType.Write]: WriteTool
} as const

// 类型守卫函数
export function isValidAgentToolsType(toolName: unknown): toolName is AgentToolsType {
  return typeof toolName === 'string' && Object.values(AgentToolsType).includes(toolName as AgentToolsType)
}

// 统一的渲染函数
function renderToolContent(toolName: AgentToolsType, input: ToolInput, output?: ToolOutput) {
  const Renderer = toolRenderers[toolName]
  if (!Renderer) {
    logger.error('Unknown tool type', { toolName })
    return <div>Unknown tool type: {toolName}</div>
  }

  return (
    <Accordion
      className="w-max max-w-full"
      itemClasses={{
        trigger:
          'p-0 [&>div:first-child]:!flex-none [&>div:first-child]:flex [&>div:first-child]:flex-col [&>div:first-child]:text-start'
      }}>
      {/* <Renderer input={input as any} output={output as any} /> */}
      {Renderer({ input: input as any, output: output as any })}
    </Accordion>
  )
}

// 统一的组件渲染入口
export function MessageAgentTools({ toolResponse }: { toolResponse: NormalToolResponse }) {
  const { arguments: args, response, tool } = toolResponse
  logger.info('Rendering agent tool response', {
    tool: tool,
    arguments: args,
    response
  })

  // 使用类型守卫确保类型安全
  if (!isValidAgentToolsType(tool?.name)) {
    logger.warn('Invalid tool name received', { toolName: tool?.name })
    return (
      <div className="rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
        <div className="text-red-600 text-sm dark:text-red-400">Invalid tool name: {tool?.name}</div>
      </div>
    )
  }

  const toolName = tool.name

  return renderToolContent(toolName, args as ToolInput, response as ToolOutput)
}
