import type {
  AgentInput,
  AgentOutput,
  AskUserQuestionInput,
  AskUserQuestionOutput,
  BashInput,
  BashOutput,
  EnterWorktreeInput,
  EnterWorktreeOutput,
  ExitPlanModeInput,
  ExitPlanModeOutput,
  ExitWorktreeInput,
  ExitWorktreeOutput,
  FileEditInput,
  FileEditOutput,
  FileReadInput,
  FileReadOutput,
  FileWriteInput,
  FileWriteOutput,
  GlobInput,
  GlobOutput,
  GrepInput,
  GrepOutput,
  ListMcpResourcesInput,
  ListMcpResourcesOutput,
  NotebookEditInput,
  NotebookEditOutput,
  ReadMcpResourceInput,
  ReadMcpResourceOutput,
  TaskCreateInput,
  TaskCreateOutput,
  TaskGetInput,
  TaskGetOutput,
  TaskListInput,
  TaskListOutput,
  TaskOutputInput,
  TaskStopInput,
  TaskStopOutput,
  TaskUpdateInput,
  TaskUpdateOutput,
  TodoWriteInput,
  TodoWriteOutput,
  WebFetchInput,
  WebFetchOutput,
  WebSearchInput,
  WebSearchOutput,
  WorkflowInput,
  WorkflowOutput
} from '@anthropic-ai/claude-agent-sdk/sdk-tools'
import { TO_MARKDOWN_TOOL_NAME } from '@shared/ai/builtinTools'
import type { CherryMessagePart } from '@shared/data/types/message'
import * as z from 'zod'

import type { ToolDisclosureItem } from './ToolDisclosure'

export const AgentToolsType = {
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

export type AgentToolsType = (typeof AgentToolsType)[keyof typeof AgentToolsType]

export type TextOutput = {
  type: 'text'
  text: string
}

export interface SkillToolInput {
  /** Claude uses `skill`; dsh's native skill tool uses `name`. */
  skill?: string
  name?: string
  args?: string
}
export type SkillToolOutput = string | TextOutput[]

export type ReadToolInput = FileReadInput
export type ReadToolOutput = FileReadOutput | string | TextOutput[]

export type TaskToolInput = AgentInput
export type TaskToolOutput = AgentOutput | TextOutput[]

export type AgentToolInput = AgentInput
export type AgentToolOutput = AgentOutput | TextOutput[]

export type TaskOutputToolInput = TaskOutputInput
export type TaskOutputToolOutput = Record<string, unknown> | unknown[] | string

export type TaskStopToolInput = TaskStopInput
export type TaskStopToolOutput = TaskStopOutput | string

export type BashToolInput = BashInput
export type BashToolOutput = BashOutput | string

export type SearchToolInput = string
export type SearchToolOutput = string

export type GlobToolInput = GlobInput
export type GlobToolOutput = GlobOutput | string

export type TodoItem = Omit<TodoWriteInput['todos'][number], 'activeForm'> & { activeForm?: string }
export type TodoWriteToolInput = { todos: TodoItem[] }
export type TodoWriteToolOutput = TodoWriteOutput | string | TextOutput[]

export type WebSearchToolInput = WebSearchInput
export type WebSearchToolOutput = WebSearchOutput | string

export type WebFetchToolInput = WebFetchInput
export type WebFetchToolOutput = WebFetchOutput | string

export type GrepToolInput = GrepInput
export type GrepToolOutput = GrepOutput | string

export type WriteToolInput = FileWriteInput
export type WriteToolOutput = FileWriteOutput | string

export type EditToolInput = FileEditInput
export type EditToolOutput = FileEditOutput | string

export type MultiEditToolInput = {
  file_path: string
  edits: Array<{
    old_string: string
    new_string: string
    replace_all?: boolean
  }>
}
export type MultiEditToolOutput = string

export type BashOutputToolInput = Partial<TaskOutputInput> & {
  bash_id?: string
  filter?: string
}
export type BashOutputToolOutput = string

export type NotebookEditToolInput = NotebookEditInput
export type NotebookEditToolOutput = NotebookEditOutput | string

export type ExitPlanModeToolInput = ExitPlanModeInput & {
  plan?: string
}
export type ExitPlanModeToolOutput = ExitPlanModeOutput | string

export interface ToolSearchToolInput {
  query: string
  max_results?: number
}

export const ToolSearchToolOutputSchema = z.union([
  z.array(z.object({ type: z.literal('tool_reference'), tool_name: z.string() })),
  z.string()
])
export type ToolSearchToolOutput = z.infer<typeof ToolSearchToolOutputSchema>

export const AskUserQuestionOptionSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
  preview: z.string().optional()
})

