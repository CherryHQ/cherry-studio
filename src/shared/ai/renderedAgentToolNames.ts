import { AGENT_RUNTIME_CAPABILITIES } from './agentRuntimeCapabilities'

export const RENDERED_AGENT_TOOL_NAMES = {
  Skill: 'Skill',
  Agent: 'Agent',
  Read: 'Read',
  Task: 'Task',
  TaskOutput: 'TaskOutput',
  TaskStop: 'TaskStop',
  Bash: 'Bash',
  Search: 'Search',
  Glob: 'Glob',
  TodoWrite: 'TodoWrite',
  WebSearch: 'WebSearch',
  Grep: 'Grep',
  Write: 'Write',
  WebFetch: 'WebFetch',
  Edit: 'Edit',
  MultiEdit: 'MultiEdit',
  BashOutput: 'BashOutput',
  NotebookEdit: 'NotebookEdit',
  ExitPlanMode: 'ExitPlanMode',
  AskUserQuestion: 'AskUserQuestion',
  ToolSearch: 'ToolSearch',
  ListMcpResources: 'ListMcpResources',
  ReadMcpResource: 'ReadMcpResource',
  TaskCreate: 'TaskCreate',
  TaskGet: 'TaskGet',
  TaskUpdate: 'TaskUpdate',
  TaskList: 'TaskList',
  SendMessage: 'SendMessage',
  TeamCreate: 'TeamCreate',
  TeamDelete: 'TeamDelete',
  EnterWorktree: 'EnterWorktree',
  ExitWorktree: 'ExitWorktree',
  Workflow: 'Workflow'
} as const

export type RenderedAgentToolName = (typeof RENDERED_AGENT_TOOL_NAMES)[keyof typeof RENDERED_AGENT_TOOL_NAMES]

const CHERRY_AGENT_TRANSPORTS: ReadonlySet<string> = new Set(
  Object.values(AGENT_RUNTIME_CAPABILITIES).map((caps) => caps.transport)
)

/**
 * Runtime-native tool names (pi/dsh lower-case identities) mapped onto the shared agent-tool card
 * name. Single source of truth for canonical tool-name normalization: the renderer resolves a
 * part's card name (`getCanonicalToolName`) and the shared no-response guard judges turn
 * visibility from the same mapping — dynamic provider tools are carded by canonical name.
 */
export const CHERRY_RUNTIME_TOOL_RENDER_NAMES: ReadonlyMap<string, RenderedAgentToolName> = new Map([
  ['bash', RENDERED_AGENT_TOOL_NAMES.Bash],
  ['pwsh', RENDERED_AGENT_TOOL_NAMES.Bash],
  ['edit', RENDERED_AGENT_TOOL_NAMES.Edit],
  ['exit_plan_mode', RENDERED_AGENT_TOOL_NAMES.ExitPlanMode],
  ['read', RENDERED_AGENT_TOOL_NAMES.Read],
  ['skill', RENDERED_AGENT_TOOL_NAMES.Skill],
  ['subagent', RENDERED_AGENT_TOOL_NAMES.Task],
  ['subagent_fork', RENDERED_AGENT_TOOL_NAMES.Task],
  ['todo_write', RENDERED_AGENT_TOOL_NAMES.TodoWrite],
  ['write', RENDERED_AGENT_TOOL_NAMES.Write]
])

/** True when provider metadata carries a known cherry runtime transport tag. */
export function hasCherryTransportTag(metadata: unknown): boolean {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return false
  const cherry = (metadata as { cherry?: unknown }).cherry
  if (typeof cherry !== 'object' || cherry === null || Array.isArray(cherry)) return false
  const transport = (cherry as { transport?: unknown }).transport
  return typeof transport === 'string' && CHERRY_AGENT_TRANSPORTS.has(transport)
}

/**
 * Canonical card name for a tool call: parts tagged with a cherry runtime transport map their
 * runtime-native tool name onto the shared agent-tool name; everything else keeps its wire name.
 */
export function toRenderedAgentToolName(toolName: string, callProviderMetadata: unknown): string {
  return hasCherryTransportTag(callProviderMetadata)
    ? (CHERRY_RUNTIME_TOOL_RENDER_NAMES.get(toolName) ?? toolName)
    : toolName
}
