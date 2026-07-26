import {
  getTaskActiveText,
  getTaskId,
  getTaskTitle,
  isTaskRecord,
  normalizeTaskStatus
} from '@renderer/components/chat/messages/tools/agent'
import { AgentToolsType } from '@renderer/components/chat/messages/tools/shared/agentToolTypes'
import {
  getPartParentToolCallId,
  stripPartParentToolMetadata
} from '@renderer/components/chat/messages/tools/toolParentMetadata'
import type { AgentSessionTaskEvents } from '@shared/ai/agentSessionBackgroundTasks'
import { REPORT_ARTIFACTS_TOOL_NAME, reportArtifactsInputSchema } from '@shared/ai/builtinTools'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { AgentTaskEventPartData } from '@shared/data/types/uiParts'
import { getToolName, isDataUIPart, isToolUIPart } from 'ai'

export type AgentRightPaneTab = 'files' | 'status' | `flow:${string}`

export interface AgentToolFlowOpenInput {
  toolCallId: string
  toolName?: string
  title?: string
}

export interface AgentToolFlowNode {
  toolCallId: string
  toolName: string
  parentToolCallId?: string
  messageId: string
  partIndex: number
  state?: string
}

export interface AgentToolFlowProjection {
  selectedTool?: AgentToolFlowNode
  toolNodes: AgentToolFlowNode[]
  selectedToolCallIds: Set<string>
  messages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
}

/**
 * An item on the main agent's own plan, written via `TaskCreate` / `TaskUpdate` / `TaskList`.
 * Completion is meaningful here, so this is the only list with a done/total ratio.
 */
export interface AgentStatusTask {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'completed' | 'error'
  activeText?: string
}

/**
 * A process the run spawned — a subagent, shell or workflow — reported through the SDK's task
 * lifecycle events. It either runs or it settles; a done/total ratio over these would be
 * meaningless, which is why they are kept apart from the plan above.
 */
export interface AgentRunTask {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'completed' | 'error'
  activeText?: string
  /** SDK task type, e.g. 'subagent' | 'shell' | 'local_workflow'. */
  taskType?: string
  subagentType?: string
  workflowName?: string
  outputFile?: string
  usage?: AgentTaskEventPartData['usage']
}

/** A final deliverable file the agent declared via the `report_artifacts` tool. */
export interface AgentArtifactFile {
  toolCallId: string
  path: string
  name: string
  description?: string
}

export interface AgentRightPaneStatus {
  tasks: AgentStatusTask[]
  completedTaskCount: number
  totalTaskCount: number
  runTasks: AgentRunTask[]
  artifacts: AgentArtifactFile[]
}

const strippedParentMetadataCache = new WeakMap<object, CherryMessagePart>()

