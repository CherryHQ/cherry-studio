import { dataApiService } from '@renderer/data/DataApiService'
import { DataApiErrorFactory, isDataApiNotFoundError, isDataApiResourceNotFoundError } from '@shared/data/api/errors'
import type { ScheduledTaskEntity, TaskRunLogEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { JobSnapshot } from '@shared/data/api/schemas/jobs'
import type { OffsetPaginationResponse } from '@shared/data/api/types'

export interface SelectedTaskRun {
  id: string
  startedAt: string
  status: JobSnapshot['status']
  result: string | null
  error: string | null
}

export interface TaskConversationResult {
  selectedRun: SelectedTaskRun | null
  session: AgentSessionEntity | null
  runId?: string
  startedAt?: string
  logs: TaskRunLogEntity[]
  nextPage: number
  total: number
}

export function isTaskRunSessionUnavailable(error: unknown, sessionId: string): boolean {
  return isDataApiResourceNotFoundError(error, 'Session') && error.status === 404 && error.details?.id === sessionId
}

async function readTaskRunSession(task: ScheduledTaskEntity, runId: string, signal?: AbortSignal) {
  const job = await dataApiService.get(`/jobs/${runId}`)
  if (job.type !== 'agent.task' || job.scheduleId !== task.id) {
    throw DataApiErrorFactory.notFound('Task run', runId)
  }
  const output = job.output as { sessionId?: unknown; result?: unknown } | null
  const selectedRun: SelectedTaskRun = {
    id: job.id,
    startedAt: job.startedAt ?? job.scheduledAt,
    status: job.status,
    result: typeof output?.result === 'string' ? output.result : null,
    error: job.error?.message ?? null
  }
  const facts = { selectedRun, runId: job.id, startedAt: selectedRun.startedAt }
  const sessionId = job.metadata.sessionId ?? output?.sessionId
  signal?.throwIfAborted()
  if (typeof sessionId !== 'string' || !sessionId.trim()) return { ...facts, session: null }
  try {
    const session = await dataApiService.get(`/agent-sessions/${sessionId}`)
    signal?.throwIfAborted()
    return { ...facts, session }
  } catch (error) {
    signal?.throwIfAborted()
    if (!isTaskRunSessionUnavailable(error, sessionId)) throw error
    return { ...facts, session: null }
  }
}

export async function readTaskConversationPage(task: ScheduledTaskEntity, page: number, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const history = (await dataApiService.get(`/agents/${task.agentId}/tasks/${task.id}/logs`, {
    query: { page, limit: 50 }
  })) as OffsetPaginationResponse<TaskRunLogEntity>
  signal?.throwIfAborted()
  const ids = [...new Set(history.items.map((log) => log.sessionId).filter((id): id is string => !!id?.trim()))]
  const sessions = ids.length ? await dataApiService.get('/agent-sessions', { query: { ids, limit: 50 } }) : null
  signal?.throwIfAborted()
  const available = new Map(sessions?.items.map((session) => [session.id, session]))
  const run = history.items.find((log) => log.sessionId && available.has(log.sessionId))
  return {
    selectedRun: null,
    session: run?.sessionId ? available.get(run.sessionId)! : null,
    runId: run?.id,
    startedAt: run?.startedAt,
    logs: history.items,
    nextPage: page + 1,
    total: history.total
  } satisfies TaskConversationResult
}

export async function resolveTaskConversation(
  task: ScheduledTaskEntity,
  runId?: string,
  signal?: AbortSignal
): Promise<TaskConversationResult> {
  signal?.throwIfAborted()
  let selected: (Pick<TaskConversationResult, 'session'> & Partial<TaskConversationResult>) | undefined
  if (runId) {
    selected = await readTaskRunSession(task, runId, signal)
  } else if (task.reuseSession && task.reuseSessionId) {
    try {
      selected = { session: await dataApiService.get(`/agent-sessions/${task.reuseSessionId}`) }
    } catch (error) {
      if (!isDataApiNotFoundError(error)) throw error
    }
  }
  const first = await readTaskConversationPage(task, 1, signal)
  if (selected) return { ...first, ...selected }
  if (first.session || first.total <= 50) return first
  const second = await readTaskConversationPage(task, 2, signal)
  return { ...second, logs: [...first.logs, ...second.logs] }
}
