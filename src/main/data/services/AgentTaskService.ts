/**
 * Thin facade — preserves existing DataApi/MCP IPC shape (ScheduledTaskEntity etc.).
 * Internally delegates to JobManager + jobScheduleService + jobService.
 * TODO: migrate callers (data/api/handlers/agents.ts, ai/mcp/servers/cherryAutonomyTools.ts) to the
 * generic Job/Scheduler API directly, then delete this facade.
 */

import { application } from '@application'
import { agentTable as agentsTable } from '@data/db/schemas/agent'
import { agentChannelService } from '@data/services/AgentChannelService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type {
  CreateTaskDto,
  ScheduledTaskEntity,
  TaskRunLogEntity,
  UpdateTaskDto
} from '@shared/data/api/schemas/agents'
import {
  type AgentSessionWorkspaceSource,
  AgentSessionWorkspaceSourceSchema
} from '@shared/data/api/schemas/agentWorkspaces'
import type { JobScheduleSnapshot, JobSnapshot, Trigger, UpdateJobScheduleDto } from '@shared/data/api/schemas/jobs'
import type { ListOptions } from '@shared/data/api/types'
import { eq } from 'drizzle-orm'

const logger = loggerService.withContext('AgentTaskService')

const AGENT_TASK_TYPE = 'agent.task' as const
const HEARTBEAT_TASK_NAME = 'heartbeat'

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

function triggersEqual(a: Trigger, b: Trigger): boolean {
  if (a.kind === 'cron' && b.kind === 'cron') {
    return a.expr === b.expr && a.timezone === b.timezone && a.limit === b.limit
  }
  if (a.kind === 'interval' && b.kind === 'interval') return a.ms === b.ms && a.anchor === b.anchor
  if (a.kind === 'once' && b.kind === 'once') return a.at === b.at
  return false
}

function deriveStatus(snapshot: JobScheduleSnapshot): 'active' | 'paused' | 'completed' {
  if (!snapshot.enabled) return 'paused'
  if (snapshot.trigger.kind === 'once' && snapshot.nextRun == null && snapshot.lastRun != null) return 'completed'
  return 'active'
}

