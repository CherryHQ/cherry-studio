import { dataApiService } from '@renderer/data/DataApiService'
import { DataApiErrorFactory, isDataApiNotFoundError } from '@shared/data/api/errors'
import type { ScheduledTaskEntity, TaskRunLogEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { OffsetPaginationResponse } from '@shared/data/api/types'

export interface TaskConversationResult {
  session: AgentSessionEntity | null
  runId?: string
  startedAt?: string
  logs: TaskRunLogEntity[]
  nextPage: number
  total: number
}

export async function readTaskRunSession(task: ScheduledTaskEntity, runId: string) {
  const job = await dataApiService.get(`/jobs/${runId}`)
  if (job.type !== 'agent.task' || job.scheduleId !== task.id) {
    throw DataApiErrorFactory.notFound('Task run', runId)
  }
  const output = job.output as { sessionId?: unknown } | null
  const sessionId = job.metadata.sessionId ?? output?.sessionId
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    return { session: null, runId, startedAt: job.startedAt ?? job.scheduledAt }
  }
  const session = await dataApiService.get(`/agent-sessions/${sessionId}`)
  return { session, runId, startedAt: job.startedAt ?? job.scheduledAt }
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
  let selected: Pick<TaskConversationResult, 'session' | 'runId' | 'startedAt'> | undefined
  if (runId) {
    selected = await readTaskRunSession(task, runId)
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