export const AskUserQuestionItemSchema = z.object({
  question: z.string(),
  header: z.string(),
  options: z.array(AskUserQuestionOptionSchema).min(2).max(4),
  multiSelect: z.boolean().default(false)
})

export const AskUserQuestionAnswerSchema = z.record(z.string(), z.string())

export const AskUserQuestionToolInputSchema = z.object({
  questions: z.array(AskUserQuestionItemSchema).min(1).max(4),
  answers: AskUserQuestionAnswerSchema.optional(),
  annotations: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
})

type SDKAskUserQuestionItem = AskUserQuestionInput['questions'][number]
type SDKAskUserQuestionOption = SDKAskUserQuestionItem['options'][number]

export type AskUserQuestionOption = Omit<SDKAskUserQuestionOption, 'description'> & {
  description?: string
}
export type AskUserQuestionItem = Omit<SDKAskUserQuestionItem, 'options'> & {
  options: AskUserQuestionOption[]
}
export type AskUserQuestionToolInput = Omit<AskUserQuestionInput, 'questions'> & {
  questions: AskUserQuestionItem[]
}
export type AskUserQuestionToolOutput = AskUserQuestionOutput
export type AskUserQuestionAnswer = NonNullable<AskUserQuestionInput['answers']>

export function isAskUserQuestionToolName(toolName: unknown): boolean {
  return toolName === AgentToolsType.AskUserQuestion || toolName === 'builtin_AskUserQuestion'
}

/** cherry-tools document converter — an MCP tool, so it is keyed by its runtime wire name. */
export const TO_MARKDOWN_RUNTIME_TOOL_NAME = `mcp__cherry-tools__${TO_MARKDOWN_TOOL_NAME}`

/**
 * Whether an `Agent`/`Task` result is a launch receipt for a subagent that is still running. A
 * detached subagent returns immediately, so its tool call reaches a terminal state while the work has
 * barely started — the tool call finished, the task did not.
 */
export function isBackgroundAgentOutput(output: AgentToolOutput | undefined): boolean {
  if (!output || Array.isArray(output)) return false
  return output.status === 'async_launched' || output.status === 'remote_launched'
}

/**
 * Safely parse AskUserQuestionToolInput from unknown data.
 * Returns undefined if the data doesn't match the expected structure.
 */
export function parseAskUserQuestionToolInput(value: unknown): AskUserQuestionToolInput | undefined {
  const result = AskUserQuestionToolInputSchema.safeParse(value)
  return result.success ? (result.data as AskUserQuestionToolInput) : undefined
}

export type ListMcpResourcesToolInput = ListMcpResourcesInput
export type ListMcpResourcesToolOutput = ListMcpResourcesOutput | string

export type ReadMcpResourceToolInput = ReadMcpResourceInput
export type ReadMcpResourceToolOutput = ReadMcpResourceOutput | string

export type KillBashToolInput = TaskStopInput
export type KillBashToolOutput = TaskStopOutput | string

export type TaskCreateToolInput = TaskCreateInput
export type TaskCreateToolOutput = TaskCreateOutput | string

export type TaskGetToolInput = TaskGetInput
export type TaskGetToolOutput = TaskGetOutput | string

export type TaskUpdateToolInput = TaskUpdateInput
export type TaskUpdateToolOutput = TaskUpdateOutput | string

