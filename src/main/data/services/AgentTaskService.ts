/**
 * Read-side service for agent scheduled tasks: list / get / run logs plus the
 * JobScheduleSnapshot → ScheduledTaskEntity mapping and subscription reads.
 * User-driven task mutations go through `AgentJobsService` (IpcApi
 * `ai.agent.task.*`); the workspace cleanup methods below are DB-only
 * transaction primitives used by workspace deletion.
 */

import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import type { DbOrTx } from '@data/db/types'
import { agentChannelService } from '@data/services/AgentChannelService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { registerDataService } from '@data/services/dataServiceRegistry'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { timestampToISO } from '@data/services/utils/rowMappers'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type {
  ScheduledTaskEntity,
  ScheduledTaskListItem,
  TaskRunLogEntity,
  TaskRunSummary
} from '@shared/data/api/schemas/agents'
import {
  AGENT_WORKSPACE_TYPE,
  type AgentSessionWorkspaceSource,
  AgentSessionWorkspaceSourceSchema,
  type AgentWorkspaceReferenceItem
} from '@shared/data/api/schemas/agentWorkspaces'
import type { JobScheduleSnapshot, JobSnapshot } from '@shared/data/api/schemas/jobs'
import type { ListOptions } from '@shared/data/api/types'

const AGENT_TASK_TYPE = 'agent.task' as const

/**
 * Reserved prompt marking a schedule as an agent heartbeat rather than a
 * user-authored task. It is the only heartbeat marker that survives the v1→v2
 * migration intact — the schedule name does not, because `job_schedule` is
 * UNIQUE on (type, name) while v1 gave every agent its own `heartbeat` row, so
 * all but the first are renamed to `task_<v1Id>`.
 */
export const HEARTBEAT_PROMPT_SENTINEL = '__heartbeat__'

type AgentTaskJobInputTemplate = {
  agentId: string
  prompt: string
  timeoutMinutes: number
  workspace: AgentSessionWorkspaceSource
}

function normalizeAgentTaskTemplate(value: unknown): AgentTaskJobInputTemplate | null {
  if (typeof value !== 'object' || value === null) return null

  const template = value as Partial<AgentTaskJobInputTemplate>
  if (typeof template.agentId !== 'string' || typeof template.prompt !== 'string') return null

  const parsedWorkspace = AgentSessionWorkspaceSourceSchema.safeParse(template.workspace)
  return {
    agentId: template.agentId,
    prompt: template.prompt,
    timeoutMinutes: typeof template.timeoutMinutes === 'number' ? template.timeoutMinutes : 2,
    workspace: parsedWorkspace.success ? parsedWorkspace.data : { type: 'system' }
  }
}

/**
 * Session-reuse state for an `agent.task` schedule. Lives in the schedule row's
 * generic `metadata` JSON column (not `jobInputTemplate`) for two reasons: it is
 * schedule state rather than handler input, so it stays clear of
 * `AgentJobsService.updateTask`'s template diff / re-arm logic; while the
 * sticky session pointer is a constrained relation owned by AgentSessionService.
 */
export type TaskSessionReuse = {
  enabled: boolean
  /** Monotonic config epoch captured by each queued job. */
  revision: number
}

const TASK_REUSE_METADATA_KEY = 'reuse'

/** A JSON column can legally hold an array or a primitive; both would spread into garbage. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function referencesWorkspace(value: unknown, workspaceId: string): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false
  const workspace = AgentSessionWorkspaceSourceSchema.safeParse(value.workspace)
  return (
    workspace.success && workspace.data.type === AGENT_WORKSPACE_TYPE.USER && workspace.data.workspaceId === workspaceId
  )
}

function findWorkspaceScheduleReferences(schedules: JobScheduleSnapshot[], workspaceId: string) {
  const references: Array<{ schedule: JobScheduleSnapshot; template: Record<string, unknown> }> = []
  for (const schedule of schedules) {
    if (referencesWorkspace(schedule.jobInputTemplate, workspaceId)) {
      references.push({ schedule, template: schedule.jobInputTemplate })
    }
  }
  return references
}

export function normalizeTaskSessionReuseRevision(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

export function readTaskSessionReuse(metadata: Record<string, unknown> | undefined): TaskSessionReuse {
  const raw = metadata?.[TASK_REUSE_METADATA_KEY]
  if (!isPlainRecord(raw)) return { enabled: false, revision: 0 }
  const reuse = raw as Partial<TaskSessionReuse>
  const enabled = reuse.enabled === true
  return { enabled, revision: normalizeTaskSessionReuseRevision(reuse.revision) }
}

/**
 * Merge reuse state back into the full metadata record. Callers must pass the
 * row's current metadata — `JobScheduleService.update` replaces the column
 * wholesale, so a partial write would drop unrelated keys.
 */