export class AgentTaskService {
  private assertAgentExists(agentId: string): void {
    const database = application.get('DbService').getDb()
    const [row] = database
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId))
      .limit(1)
      .all()

    if (!row) {
      throw DataApiErrorFactory.notFound('Agent', agentId)
    }
  }

  private assertChannelsBelongToAgent(agentId: string, channelIds: string[]): void {
    for (const channelId of channelIds) {
      const channel = agentChannelService.getChannel(channelId)
      if (!channel || channel.agentId !== agentId) {
        throw DataApiErrorFactory.notFound('Channel', channelId)
      }
    }
  }

  async createTask(agentId: string, dto: CreateTaskDto): Promise<ScheduledTaskEntity> {
    this.assertAgentExists(agentId)
    if (dto.channelIds?.length) {
      this.assertChannelsBelongToAgent(agentId, dto.channelIds)
    }

    const timeoutMinutes = dto.timeoutMinutes === null ? 0 : (dto.timeoutMinutes ?? 2)
    const jobInputTemplate: AgentTaskJobInputTemplate = {
      agentId,
      prompt: dto.prompt,
      timeoutMinutes,
      workspace: dto.workspace
    }

    const { id } = application.get('JobManager').registerJobSchedule({
      type: AGENT_TASK_TYPE,
      name: dto.name,
      trigger: dto.trigger,
      jobInputTemplate,
      catchUpPolicy: { kind: 'skip-missed' }
    })

    if (dto.channelIds?.length) {
      try {
        agentChannelService.replaceTaskSubscriptions(id, dto.channelIds)
      } catch (error) {
        try {
          await application.get('JobManager').unregisterJobScheduleById(id)
        } catch (rollbackError) {
          logger.warn('Failed to rollback task schedule after channel subscription failure', {
            taskId: id,
            rollbackError
          })
        }
        throw error
      }
    }

    const snapshot = jobScheduleService.getById(id)
    if (!snapshot) {
      throw DataApiErrorFactory.invalidOperation('create task', 'schedule disappeared after insert')
    }

    logger.info('Task created', { taskId: id, agentId })
    return this.toScheduledTaskEntity(snapshot)
  }

  getTaskById(taskId: string): ScheduledTaskEntity | null {
    const snapshot = jobScheduleService.getById(taskId)
    if (!snapshot || snapshot.type !== AGENT_TASK_TYPE) return null
    return this.toScheduledTaskEntity(snapshot)
  }

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
    tasks: ScheduledTaskEntity[]
    total: number
  } {
    return this.queryTasks(options)
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
      if (!includeHeartbeat && s.name === HEARTBEAT_TASK_NAME) return false
      return true
    })

    const sorted = [...filtered].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    const sliced =
      limit !== undefined
        ? offset !== undefined
          ? sorted.slice(offset, offset + limit)
          : sorted.slice(0, limit)
        : sorted

    return {
      tasks: sliced.map((s) => this.toScheduledTaskEntity(s)),
      total: filtered.length
    }
  }

  async updateTask(agentId: string, taskId: string, patch: UpdateTaskDto): Promise<ScheduledTaskEntity | null> {
    const existing = this.getTask(agentId, taskId)
    if (!existing) return null

    const existingSnapshot = jobScheduleService.getById(taskId)
    const existingTemplate = existingSnapshot ? normalizeAgentTaskTemplate(existingSnapshot.jobInputTemplate) : null
    if (!existingSnapshot || !existingTemplate) return null
    const nextAgentId = patch.agentId ?? existingTemplate.agentId
    const agentChanged = nextAgentId !== existingTemplate.agentId
    if (agentChanged) {
      this.assertAgentExists(nextAgentId)
    }
    const nextChannelIds = patch.channelIds ?? (agentChanged ? [] : undefined)
    if (nextChannelIds !== undefined) {
      this.assertChannelsBelongToAgent(nextAgentId, nextChannelIds)
    }

    // Build the updated jobInputTemplate when an execution input changes.
    const nextPrompt = patch.prompt ?? existingTemplate.prompt
    const nextTimeoutMinutes =
      patch.timeoutMinutes === null ? 0 : (patch.timeoutMinutes ?? existingTemplate.timeoutMinutes)
    const nextWorkspace = patch.workspace ?? existingTemplate.workspace
    const templateChanged =
      agentChanged ||
      (patch.prompt !== undefined && patch.prompt !== existingTemplate.prompt) ||
      (patch.timeoutMinutes !== undefined && nextTimeoutMinutes !== existingTemplate.timeoutMinutes) ||
      patch.workspace !== undefined

    const updatePatch: UpdateJobScheduleDto = {}
    if (patch.name !== undefined) updatePatch.name = patch.name
    // Drop unchanged triggers: JobManager re-arms on any trigger patch, and
    // re-arming resets an interval's cadence (see JobManager.armSchedule).
    if (patch.trigger !== undefined && !triggersEqual(patch.trigger, existingSnapshot.trigger)) {
      updatePatch.trigger = patch.trigger
    }
    if (patch.enabled !== undefined) updatePatch.enabled = patch.enabled
    if (templateChanged) {
      updatePatch.jobInputTemplate = {
        agentId: nextAgentId,
        prompt: nextPrompt,
        timeoutMinutes: nextTimeoutMinutes,
        workspace: nextWorkspace
      }
    }

    const updated = application.get('JobManager').updateJobSchedule(taskId, updatePatch)
    if (!updated) return null

    if (nextChannelIds !== undefined) {
      try {
        agentChannelService.replaceTaskSubscriptions(taskId, nextChannelIds)
      } catch (error) {
        const rollbackPatch: UpdateJobScheduleDto = {}
        if (updatePatch.name !== undefined) rollbackPatch.name = existingSnapshot.name
        if (updatePatch.trigger !== undefined) rollbackPatch.trigger = existingSnapshot.trigger
        if (updatePatch.enabled !== undefined) rollbackPatch.enabled = existingSnapshot.enabled
        if (updatePatch.jobInputTemplate !== undefined)
          rollbackPatch.jobInputTemplate = existingSnapshot.jobInputTemplate

        try {
          application.get('JobManager').updateJobSchedule(taskId, rollbackPatch)
        } catch (rollbackError) {
          logger.warn('Failed to rollback task schedule after channel subscription failure', {
            taskId,
            rollbackError
          })
        }
        throw error
      }
    }

    logger.info('Task updated', { taskId, agentId: nextAgentId })
    const refreshed = jobScheduleService.getById(taskId)
    if (!refreshed) return null
    return this.toScheduledTaskEntity(refreshed)
  }

  async deleteTask(agentId: string, taskId: string): Promise<boolean> {
    const existing = this.getTask(agentId, taskId)
    if (!existing) return false
    const deleted = await application.get('JobManager').unregisterJobScheduleById(taskId)
    if (deleted) {
      logger.info('Task deleted', { taskId, agentId })
    }
    return deleted
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

  private toScheduledTaskEntity(snapshot: JobScheduleSnapshot): ScheduledTaskEntity {
    const tmpl = normalizeAgentTaskTemplate(snapshot.jobInputTemplate)
    if (!tmpl) {
      throw DataApiErrorFactory.invalidOperation('read task', 'invalid agent task template')
    }
    const channelRows = agentChannelService.getSubscribedChannels(snapshot.id)
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
    // jobTable stores ISO strings on these columns — use Date.parse so
    // a NaN result (corrupt row) flows through as durationMs = 0 instead
    // of `NaN`.
    const startedMs = Date.parse(startedAt)
    const finishedMs = job.finishedAt ? Date.parse(job.finishedAt) : NaN
    const durationMs = Number.isFinite(finishedMs - startedMs) ? finishedMs - startedMs : 0

    // jobTable has 6 states; the renderer's run log model only shows running
    // + 3 terminal states. Collapse pending/delayed to 'running' so queued
    // jobs are visible (matches the user's mental model of "task is in flight").
    const status: TaskRunLogEntity['status'] =
      job.status === 'pending' || job.status === 'delayed' ? 'running' : job.status

    return {
      id: job.id,
      scheduleId: job.scheduleId ?? '',
      sessionId: output?.sessionId ?? null,
      startedAt,
      durationMs: Math.max(0, durationMs),
      status,
      result: typeof output?.result === 'string' ? output.result : output != null ? JSON.stringify(output) : null,
      error: job.error?.message ?? null
    }
  }
}

export const agentTaskService = new AgentTaskService()
