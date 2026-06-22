export type NormalizedTaskStatus = 'pending' | 'in_progress' | 'completed' | 'error'

type TaskScalar = string | number | null | undefined

export interface TaskRecordLike {
  id?: TaskScalar
  taskId?: TaskScalar
  task_id?: TaskScalar
  subject?: TaskScalar
  task?: TaskScalar | TaskRecordLike
  description?: TaskScalar
  activeForm?: TaskScalar
  activeText?: TaskScalar
  status?: TaskScalar
  tasks?: TaskRecordLike[]
}

export interface NormalizedTaskLike {
  id?: string
  title?: string
  activeText?: string
  status?: NormalizedTaskStatus
}

const TITLE_KEYS = ['subject', 'task', 'description', 'activeForm'] as const
const ID_KEYS = ['id', 'taskId', 'task_id'] as const

function getTaskScalar(value: TaskRecordLike[keyof TaskRecordLike]): TaskScalar {
  if (typeof value === 'string' || typeof value === 'number' || value === null || value === undefined) return value
  return undefined
}

export function isTaskRecord(value: unknown): value is TaskRecordLike {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getTaskString(value: TaskScalar): string | undefined {
  if (typeof value === 'string') {
    const text = value.trim()
    return text || undefined
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

export function getTaskField(record: TaskRecordLike, keys: readonly (keyof TaskRecordLike)[]): string | undefined {
  for (const key of keys) {
    const value = getTaskString(getTaskScalar(record[key]))
    if (value) return value
  }
  return undefined
}

export function isOrdinalTaskTitle(value: string | undefined): boolean {
  return !!value && /^#?\d+$/.test(value.trim())
}

export function normalizeTaskTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function getTaskId(record: TaskRecordLike): string | undefined {
  return getTaskField(record, ID_KEYS)
}

export function getTaskTitle(record: TaskRecordLike, fallback?: string): string | undefined {
  for (const key of TITLE_KEYS) {
    const value = record[key]
    if (isTaskRecord(value)) {
      const nested = getTaskTitle(value)
      if (nested && !isOrdinalTaskTitle(nested)) return nested
    }

    const title = getTaskString(getTaskScalar(value))
    if (title && !isOrdinalTaskTitle(title)) return title
  }

  return fallback && !isOrdinalTaskTitle(fallback) ? fallback : undefined
}

export function getTaskActiveText(record: TaskRecordLike): string | undefined {
  return getTaskField(record, ['activeText', 'activeForm', 'description'])
}

export function normalizeTaskStatus(value: TaskScalar): NormalizedTaskStatus | undefined {
  switch (value) {
    case 'pending':
      return 'pending'
    case 'in_progress':
    case 'running':
    case 'paused':
      return 'in_progress'
    case 'completed':
    case 'deleted':
      return 'completed'
    case 'error':
    case 'failed':
    case 'killed':
    case 'stopped':
      return 'error'
    default:
      return undefined
  }
}

export function normalizeTaskLike(
  value: TaskRecordLike | undefined,
  fallbackId?: string
): NormalizedTaskLike | undefined {
  if (!value) return undefined
  const id = getTaskId(value) ?? fallbackId
  const title = getTaskTitle(value, id)
  if (!id && !title) return undefined

  return {
    id,
    title,
    activeText: getTaskActiveText(value),
    status: normalizeTaskStatus(value.status)
  }
}