export function writeTaskSessionReuse(
  metadata: Record<string, unknown> | undefined,
  reuse: TaskSessionReuse
): Record<string, unknown> {
  return { ...(isPlainRecord(metadata) ? metadata : {}), [TASK_REUSE_METADATA_KEY]: reuse }
}

function deriveStatus(snapshot: JobScheduleSnapshot): 'active' | 'paused' | 'completed' {
  if (!snapshot.enabled) return 'paused'
  if (snapshot.trigger.kind === 'once' && snapshot.nextRun == null && snapshot.lastRun != null) return 'completed'
  return 'active'
}

export class AgentTaskService {
  /** Publish every DataApi projection backed by the composed task read model. */
  notifyReadModelChange(taskIds: readonly string[]): void {
    const entityIds = [...new Set(taskIds)]
    if (entityIds.length === 0) return
    notifyDataApiDataChange([
      { endpoint: '/agent-tasks', kind: 'projection', entityIds },
      { endpoint: '/agents/:agentId/tasks', kind: 'projection', entityIds },
      { endpoint: '/agent-tasks/:taskId', entityIds },
      { endpoint: '/agents/:agentId/tasks/:taskId', entityIds }
    ])
  }

  listWorkspaceReferencesTx(tx: DbOrTx, workspaceId: string): AgentWorkspaceReferenceItem[] {
    return findWorkspaceScheduleReferences(
      jobScheduleService.listAllTx(tx, { type: AGENT_TASK_TYPE }),
      workspaceId
    ).map(({ schedule }) => ({ id: schedule.id, name: schedule.name ?? '' }))
  }

  /**
   * This cleanup changes only the template used when the task creates a new
   * session. A reused session keeps its own workspace, and any reused session
   * bound to this workspace is deleted by the same outer transaction. The
   * trigger is unchanged and JobManager re-reads the schedule before each run,
   * so this path does not bump the reuse revision, clear the schedule, or re-arm
   * its timer.
   */
  resetWorkspaceReferencesTx(tx: DbOrTx, workspaceId: string): AgentWorkspaceReferenceItem[] {
    const references = findWorkspaceScheduleReferences(
      jobScheduleService.listAllTx(tx, { type: AGENT_TASK_TYPE }),
      workspaceId
    )

    for (const { schedule, template } of references) {
      jobScheduleService.updateTx(tx, schedule.id, {
        jobInputTemplate: {
          ...template,
          workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM }
        }
      })
    }