export type TaskListToolInput = TaskListInput
export type TaskListToolOutput = TaskListOutput | string

export type EnterWorktreeToolInput = EnterWorktreeInput
export type EnterWorktreeToolOutput = EnterWorktreeOutput | string

export type ExitWorktreeToolInput = ExitWorktreeInput
export type ExitWorktreeToolOutput = ExitWorktreeOutput | string

/** The Workflow tool always launches in the background, so its result is a launch receipt. */
export type WorkflowToolInput = WorkflowInput
export type WorkflowToolOutput = WorkflowOutput | string

// Agent-teams tools are runtime/experimental (not in the SDK typed union) — loosely typed.
export type SendMessageToolInput = { to?: string; message?: string } & Record<string, unknown>
export type SendMessageToolOutput = string

/** The background agent a SendMessage receipt points at: `resumedAgentId` when it woke a stopped
 *  agent, or `pin.id` when the target was still running and the message was queued for delivery. */
export function getResumedAgentId(output: unknown): string | undefined {
  if (typeof output === 'string') {
    return (
      /"resumedAgentId"\s*:\s*"([^"]+)"/.exec(output)?.[1] ??
      /"pin"\s*:\s*\{[^}]*"id"\s*:\s*"([^"]+)"/.exec(output)?.[1]
    )
  }
  if (output && typeof output === 'object') {
    const record = output as { resumedAgentId?: unknown; pin?: unknown }
    if (typeof record.resumedAgentId === 'string') return record.resumedAgentId
    if (record.pin && typeof record.pin === 'object' && typeof (record.pin as { id?: unknown }).id === 'string') {
      return (record.pin as { id: string }).id
    }
  }
  return undefined
}

/**
 * Resolve a SendMessage receipt back to the agent run it continues: the resumed agent keeps
 * streaming under its launch tool-call id, so entries must point at that launch. Returns the
 * launch's toolCallId and description (which doubles as the agent's identity).
 */
/** A candidate Agent/Task output is the launch receipt for `resumedAgentId` when its serialized
 *  form mentions the id: the id is session-scoped and generated at launch time, so the earliest
 *  matching part is always the launch itself, and any textual trailer check would break whenever
 *  the CLI rewords its receipt between versions. */