function getPartWithoutParentMetadata(part: CherryMessagePart): CherryMessagePart {
  if (typeof part !== 'object' || part === null) return stripPartParentToolMetadata(part)
  const cached = strippedParentMetadataCache.get(part)
  if (cached) return cached
  const stripped = stripPartParentToolMetadata(part)
  strippedParentMetadataCache.set(part, stripped)
  return stripped
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getToolCallId(part: CherryMessagePart): string | undefined {
  const toolCallId = (part as unknown as { toolCallId?: unknown }).toolCallId
  return typeof toolCallId === 'string' && toolCallId ? toolCallId : undefined
}

function getToolPartState(part: CherryMessagePart): string | undefined {
  const state = (part as unknown as { state?: unknown }).state
  return typeof state === 'string' ? state : undefined
}

function getToolPartInput(part: CherryMessagePart): unknown {
  return (part as unknown as { input?: unknown }).input
}

function getToolPartOutput(part: CherryMessagePart): unknown {
  const output = (part as unknown as { output?: unknown }).output
  if (isRecord(output) && 'content' in output) return output.content
  return output
}

function getToolNameFromPart(part: CherryMessagePart): string | undefined {
  if (!isToolUIPart(part)) return undefined
  const toolName = getToolName(part)
  return toolName.trim() || undefined
}

function textFromContent(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (Array.isArray(value)) {
    const text = value
      .map((item) => {
        if (typeof item === 'string') return item
        if (isRecord(item) && typeof item.text === 'string') return item.text
        return undefined
      })
      .filter(Boolean)
      .join('\n')
      .trim()
    return text || undefined
  }
  if (!isRecord(value)) return undefined

  for (const key of ['content', 'result', 'message', 'text', 'prompt']) {
    const text = textFromContent(value[key])
    if (text) return text
  }

  const json = JSON.stringify(value, null, 2)
  return json === '{}' ? undefined : json
}

function getToolPromptText(part: CherryMessagePart | undefined): string | undefined {
  if (!part) return undefined
  const input = getToolPartInput(part)
  if (typeof input === 'string') return input.trim() || undefined
  if (!isRecord(input)) return undefined

  return textFromContent(input.prompt) ?? textFromContent(input.description)
}

function getToolOutputText(part: CherryMessagePart | undefined): string | undefined {
  if (!part) return undefined
  return textFromContent(getToolPartOutput(part))
}

function createFlowTextMessage(
  id: string,
  role: CherryUIMessage['role'],
  text: string | undefined,
  createdAt: string
): CherryUIMessage | undefined {
  if (!text?.trim()) return undefined
  return {
    id,
    role,
    parts: [{ type: 'text', text }] as CherryMessagePart[],
    metadata: {
      createdAt,
      status: role === 'assistant' ? 'success' : undefined
    }
  } as CherryUIMessage
}

function getMessageCreatedAt(message: CherryUIMessage | undefined): string {
  const createdAt = (message as unknown as { createdAt?: unknown } | undefined)?.createdAt
  return message?.metadata?.createdAt ?? (typeof createdAt === 'string' ? createdAt : new Date(0).toISOString())
}

function getOrderedMessageParts(
  messages: CherryUIMessage[],
  partsByMessageId: Record<string, CherryMessagePart[]>
): Array<{ message: CherryUIMessage; parts: CherryMessagePart[] }> {
  const entries = messages.map((message) => ({
    message,
    parts: partsByMessageId[message.id] ?? ((message.parts ?? []) as CherryMessagePart[])
  }))
  const seenMessageIds = new Set(messages.map((message) => message.id))

  for (const [messageId, parts] of Object.entries(partsByMessageId)) {
    if (seenMessageIds.has(messageId)) continue
    entries.push({
      message: {
        id: messageId,
        role: 'assistant',
        parts,
        metadata: {
          status: 'pending',
          createdAt: new Date(0).toISOString()
        }
      } as CherryUIMessage,
      parts
    })
  }

  return entries
}

function isTerminalToolState(state: string | undefined): boolean {
  return state === 'output-available' || state === 'output-error' || state === 'output-denied' || state === 'cancelled'
}

export function buildAgentToolFlowProjection(
  messages: CherryUIMessage[],
  partsByMessageId: Record<string, CherryMessagePart[]>,
  selectedToolCallId?: string
): AgentToolFlowProjection {
  const toolNodes: AgentToolFlowNode[] = []
  const childrenByParent = new Map<string, string[]>()
  const toolPartByCallId = new Map<string, CherryMessagePart>()
  const messageById = new Map(messages.map((message) => [message.id, message]))
  const messageEntries = getOrderedMessageParts(messages, partsByMessageId)

  for (const { message, parts } of messageEntries) {
    messageById.set(message.id, message)
    parts.forEach((part, partIndex) => {
      if (!isToolUIPart(part)) return
      const toolCallId = getToolCallId(part)
      if (!toolCallId) return

      const parentToolCallId = getPartParentToolCallId(part)
      const node: AgentToolFlowNode = {
        toolCallId,
        toolName: getToolNameFromPart(part) ?? toolCallId,
        parentToolCallId,
        messageId: message.id,
        partIndex,
        state: getToolPartState(part)
      }
      toolNodes.push(node)
      toolPartByCallId.set(toolCallId, part)
      if (parentToolCallId) {
        const children = childrenByParent.get(parentToolCallId) ?? []
        children.push(toolCallId)
        childrenByParent.set(parentToolCallId, children)
      }
    })
  }

  const selectedToolCallIds = new Set<string>()
  if (selectedToolCallId) {
    selectedToolCallIds.add(selectedToolCallId)
    const stack = [...(childrenByParent.get(selectedToolCallId) ?? [])]
    while (stack.length) {
      const toolCallId = stack.pop()
      if (!toolCallId || selectedToolCallIds.has(toolCallId)) continue
      selectedToolCallIds.add(toolCallId)
      stack.push(...(childrenByParent.get(toolCallId) ?? []))
    }
  }

  const flowMessages: CherryUIMessage[] = []
  const flowPartsByMessageId: Record<string, CherryMessagePart[]> = {}

  if (selectedToolCallIds.size) {
    const selectedTool = toolNodes.find((node) => node.toolCallId === selectedToolCallId)
    const selectedToolPart = selectedToolCallId ? toolPartByCallId.get(selectedToolCallId) : undefined
    const selectedMessage = selectedTool ? messageById.get(selectedTool.messageId) : undefined
    const selectedCreatedAt = getMessageCreatedAt(selectedMessage)
    const promptMessage = createFlowTextMessage(
      `${selectedToolCallId}:agent-flow-prompt`,
      'user',
      getToolPromptText(selectedToolPart),
      selectedCreatedAt
    )
    if (promptMessage) {
      flowMessages.push(promptMessage)
      flowPartsByMessageId[promptMessage.id] = promptMessage.parts as CherryMessagePart[]
    }

    const assistantParts: CherryMessagePart[] = []
    for (const { parts } of messageEntries) {
      for (let partIndex = 0; partIndex < parts.length; partIndex++) {
        const part = parts[partIndex]
        const toolCallId = getToolCallId(part)
        if (toolCallId) {
          if (toolCallId === selectedToolCallId || !selectedToolCallIds.has(toolCallId)) continue
        } else {
          const parentToolCallId = getPartParentToolCallId(part)
          if (!parentToolCallId || !selectedToolCallIds.has(parentToolCallId)) continue
        }

        assistantParts.push(getPartWithoutParentMetadata(part))
      }
    }

    const outputText = getToolOutputText(selectedToolPart)
    if (outputText) assistantParts.push({ type: 'text', text: outputText } as CherryMessagePart)
    const isFlowActive = toolNodes.some(
      (node) => selectedToolCallIds.has(node.toolCallId) && !isTerminalToolState(node.state)
    )
    if (assistantParts.length || isFlowActive) {
      const assistantMessage = {
        id: `${selectedToolCallId}:agent-flow-assistant`,
        role: 'assistant',
        parts: assistantParts,
        metadata: {
          createdAt: selectedCreatedAt,
          status: isFlowActive ? 'pending' : 'success'
        }
      } as CherryUIMessage
      flowMessages.push(assistantMessage)
      flowPartsByMessageId[assistantMessage.id] = assistantParts
    }
  }

  return {
    selectedTool: selectedToolCallId ? toolNodes.find((node) => node.toolCallId === selectedToolCallId) : undefined,
    toolNodes,
    selectedToolCallIds,
    messages: flowMessages,
    partsByMessageId: flowPartsByMessageId
  }
}

function applyTaskToolPart(taskMap: Map<string, AgentStatusTask>, part: CherryMessagePart, fallbackId: string): void {
  const toolName = getToolNameFromPart(part)
  const input = getToolPartInput(part)
  const output = getToolPartOutput(part)

  if (toolName === AgentToolsType.TaskCreate) {
    const inputRecord = isTaskRecord(input) ? input : {}
    const outputRecord = isTaskRecord(output) ? output : {}
    const outputTask = isTaskRecord(outputRecord.task) ? outputRecord.task : undefined
    const id = (outputTask ? getTaskId(outputTask) : undefined) ?? getNextTaskOrdinalId(taskMap) ?? fallbackId
    const title = (outputTask ? getTaskTitle(outputTask) : undefined) ?? getTaskTitle(inputRecord, id) ?? id
    const activeText = getTaskActiveText(inputRecord)
    taskMap.set(id, { id, title, activeText, status: 'pending' })
    return
  }

  if (toolName === AgentToolsType.TaskUpdate) {
    const inputRecord = isTaskRecord(input) ? input : {}
    const id = getTaskId(inputRecord) ?? (isTaskRecord(output) ? getTaskId(output) : undefined) ?? fallbackId
    const existing = taskMap.get(id)
    const status = normalizeTaskStatus(inputRecord.status)
    taskMap.set(id, {
      id,
      title: getTaskTitle(inputRecord, existing?.title ?? id) ?? existing?.title ?? id,
      activeText: getTaskActiveText(inputRecord) ?? existing?.activeText,
      status: status ?? existing?.status ?? 'pending'
    })
    return
  }

  if (toolName === AgentToolsType.TaskList) {
    const tasks = isTaskRecord(output) && Array.isArray(output.tasks) ? output.tasks : []
    for (const task of tasks) {
      if (!isTaskRecord(task)) continue
      const id = getTaskId(task)
      const title = getTaskTitle(task, id)
      if (!id || !title) continue
      taskMap.set(id, {
        id,
        title,
        status: normalizeTaskStatus(task.status) ?? 'pending'
      })
    }
  }
}

function getNextTaskOrdinalId(taskMap: Map<string, AgentStatusTask>): string | undefined {
  for (let index = 1; index <= taskMap.size + 1; index += 1) {
    const id = String(index)
    if (!taskMap.has(id)) return id
  }
  return undefined
}

const RUN_TASK_TERMINAL_STATUSES = new Set<AgentRunTask['status']>(['completed', 'error'])

function applyAgentTaskEvent(runTaskMap: Map<string, AgentRunTask>, data: AgentTaskEventPartData): void {
  const existing = runTaskMap.get(data.taskId)
  // A completion's summary is prose, not a name — it must never become the row title.
  const title = data.title?.trim() || data.description?.trim() || existing?.title
  if (!title) return

  // Events reach this map from two orderings (message parts, then the late-event cache), so a stale
  // pre-completion event can apply after the completion did. A settled task never resurrects.
  const incoming = data.status ?? existing?.status ?? 'pending'
  const status =
    existing && RUN_TASK_TERMINAL_STATUSES.has(existing.status) && !RUN_TASK_TERMINAL_STATUSES.has(incoming)
      ? existing.status
      : incoming

  runTaskMap.set(data.taskId, {
    id: data.taskId,
    title,
    activeText: data.activeText ?? data.description ?? existing?.activeText,
    status,
    taskType: data.taskType ?? existing?.taskType,
    subagentType: data.subagentType ?? existing?.subagentType,
    workflowName: data.workflowName ?? existing?.workflowName,
    outputFile: data.outputFile ?? existing?.outputFile,
    usage: data.usage ?? existing?.usage
  })
}

function isReportArtifactsTool(toolName: string | undefined): boolean {
  return toolName === REPORT_ARTIFACTS_TOOL_NAME || (toolName?.endsWith(`__${REPORT_ARTIFACTS_TOOL_NAME}`) ?? false)
}

function getPathBasename(path: string): string {
  const segments = path
    .trim()
    .split(/[/\\]+/)
    .filter(Boolean)
  return segments.at(-1) ?? path
}

export function buildAgentRightPaneStatus(
  messages: CherryUIMessage[],
  partsByMessageId: Record<string, CherryMessagePart[]>,
  /**
   * Lifecycle that arrived after the spawning turn closed, so it never became a message part.
   * Applied last, by task id, so a background task's completion settles the row the parts built.
   */
  lateTaskEvents: AgentSessionTaskEvents = {}
): AgentRightPaneStatus {
  const taskMap = new Map<string, AgentStatusTask>()
  const runTaskMap = new Map<string, AgentRunTask>()
  const artifactByPath = new Map<string, AgentArtifactFile>()

  for (const message of messages) {
    const parts = partsByMessageId[message.id] ?? ((message.parts ?? []) as CherryMessagePart[])
    parts.forEach((part, partIndex) => {
      if (isDataUIPart(part) && part.type === 'data-agent-task-event') {
        applyAgentTaskEvent(runTaskMap, part.data)
      }

      if (!isToolUIPart(part)) return
      const fallbackId = getToolCallId(part) ?? `${message.id}-${partIndex}`
      applyTaskToolPart(taskMap, part, fallbackId)

      const toolName = getToolNameFromPart(part)
      if (isReportArtifactsTool(toolName)) {
        const parsed = reportArtifactsInputSchema.safeParse(getToolPartInput(part))
        if (parsed.success) {
          for (const artifact of parsed.data.artifacts) {
            const path = artifact.path.trim()
            if (!path) continue
            artifactByPath.set(path, {
              toolCallId: fallbackId,
              path,
              name: getPathBasename(path),
              description: artifact.description
            })
          }
        }
      }
    })
  }

  for (const data of Object.values(lateTaskEvents)) {
    applyAgentTaskEvent(runTaskMap, data)
  }

  // The SDK's task tools share one id space with spawned runs, so `TaskList` output can echo a
  // running subagent back into the plan. The runs section owns those ids; keep the plan to items
  // that are only ever plan.
  for (const id of runTaskMap.keys()) {
    taskMap.delete(id)
  }

  const tasks = Array.from(taskMap.values())
  const completedTaskCount = tasks.filter((task) => task.status === 'completed').length

  return {
    tasks,
    completedTaskCount,
    totalTaskCount: tasks.length,
    runTasks: Array.from(runTaskMap.values()),
    artifacts: Array.from(artifactByPath.values())
  }
}