    return references.map(({ schedule }) => ({ id: schedule.id, name: schedule.name ?? '' }))
  }

  getTaskById(taskId: string): ScheduledTaskEntity | null {
    const snapshot = jobScheduleService.getById(taskId)
    if (!snapshot || snapshot.type !== AGENT_TASK_TYPE) return null
    if (!normalizeAgentTaskTemplate(snapshot.jobInputTemplate)) return null
    return this.toScheduledTaskEntity(snapshot, agentSessionService.getByTaskScheduleId(snapshot.id)?.id ?? null)
  }

  /**
   * Fetch one task, guarding identity in a single lookup: the row must exist,
   * be an `agent.task` schedule, and belong to `agentId` — the three failure
   * cases are indistinguishable (`null`) on purpose. AgentJobsService relies
   * on this as the ownership/type guard for every by-id command.
   */
  getTask(agentId: string, taskId: string): ScheduledTaskEntity | null {
    const task = this.getTaskById(taskId)
    if (!task || task.agentId !== agentId) return null
    return task
  }

  listTasks(
    agentId: string,
    options: ListOptions & { includeHeartbeat?: boolean } = {}
  ): { tasks: ScheduledTaskEntity[]; total: number } {
    return this.queryTasks({ ...options, agentId })
  }

  /** Cross-agent listing for the settings overview — one scan instead of one per agent. */
  listAllTasks(options: ListOptions & { includeHeartbeat?: boolean } = {}): {
    tasks: ScheduledTaskListItem[]
    total: number
  } {
    const result = this.queryTasks(options)
    const runSummaries = this.getRunSummariesByScheduleIds(result.tasks.map((task) => task.id))
    return {
      tasks: result.tasks.map((task) => ({ ...task, runSummary: runSummaries.get(task.id) ?? null })),
      total: result.total
    }
  }

  private queryTasks(options: ListOptions & { includeHeartbeat?: boolean; agentId?: string }): {
    tasks: ScheduledTaskEntity[]
    total: number
  } {
    const { agentId, includeHeartbeat = false, limit, offset } = options
    const all = jobScheduleService.listAll({ type: AGENT_TASK_TYPE })

    const filtered = all.filter((s) => {
      const template = normalizeAgentTaskTemplate(s.jobInputTemplate)
      if (!template) return false
      if (agentId !== undefined && template.agentId !== agentId) return false
      if (!includeHeartbeat && template.prompt === HEARTBEAT_PROMPT_SENTINEL) return false
      return true
    })

    const sorted = [...filtered].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    const sliced =
      limit !== undefined
        ? offset !== undefined
          ? sorted.slice(offset, offset + limit)
          : sorted.slice(0, limit)
        : sorted

    const sessionIds = agentSessionService.getTaskSessionIdsByScheduleIds(sliced.map((task) => task.id))
    return {
      tasks: sliced.map((s) => this.toScheduledTaskEntity(s, sessionIds.get(s.id) ?? null)),
      total: filtered.length
    }
  }

  private getRunSummariesByScheduleIds(scheduleIds: readonly string[]): Map<string, TaskRunSummary> {
    return new Map(
      [...jobService.getRunStatesByScheduleIds(AGENT_TASK_TYPE, scheduleIds)].map(
        ([scheduleId, runState]): [string, TaskRunSummary] => {
          if (runState.kind === 'running') return [scheduleId, { status: 'running' }]
          if (runState.kind === 'unfinished') return [scheduleId, { status: 'queued' }]
          return [scheduleId, { status: runState.status, finishedAt: timestampToISO(runState.finishedAt) }]
        }
      )
    )
  }

  getTaskLogs(taskId: string, options: ListOptions = {}): { logs: TaskRunLogEntity[]; total: number } {
    const jobs = jobService.list({ scheduleId: taskId })
    const total = jobs.length
    const sliced =
      options.limit !== undefined
        ? options.offset !== undefined
          ? jobs.slice(options.offset, options.offset + options.limit)
          : jobs.slice(0, options.limit)
        : jobs

    return {
      logs: sliced.map((j) => this.toTaskRunLogEntity(j)),
      total
    }
  }

  // ------------------------------------------------------------------
  // Mappers (snapshot → entity)
  // ------------------------------------------------------------------

  private toScheduledTaskEntity(snapshot: JobScheduleSnapshot, reuseSessionId: string | null): ScheduledTaskEntity {
    const tmpl = normalizeAgentTaskTemplate(snapshot.jobInputTemplate)
    if (!tmpl) {
      throw DataApiErrorFactory.invalidOperation('read task', 'invalid agent task template')
    }
    const channelRows = agentChannelService.getSubscribedChannels(snapshot.id)
    const reuse = readTaskSessionReuse(snapshot.metadata)
    return {
      id: snapshot.id,
      agentId: tmpl.agentId,
      // JobScheduleSnapshot.name: string | null (rowToSnapshot maps the internal
      // '' sentinel back to null). agent.task is multi-instance — name is
      // always set, '' fallback is defensive only.
      name: snapshot.name ?? '',
      prompt: tmpl.prompt,
      trigger: snapshot.trigger,
      timeoutMinutes: tmpl.timeoutMinutes,
      workspace: tmpl.workspace,
      reuseSession: reuse.enabled,
      reuseSessionId: reuse.enabled ? reuseSessionId : null,
      channelIds: channelRows.map((c) => c.id),
      nextRun: snapshot.nextRun,
      lastRun: snapshot.lastRun,
      enabled: snapshot.enabled,
      status: deriveStatus(snapshot),
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt
    }
  }

  private toTaskRunLogEntity(job: JobSnapshot): TaskRunLogEntity {
    const output = job.output as { sessionId?: string; result?: string } | null
    const startedAt = job.startedAt ?? job.scheduledAt
    // A cancel-requested row's fate is sealed (live cancel and startup recovery
    // both end it as cancelled) — show the outcome before the row settles.
    const provisionalCancel = job.cancelRequested && !job.finishedAt

    // jobTable has 6 states; the renderer's run log model only shows running
    // + 3 terminal states. Collapse pending/delayed to 'running' so queued
    // jobs are visible (matches the user's mental model of "task is in flight").
    const status: TaskRunLogEntity['status'] = provisionalCancel
      ? 'cancelled'
      : job.status === 'pending' || job.status === 'delayed'
        ? 'running'
        : job.status

    // Cancelled runs end at the cancel-request time — recovery stamps finishedAt
    // at sweep time, up to a process lifetime after the run actually stopped.
    const endIso = status === 'cancelled' ? (job.cancelRequestedAt ?? job.finishedAt) : job.finishedAt
    // NaN (never started / unfinished / corrupt row) flows through the
    // isFinite check as durationMs = null — no duration, not queue-wait time.
    const startedMs = job.startedAt ? Date.parse(job.startedAt) : NaN
    const endMs = endIso ? Date.parse(endIso) : NaN
    const durationMs = Number.isFinite(endMs - startedMs) ? Math.max(0, endMs - startedMs) : null

    return {
      id: job.id,
      scheduleId: job.scheduleId ?? '',
      sessionId: output?.sessionId ?? null,
      startedAt,
      durationMs,
      status,
      result: typeof output?.result === 'string' ? output.result : output != null ? JSON.stringify(output) : null,
      error: job.error?.message ?? null
    }
  }
}

export const agentTaskService = new AgentTaskService()
registerDataService('AgentTaskService', agentTaskService)
