import * as z from 'zod'

import type {
  AgentParams,
  AgentResult,
  AgentWorkspaceSelection,
  TaskDetail,
  TaskResultLocation,
  TaskRun,
  TaskSummary,
  TaskTrigger
} from '@cherrystudio/remote-protocol/agent'
import { taskStatusSchema } from '@cherrystudio/remote-protocol/agent'
import { RemoteRpcError } from '@cherrystudio/remote-transport'
import { agentTaskService, type TaskRunRecord } from '@data/services/AgentTaskService'
import { toExecutionFailure } from '@shared/ai/executionFailure'
import type { ScheduledTaskEntity } from '@shared/data/api/schemas/agents'

import { queryPage } from './agentPagination'
import { contentOf, inputDigest, notFound, revisionOf, sliceContent, utf8 } from './agentQueries'

const cursorSchema = z.strictObject({ offset: z.number().int().nonnegative(), filter: z.string().length(64) })

function offsetOf(cursor: string | undefined, filter: string): number {
  if (!cursor) return 0
  try {
    const bytes = Buffer.from(cursor, 'base64url')
    const value = cursorSchema.parse(JSON.parse(bytes.toString('utf8')))
    if (bytes.toString('base64url') === cursor && value.filter === filter) return value.offset
  } catch {
    // Malformed and differently scoped cursors share the same public failure.
  }
  throw new RemoteRpcError('NOT_FOUND', 'Invalid task page cursor')
}

function nextCursor(offset: number, count: number, total: number, filter: string): string | null {
  return offset + count < total
    ? Buffer.from(JSON.stringify({ offset: offset + count, filter })).toString('base64url')
    : null
}

function taskById(taskId: string): ScheduledTaskEntity {
  const task = agentTaskService.getTaskById(taskId)
  if (!task) throw new RemoteRpcError('NOT_FOUND', 'Task not found')
  return task
}

function toTaskSummary(task: ScheduledTaskEntity): TaskSummary {
  return {
    taskId: task.id,
    agentId: task.agentId,
    name: task.name,
    status: task.status,
    trigger: toTaskTrigger(task.trigger),
    nextRunAt: task.nextRun ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  }
}

function toTaskTrigger(trigger: ScheduledTaskEntity['trigger']): TaskTrigger {
  switch (trigger.kind) {
    case 'cron':
      return { kind: 'cron', expr: trigger.expr, timezone: trigger.timezone, limit: trigger.limit }
    case 'interval':
      return { kind: 'interval', ms: trigger.ms, anchor: trigger.anchor }
    case 'once':
      return { kind: 'once', at: trigger.at }
    default:
      return trigger satisfies never
  }
}

const promptId = (task: ScheduledTaskEntity): string => `task-prompt:${inputDigest([task.id, task.prompt])}`

function toTaskWorkspace(workspace: ScheduledTaskEntity['workspace']): AgentWorkspaceSelection {
  switch (workspace.type) {
    case 'system':
      return { kind: 'system' }
    case 'user':
      return { kind: 'registered', id: workspace.workspaceId }
    default:
      return workspace satisfies never
  }
}

function toResultLocation(location: TaskRunRecord['resultLocation']): TaskResultLocation {
  switch (location.kind) {
    case 'none':
      return { kind: 'none' }
    case 'unavailable':
      return { kind: 'unavailable' }
    case 'session':
      return { kind: 'session', sessionId: location.sessionId }
    default:
      return location satisfies never
  }
}

export function listTasks(params: AgentParams<'agent.tasks.list'>): AgentResult<'agent.tasks.list'> {
  const statuses = [...new Set(params.statuses ?? taskStatusSchema.options)].sort()
  const filter = inputDigest(['agent.tasks.list', params.agentId ?? null, statuses])
  const offset = offsetOf(params.cursor, filter)
  return queryPage((limit) => {
    const page = agentTaskService.queryTasks({ agentId: params.agentId, status: statuses, offset, limit })
    return {
      items: page.tasks.map(toTaskSummary),
      nextCursor: nextCursor(offset, page.tasks.length, page.total, filter)
    }
  }, params.limit)
}

export function getTask(taskId: string): TaskDetail {
  const task = taskById(taskId)
  return {
    ...toTaskSummary(task),
    prompt: contentOf(promptId(task), revisionOf(task.updatedAt), task.prompt),
    timeoutMinutes: task.timeoutMinutes,
    workspace: toTaskWorkspace(task.workspace),
    reuse: task.reuseSession ? { kind: 'reuse', sessionId: task.reuseSessionId } : { kind: 'fresh' }
  }
}

function toTaskRun(run: TaskRunRecord): TaskRun {
  const common = {
    runId: run.id,
    taskId: run.taskId,
    createdAt: run.createdAt,
    scheduledAt: run.scheduledAt,
    summary:
      run.summary
        ?.slice(0, 200)
        .replace(/[\uD800-\uDBFF]$/, '')
        .toWellFormed() ?? null,
    resultLocation: toResultLocation(run.resultLocation)
  }
  const terminal = { ...common, startedAt: run.startedAt, finishedAt: run.finishedAt }
  switch (run.status) {
    case 'pending':
    case 'delayed':
      return { ...common, status: 'queued', startedAt: null, cancelRequested: run.cancelRequested }
    case 'running':
      return { ...common, status: 'running', startedAt: run.startedAt, cancelRequested: run.cancelRequested }
    case 'completed':
      return { ...terminal, status: 'completed', outcome: run.outcome }
    case 'failed':
      return {
        ...terminal,
        status: 'failed',
        failure: toExecutionFailure({
          name: null,
          stack: null,
          message: run.error?.message ?? null,
          isRetryable: run.error?.retryable ?? false
        })
      }
    case 'cancelled':
      return { ...terminal, status: 'cancelled' }
    default:
      return run.status satisfies never
  }
}

export function listTaskRuns(params: AgentParams<'agent.tasks.runs.list'>): AgentResult<'agent.tasks.runs.list'> {
  const filter = inputDigest(['agent.tasks.runs.list', params.taskId])
  const offset = offsetOf(params.cursor, filter)
  return queryPage((limit) => {
    const page = notFound(() => agentTaskService.listTaskRuns(params.taskId, { offset, limit }))
    return {
      items: page.runs.map(toTaskRun),
      nextCursor: nextCursor(offset, page.runs.length, page.total, filter)
    }
  }, params.limit)
}

export function getTaskRun(taskId: string, runId: string): TaskRun {
  return toTaskRun(notFound(() => agentTaskService.getTaskRun(taskId, runId)))
}

export function readTaskContent(
  params: AgentParams<'agent.tasks.content.read'>
): AgentResult<'agent.tasks.content.read'> {
  const task = taskById(params.taskId)
  const revision = revisionOf(task.updatedAt)
  if (params.revision !== revision || params.contentId !== promptId(task))
    throw new RemoteRpcError('REVISION_EXPIRED', 'Task prompt changed; reload task details')
  return { contentId: params.contentId, revision, ...sliceContent(utf8(task.prompt), params.offset, params.maxBytes) }
}
