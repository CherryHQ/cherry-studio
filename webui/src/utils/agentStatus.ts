import type {
  WebUiAgentStatusEvent,
  WebUiAgentTaskEventData,
  WebUiAgentTaskStatus,
  WebUiMessageSnapshot,
  WebUiToolCallState
} from '../types/api'

export type WebUiAgentTask = {
  readonly id: string
  readonly title: string
  readonly activeText?: string
  readonly status: WebUiAgentTaskStatus
}

export type WebUiAgentSubagent = {
  readonly id: string
  readonly name: string
  readonly status: 'running' | 'done' | 'error'
}

export type WebUiAgentArtifact = {
  readonly id: string
  readonly path: string
  readonly name: string
  readonly description?: string
}

export type WebUiAgentStatus = {
  readonly tasks: readonly WebUiAgentTask[]
  readonly completedTaskCount: number
  readonly totalTaskCount: number
  readonly subagents: readonly WebUiAgentSubagent[]
  readonly artifacts: readonly WebUiAgentArtifact[]
}

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const getString = (record: UnknownRecord, ...keys: string[]) => {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

const getTaskId = (record: UnknownRecord) => getString(record, 'taskId', 'task_id', 'id')

const getTaskTitle = (record: UnknownRecord, fallback?: string) =>
  getString(record, 'subject', 'title', 'description', 'summary') ?? fallback

const getTaskActiveText = (record: UnknownRecord) => getString(record, 'activeForm', 'activeText', 'active_text')

const normalizeTaskStatus = (value: unknown): WebUiAgentTaskStatus | undefined => {
  if (typeof value !== 'string') return undefined
  switch (value.toLowerCase().replaceAll('-', '_')) {
    case 'running':
    case 'in_progress':
      return 'in_progress'
    case 'done':
    case 'completed':
      return 'completed'
    case 'failed':
    case 'error':
      return 'error'
    case 'pending':
      return 'pending'
    default:
      return undefined
  }
}

const getNextTaskOrdinalId = (tasks: Map<string, WebUiAgentTask>) => {
  for (let index = 1; index <= tasks.size + 1; index += 1) {
    const id = String(index)
    if (!tasks.has(id)) return id
  }
  return undefined
}

const applyTaskTool = (tasks: Map<string, WebUiAgentTask>, event: Extract<WebUiAgentStatusEvent, { kind: 'tool' }>) => {
  const input = isRecord(event.input) ? event.input : {}
  const output = isRecord(event.output) ? event.output : {}

  if (event.name === 'TaskCreate') {
    const outputTask = isRecord(output.task) ? output.task : undefined
    const id = (outputTask ? getTaskId(outputTask) : undefined) ?? getNextTaskOrdinalId(tasks) ?? event.id
    const title = (outputTask ? getTaskTitle(outputTask) : undefined) ?? getTaskTitle(input, id) ?? id
    tasks.set(id, {
      id,
      title,
      ...(getTaskActiveText(input) ? { activeText: getTaskActiveText(input) } : {}),
      status: normalizeTaskStatus(outputTask?.status) ?? 'pending'
    })
    return
  }

  if (event.name === 'TaskUpdate') {
    const id = getTaskId(input) ?? getTaskId(output) ?? event.id
    const existing = tasks.get(id)
    const activeText = getTaskActiveText(input) ?? existing?.activeText
    tasks.set(id, {
      id,
      title: getTaskTitle(input, existing?.title ?? id) ?? existing?.title ?? id,
      ...(activeText ? { activeText } : {}),
      status: normalizeTaskStatus(input.status) ?? existing?.status ?? 'pending'
    })
    return
  }

  if (event.name !== 'TaskList' || !Array.isArray(output.tasks)) return
  for (const value of output.tasks) {
    if (!isRecord(value)) continue
    const id = getTaskId(value)
    const title = getTaskTitle(value, id)
    if (!id || !title) continue
    const existing = tasks.get(id)
    const activeText = getTaskActiveText(value) ?? existing?.activeText
    tasks.set(id, {
      id,
      title,
      ...(activeText ? { activeText } : {}),
      status: normalizeTaskStatus(value.status) ?? existing?.status ?? 'pending'
    })
  }
}

const applyTaskEvent = (tasks: Map<string, WebUiAgentTask>, data: WebUiAgentTaskEventData) => {
  const existing = tasks.get(data.taskId)
  const title = data.title?.trim() || data.summary?.trim() || data.description?.trim() || existing?.title
  if (!title) return
  const activeText = data.activeText?.trim() || data.description?.trim() || existing?.activeText
  tasks.set(data.taskId, {
    id: data.taskId,
    title,
    ...(activeText ? { activeText } : {}),
    status: normalizeTaskStatus(data.status) ?? existing?.status ?? 'pending'
  })
}

const getSubagentStatus = (state: WebUiToolCallState): WebUiAgentSubagent['status'] => {
  if (state === 'output-error' || state === 'output-denied') return 'error'
  if (state === 'output-available') return 'done'
  return 'running'
}

const applySubagent = (
  subagents: Map<string, WebUiAgentSubagent>,
  event: Extract<WebUiAgentStatusEvent, { kind: 'tool' }>
) => {
  if (event.name !== 'Agent' && event.name !== 'Task') return
  const input = isRecord(event.input) ? event.input : {}
  subagents.set(event.id, {
    id: event.id,
    name: getString(input, 'description', 'name', 'prompt') ?? event.name,
    status: getSubagentStatus(event.state)
  })
}

const applyArtifacts = (
  artifacts: Map<string, WebUiAgentArtifact>,
  event: Extract<WebUiAgentStatusEvent, { kind: 'tool' }>
) => {
  if (event.name !== 'report_artifacts' && !event.name.endsWith('__report_artifacts')) return
  const input = isRecord(event.input) ? event.input : {}
  if (!Array.isArray(input.artifacts)) return

  for (const value of input.artifacts) {
    if (!isRecord(value)) continue
    const path = getString(value, 'path')
    if (!path) continue
    const segments = path.split(/[/\\]+/).filter(Boolean)
    artifacts.set(path, {
      id: `${event.id}:${path}`,
      path,
      name: segments.at(-1) ?? path,
      ...(getString(value, 'description') ? { description: getString(value, 'description') } : {})
    })
  }
}

export const isWebUiAgentTaskEventData = (value: unknown): value is WebUiAgentTaskEventData => {
  if (!isRecord(value)) return false
  return (
    typeof value.taskId === 'string' &&
    ['started', 'progress', 'updated', 'notification'].includes(String(value.event))
  )
}

export const buildWebUiAgentStatus = (messages: readonly WebUiMessageSnapshot[]): WebUiAgentStatus => {
  const tasks = new Map<string, WebUiAgentTask>()
  const subagents = new Map<string, WebUiAgentSubagent>()
  const artifacts = new Map<string, WebUiAgentArtifact>()

  for (const message of messages) {
    for (const event of message.agentStatusEvents ?? []) {
      if (event.kind === 'task-event') {
        applyTaskEvent(tasks, event.data)
        continue
      }
      applyTaskTool(tasks, event)
      applySubagent(subagents, event)
      applyArtifacts(artifacts, event)
    }
  }

  const taskList = [...tasks.values()]
  return {
    tasks: taskList,
    completedTaskCount: taskList.filter((task) => task.status === 'completed').length,
    totalTaskCount: taskList.length,
    subagents: [...subagents.values()],
    artifacts: [...artifacts.values()]
  }
}
