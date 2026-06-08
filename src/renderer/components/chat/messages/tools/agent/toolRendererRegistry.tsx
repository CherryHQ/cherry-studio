import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
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
import { TaskTool } from './TaskTool'
import { ToolSearchTool } from './ToolSearchTool'
import { AgentToolsType, type TaskToolInput, type TaskToolOutput, type ToolInput, type ToolOutput } from './types'
import { WebFetchTool } from './WebFetchTool'
import { WebSearchTool } from './WebSearchTool'
import { WriteTool } from './WriteTool'

export const toolRenderers = {
  [AgentToolsType.Agent]: ({ input, output }: { input?: unknown; output?: unknown }) =>
    TaskTool({
      input: input as TaskToolInput,
      output: output as TaskToolOutput,
      toolName: AgentToolsType.Agent
    }),
  [AgentToolsType.Read]: ReadTool,
  [AgentToolsType.Task]: TaskTool,
  [AgentToolsType.TaskOutput]: createStructuredAgentTool(AgentToolsType.TaskOutput),
  [AgentToolsType.TaskStop]: createStructuredAgentTool(AgentToolsType.TaskStop),
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
  [AgentToolsType.ToolSearch]: ToolSearchTool,
  [AgentToolsType.ListMcpResources]: createStructuredAgentTool(AgentToolsType.ListMcpResources),
  [AgentToolsType.ReadMcpResource]: createStructuredAgentTool(AgentToolsType.ReadMcpResource),
  [AgentToolsType.TaskCreate]: createStructuredAgentTool(AgentToolsType.TaskCreate),
  [AgentToolsType.TaskGet]: createStructuredAgentTool(AgentToolsType.TaskGet),
  [AgentToolsType.TaskUpdate]: createStructuredAgentTool(AgentToolsType.TaskUpdate),
  [AgentToolsType.TaskList]: createStructuredAgentTool(AgentToolsType.TaskList),
  [AgentToolsType.SendMessage]: createStructuredAgentTool(AgentToolsType.SendMessage),
  [AgentToolsType.TeamCreate]: createStructuredAgentTool(AgentToolsType.TeamCreate),
  [AgentToolsType.TeamDelete]: createStructuredAgentTool(AgentToolsType.TeamDelete),
  [AgentToolsType.EnterWorktree]: createStructuredAgentTool(AgentToolsType.EnterWorktree),
  [AgentToolsType.ExitWorktree]: createStructuredAgentTool(AgentToolsType.ExitWorktree)
}

export function renderTool(
  toolName: AgentToolsType,
  input: ToolInput | Record<string, unknown> | string | undefined,
  output?: ToolOutput | unknown
): ToolDisclosureItem {
  const renderer = toolRenderers[toolName] as (props: { input?: unknown; output?: unknown }) => ToolDisclosureItem
  return renderer({ input, output })
}

export function isValidAgentToolsType(toolName: unknown): toolName is AgentToolsType {
  return typeof toolName === 'string' && Object.values(AgentToolsType).includes(toolName as AgentToolsType)
}
