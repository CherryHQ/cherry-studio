import { AgentToolsType, type TodoItem } from '@renderer/components/chat/messages/tools/agent/types'
import {
  getPartParentToolCallId,
  stripPartParentToolMetadata
} from '@renderer/components/chat/messages/tools/toolParentMetadata'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { CompactPartData } from '@shared/data/types/uiParts'
import { getToolName, isDataUIPart, isToolUIPart } from 'ai'

export type AgentRightPaneTab = 'files' | 'status' | `flow:${string}`

export interface AgentToolFlowOpenInput {
  toolCallId: string
  toolName?: string
  sourceMessageId?: string
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

export interface AgentStatusTask {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'completed' | 'error'
  activeText?: string
  source: 'todo' | 'task'
}

export interface AgentRightPaneStatus {
  tasks: AgentStatusTask[]
  activeTask?: AgentStatusTask
  completedTaskCount: number
  totalTaskCount: number
  latestCompactSummary?: string
  toolStats: {
    total: number
    active: number
    completed: number
    failed: number
  }
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

        assistantParts.push(stripPartParentToolMetadata(part))
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

function getLatestTodoItems(
  messages: CherryUIMessage[],
  partsByMessageId: Record<string, CherryMessagePart[]>
): TodoItem[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    const parts = partsByMessageId[message.id] ?? ((message.parts ?? []) as CherryMessagePart[])
    for (let j = parts.length - 1; j >= 0; j -= 1) {
      const part = parts[j]
      if (getToolNameFromPart(part) !== AgentToolsType.TodoWrite) continue
      const todos = (getToolPartInput(part) as { todos?: unknown }).todos
      return Array.isArray(todos) ? (todos as TodoItem[]) : []
    }
  }
  return []
}

function applyTaskToolPart(taskMap: Map<string, AgentStatusTask>, part: CherryMessagePart, fallbackId: string): void {
  const toolName = getToolNameFromPart(part)
  const input = getToolPartInput(part)
  const output = getToolPartOutput(part)

  if (toolName === AgentToolsType.TaskCreate) {
    const inputRecord = isRecord(input) ? input : {}
    const outputRecord = isRecord(output) ? output : {}
    const outputTask = isRecord(outputRecord.task) ? outputRecord.task : undefined
    const id = typeof outputTask?.id === 'string' ? outputTask.id : fallbackId
    const title =
      (typeof outputTask?.subject === 'string' && outputTask.subject) ||
      (typeof inputRecord.subject === 'string' && inputRecord.subject) ||
      id
    const activeText = typeof inputRecord.activeForm === 'string' ? inputRecord.activeForm : undefined
    taskMap.set(id, { id, title, activeText, status: 'pending', source: 'task' })
    return
  }

  if (toolName === AgentToolsType.TaskUpdate) {
    const inputRecord = isRecord(input) ? input : {}
    const id =
      (typeof inputRecord.taskId === 'string' && inputRecord.taskId) ||
      (isRecord(output) && typeof output.taskId === 'string' ? output.taskId : fallbackId)
    const existing = taskMap.get(id)
    const status = inputRecord.status === 'deleted' ? 'completed' : inputRecord.status
    taskMap.set(id, {
      id,
      title: (typeof inputRecord.subject === 'string' && inputRecord.subject) || existing?.title || id,
      activeText: (typeof inputRecord.activeForm === 'string' && inputRecord.activeForm) || existing?.activeText,
      status:
        status === 'pending' || status === 'in_progress' || status === 'completed'
          ? status
          : (existing?.status ?? 'pending'),
      source: 'task'
    })
    return
  }

  if (toolName === AgentToolsType.TaskList) {
    const tasks = isRecord(output) && Array.isArray(output.tasks) ? output.tasks : []
    for (const task of tasks) {
      if (!isRecord(task) || typeof task.id !== 'string') continue
      const status =
        task.status === 'pending' || task.status === 'in_progress' || task.status === 'completed'
          ? task.status
          : 'pending'
      taskMap.set(task.id, {
        id: task.id,
        title: typeof task.subject === 'string' && task.subject ? task.subject : task.id,
        status,
        source: 'task'
      })
    }
  }
}

export function buildAgentRightPaneStatus(
  messages: CherryUIMessage[],
  partsByMessageId: Record<string, CherryMessagePart[]>
): AgentRightPaneStatus {
  const taskMap = new Map<string, AgentStatusTask>()
  let latestCompactSummary: string | undefined
  const toolStats = { total: 0, active: 0, completed: 0, failed: 0 }

  const latestTodos = getLatestTodoItems(messages, partsByMessageId)
  latestTodos.forEach((todo, index) => {
    taskMap.set(`todo-${index}`, {
      id: `todo-${index}`,
      title: todo.content,
      activeText: todo.activeForm,
      status: todo.status,
      source: 'todo'
    })
  })

  for (const message of messages) {
    const parts = partsByMessageId[message.id] ?? ((message.parts ?? []) as CherryMessagePart[])
    parts.forEach((part, partIndex) => {
      if (isDataUIPart(part) && part.type === 'data-compact') {
        const content = (part.data as CompactPartData | undefined)?.content
        if (content?.trim()) latestCompactSummary = content
      }

      if (!isToolUIPart(part)) return
      toolStats.total += 1
      const state = getToolPartState(part)
      if (state === 'output-available') toolStats.completed += 1
      if (state === 'output-error') toolStats.failed += 1
      if (state === 'input-streaming' || state === 'input-available' || state === 'approval-requested') {
        toolStats.active += 1
      }
      applyTaskToolPart(taskMap, part, getToolCallId(part) ?? `${message.id}-${partIndex}`)
    })
  }

  const tasks = Array.from(taskMap.values())
  const completedTaskCount = tasks.filter((task) => task.status === 'completed').length
  const activeTask =
    tasks.find((task) => task.status === 'in_progress') ?? tasks.find((task) => task.status === 'pending')

  return {
    tasks,
    activeTask,
    completedTaskCount,
    totalTaskCount: tasks.length,
    latestCompactSummary,
    toolStats
  }
}
