import { AgentToolsType, type ToolInputMap, type ToolOutputMap, type ToolRenderersMap } from '../shared/agentToolTypes'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import type { ToolDisplayProps, ToolDisplayRenderer } from '../shared/toolDisplay'
import { AgentTool } from './AgentTool'
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
import { createStructuredAgentTool } from './StructuredAgentTool'
import { TaskCreateTool, TaskGetTool, TaskListTool, TaskOutputTool, TaskStopTool, TaskUpdateTool } from './TaskTool'
import { TodoWriteTool } from './TodoWriteTool'
import { ToolSearchTool } from './ToolSearchTool'
import { WebFetchTool } from './WebFetchTool'
import { WebSearchTool } from './WebSearchTool'
import { WorkflowTool } from './WorkflowTool'
import { WriteTool } from './WriteTool'

const AGENT_TOOL_VALUES = new Set<string>(Object.values(AgentToolsType))

const rawToolRenderers: Partial<Record<AgentToolsType, ToolDisplayRenderer>> = {
  [AgentToolsType.Agent]: AgentTool,
  [AgentToolsType.Read]: ReadTool,
  [AgentToolsType.Task]: createStructuredAgentTool(AgentToolsType.Task),
  [AgentToolsType.TaskOutput]: TaskOutputTool,
  [AgentToolsType.TaskStop]: TaskStopTool,
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
  [AgentToolsType.Skill]: SkillTool,
  [AgentToolsType.ToolSearch]: ToolSearchTool,
  [AgentToolsType.ListMcpResources]: createStructuredAgentTool(AgentToolsType.ListMcpResources),
  [AgentToolsType.ReadMcpResource]: createStructuredAgentTool(AgentToolsType.ReadMcpResource),
  [AgentToolsType.TaskCreate]: TaskCreateTool,
  [AgentToolsType.TaskGet]: TaskGetTool,
  [AgentToolsType.TaskUpdate]: TaskUpdateTool,
  [AgentToolsType.TaskList]: TaskListTool,
  [AgentToolsType.SendMessage]: createStructuredAgentTool(AgentToolsType.SendMessage),
  [AgentToolsType.TeamCreate]: createStructuredAgentTool(AgentToolsType.TeamCreate),
  [AgentToolsType.TeamDelete]: createStructuredAgentTool(AgentToolsType.TeamDelete),
  [AgentToolsType.EnterWorktree]: createStructuredAgentTool(AgentToolsType.EnterWorktree),
  [AgentToolsType.ExitWorktree]: createStructuredAgentTool(AgentToolsType.ExitWorktree),
  [AgentToolsType.Workflow]: WorkflowTool
}

export const toolRenderers: ToolRenderersMap = rawToolRenderers

export function renderRawTool(toolName: AgentToolsType, props: ToolDisplayProps): ToolDisclosureItem {
  const renderer = rawToolRenderers[toolName]

  return renderer ? renderer(props) : { key: toolName, label: null }
}

export function renderTool<T extends AgentToolsType>(
  toolName: T,
  input?: ToolInputMap[T],
  output?: ToolOutputMap[T],
  hasError?: boolean
): ToolDisclosureItem {
  return renderRawTool(toolName, { input, output, hasError })
}

export function isValidAgentToolsType(toolName: unknown): toolName is AgentToolsType {
  return typeof toolName === 'string' && AGENT_TOOL_VALUES.has(toolName)
}