function isLaunchReceiptFor(output: unknown, resumedAgentId: string): boolean {
  // Only output that carries the launch receipt's `agentId:` trailer (or an equivalent structured
  // field) may resolve as the launch: a serialized mention inside another part's reply would
  // otherwise redirect the entry to an unrelated flow.
  if (typeof output === 'string') return /\bagent_?[Ii]d\s*:\s*/.test(output) && output.includes(resumedAgentId)
  if (isRecord(output)) {
    const agentId = output.agentId ?? output.agent_id
    return typeof agentId === 'string' && agentId === resumedAgentId
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function resolveResumedAgent(
  output: unknown,
  fullPartsMap: Record<string, CherryMessagePart[]> | null
): { toolCallId: string; description?: string } | undefined {
  const resumedAgentId = getResumedAgentId(output)
  if (!resumedAgentId || !fullPartsMap) return undefined
  // First registration wins, mirroring the task-row binding: the launch receipt is the earliest
  // part that can reference this id, and later mentions (a quote inside another part's output)
  // must not redirect the entry.
  for (const parts of Object.values(fullPartsMap)) {
    for (const part of parts) {
      const record = part as { toolName?: unknown; toolCallId?: unknown; input?: unknown; output?: unknown }
      if (
        (record.toolName === AgentToolsType.Agent || record.toolName === AgentToolsType.Task) &&
        typeof record.toolCallId === 'string' &&
        isLaunchReceiptFor(record.output, resumedAgentId)
      ) {
        const input = record.input
        // A blank description must fall through to the prompt, or the continuation identity and
        // the flow title render empty.
        const description =
          input && typeof input === 'object' && typeof (input as { description?: unknown }).description === 'string'
            ? (input as { description: string }).description.trim() || undefined
            : undefined
        return {
          toolCallId: record.toolCallId,
          description:
            description ??
            (input && typeof input === 'object' && typeof (input as { prompt?: unknown }).prompt === 'string'
              ? (input as { prompt: string }).prompt
                  .split(/\r?\n/)
                  .find((line) => line.trim())
                  ?.trim()
              : undefined)
        }
      }
    }
  }
  return undefined
}
export type TeamCreateToolInput = Record<string, unknown>
export type TeamCreateToolOutput = string
export type TeamDeleteToolInput = Record<string, unknown>
export type TeamDeleteToolOutput = string

export type ToolInput =
  | SkillToolInput
  | AgentToolInput
  | ReadToolInput
  | TaskOutputToolInput
  | TaskStopToolInput
  | BashToolInput
  | BashOutputToolInput
  | SearchToolInput
  | GlobToolInput
  | TodoWriteToolInput
  | WebSearchToolInput
  | GrepToolInput
  | WriteToolInput
  | WebFetchToolInput
  | EditToolInput
  | MultiEditToolInput
  | NotebookEditToolInput
  | ExitPlanModeToolInput
  | ListMcpResourcesToolInput
  | ReadMcpResourceToolInput
  | AskUserQuestionToolInput
  | ToolSearchToolInput
  | TaskCreateToolInput
  | TaskGetToolInput
  | TaskUpdateToolInput
  | TaskListToolInput
  | SendMessageToolInput
  | TeamCreateToolInput
  | TeamDeleteToolInput
  | EnterWorktreeToolInput
  | ExitWorktreeToolInput
  | WorkflowToolInput

export type ToolOutput =
  | SkillToolOutput
  | AgentToolOutput
  | ReadToolOutput
  | TaskToolOutput
  | TaskOutputToolOutput
  | TaskStopToolOutput
  | BashToolOutput
  | GlobToolOutput
  | TodoWriteToolOutput
  | WebSearchToolOutput
  | GrepToolOutput
  | WriteToolOutput
  | WebFetchToolOutput
  | EditToolOutput
  | NotebookEditToolOutput
  | ExitPlanModeToolOutput
  | ListMcpResourcesToolOutput
  | ReadMcpResourceToolOutput
  | KillBashToolOutput
  | AskUserQuestionToolOutput
  | ToolSearchToolOutput
  | TaskCreateToolOutput
  | TaskGetToolOutput
  | TaskUpdateToolOutput
  | TaskListToolOutput
  | EnterWorktreeToolOutput
  | ExitWorktreeToolOutput
  | WorkflowToolOutput

export interface ToolRenderer {
  render: (props: { input: ToolInput; output?: ToolOutput }) => React.ReactElement
}

export interface ToolInputMap {
  [AgentToolsType.Skill]: SkillToolInput
  [AgentToolsType.Agent]: AgentToolInput
  [AgentToolsType.Read]: ReadToolInput
  [AgentToolsType.Task]: TaskToolInput
  [AgentToolsType.TaskOutput]: TaskOutputToolInput
  [AgentToolsType.TaskStop]: TaskStopToolInput
  [AgentToolsType.Bash]: BashToolInput
  [AgentToolsType.Search]: SearchToolInput
  [AgentToolsType.Glob]: GlobToolInput
  [AgentToolsType.TodoWrite]: TodoWriteToolInput
  [AgentToolsType.WebSearch]: WebSearchToolInput
  [AgentToolsType.Grep]: GrepToolInput
  [AgentToolsType.Write]: WriteToolInput
  [AgentToolsType.WebFetch]: WebFetchToolInput
  [AgentToolsType.Edit]: EditToolInput
  [AgentToolsType.MultiEdit]: MultiEditToolInput
  [AgentToolsType.BashOutput]: BashOutputToolInput
  [AgentToolsType.NotebookEdit]: NotebookEditToolInput
  [AgentToolsType.ExitPlanMode]: ExitPlanModeToolInput
  [AgentToolsType.AskUserQuestion]: AskUserQuestionToolInput
  [AgentToolsType.ToolSearch]: ToolSearchToolInput
  [AgentToolsType.ListMcpResources]: ListMcpResourcesToolInput
  [AgentToolsType.ReadMcpResource]: ReadMcpResourceToolInput
  [AgentToolsType.TaskCreate]: TaskCreateToolInput
  [AgentToolsType.TaskGet]: TaskGetToolInput
  [AgentToolsType.TaskUpdate]: TaskUpdateToolInput
  [AgentToolsType.TaskList]: TaskListToolInput
  [AgentToolsType.SendMessage]: SendMessageToolInput
  [AgentToolsType.TeamCreate]: TeamCreateToolInput
  [AgentToolsType.TeamDelete]: TeamDeleteToolInput
  [AgentToolsType.EnterWorktree]: EnterWorktreeToolInput
  [AgentToolsType.ExitWorktree]: ExitWorktreeToolInput
  [AgentToolsType.Workflow]: WorkflowToolInput
}

export interface ToolOutputMap {
  [AgentToolsType.Skill]: SkillToolOutput
  [AgentToolsType.Agent]: AgentToolOutput
  [AgentToolsType.Read]: ReadToolOutput
  [AgentToolsType.Task]: TaskToolOutput
  [AgentToolsType.TaskOutput]: TaskOutputToolOutput
  [AgentToolsType.TaskStop]: TaskStopToolOutput
  [AgentToolsType.Bash]: BashToolOutput
  [AgentToolsType.Search]: SearchToolOutput
  [AgentToolsType.Glob]: GlobToolOutput
  [AgentToolsType.TodoWrite]: TodoWriteToolOutput
  [AgentToolsType.WebSearch]: WebSearchToolOutput
  [AgentToolsType.Grep]: GrepToolOutput
  [AgentToolsType.Write]: WriteToolOutput
  [AgentToolsType.WebFetch]: WebFetchToolOutput
  [AgentToolsType.Edit]: EditToolOutput
  [AgentToolsType.MultiEdit]: MultiEditToolOutput
  [AgentToolsType.BashOutput]: BashOutputToolOutput
  [AgentToolsType.NotebookEdit]: NotebookEditToolOutput
  [AgentToolsType.ExitPlanMode]: ExitPlanModeToolOutput
  [AgentToolsType.AskUserQuestion]: AskUserQuestionToolOutput
  [AgentToolsType.ToolSearch]: ToolSearchToolOutput
  [AgentToolsType.ListMcpResources]: ListMcpResourcesToolOutput
  [AgentToolsType.ReadMcpResource]: ReadMcpResourceToolOutput
  [AgentToolsType.TaskCreate]: TaskCreateToolOutput
  [AgentToolsType.TaskGet]: TaskGetToolOutput
  [AgentToolsType.TaskUpdate]: TaskUpdateToolOutput
  [AgentToolsType.TaskList]: TaskListToolOutput
  [AgentToolsType.SendMessage]: SendMessageToolOutput
  [AgentToolsType.TeamCreate]: TeamCreateToolOutput
  [AgentToolsType.TeamDelete]: TeamDeleteToolOutput
  [AgentToolsType.EnterWorktree]: EnterWorktreeToolOutput
  [AgentToolsType.ExitWorktree]: ExitWorktreeToolOutput
  [AgentToolsType.Workflow]: WorkflowToolOutput
}

export type ToolRendererProps<T extends AgentToolsType = AgentToolsType> = {
  input?: ToolInputMap[T]
  output?: ToolOutputMap[T]
  /** True when the tool call finished with an error response. */
  hasError?: boolean
}

export type ToolRendererFn<T extends AgentToolsType = AgentToolsType> = (
  props: ToolRendererProps<T>
) => ToolDisclosureItem

export type ToolRenderersMap = Partial<{
  [T in AgentToolsType]: ToolRendererFn<T>
}>
