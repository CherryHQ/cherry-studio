/**
 * Thin facade — preserves existing DataApi/MCP IPC shape (ScheduledTaskEntity etc.).
 * Internally delegates to JobManager + jobScheduleService + jobService.
 * TODO: migrate callers (data/api/handlers/agents.ts, ai/mcp/servers/claw.ts) to the
 * generic Job/Scheduler API directly, then delete this facade.
 */

import { application } from '@application'
import { agentTable as agentsTable } from '@data/db/schemas/agent'
import { agentChannelService } from '@data/services/AgentChannelService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { ListOptions } from '@shared/data/api/apiTypes'
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
import type { JobScheduleSnapshot, JobSnapshot, UpdateJobScheduleDto } from '@shared/data/api/schemas/jobs'
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

function deriveStatus(snapshot: JobScheduleSnapshot): 'active' | 'paused' | 'completed' {
  if (!snapshot.enabled) return 'paused'
  if (snapshot.trigger.kind === 'once' && snapshot.nextRun == null && snapshot.lastRun != null) return 'completed'
  return 'active'
}

export class AgentTaskService {
  /**
   * Scheduled tasks require an autonomous agent — either Soul Mode
   * (soul_enabled) or bypassPermissions permission mode — otherwise
   * tool calls during task execution will fail with permission errors.
   */
  private async assertAutonomous(agentId: string): Promise<void> {
    const database = application.get('DbService').getDb()
    const [row] = await database
      .select({ configuration: agentsTable.configuration })
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId))
      .limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Agent', agentId)
    }

    const config: Record<string, unknown> = row.configuration ?? {}

    if (config.soul_enabled === true || config.permission_mode === 'bypassPermissions') {
      return
    }

    throw DataApiErrorFactory.invalidOperation(
      'Scheduled tasks require Soul Mode or Bypass Permissions mode. Update the agent settings first.'
    )
  }

  async createTask(agentId: string, dto: CreateTaskDto): Promise<ScheduledTaskEntity> {
    await this.assertAutonomous(agentId)

    const timeoutMinutes = dto.timeoutMinutes ?? 2
    const jobInputTemplate: AgentTaskJobInputTemplate = {
      agentId,
      prompt: dto.prompt,
      timeoutMinutes,
      workspace: dto.workspace
    }

    const { id } = await application.get('JobManager').registerJobSchedule({
      type: AGENT_TASK_TYPE,
      name: dto.name,
      trigger: dto.trigger,
      jobInputTemplate,
      catchUpPolicy: { kind: 'skip-missed' }
    })

    if (dto.channelIds?.length) {
      try {
        await agentChannelService.replaceTaskSubscriptions(id, dto.channelIds)
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

    const snapshot = await jobScheduleService.getById(id)
    if (!snapshot) {
      throw DataApiErrorFactory.invalidOperation('create task', 'schedule disappeared after insert')
    }

    logger.info('Task created', { taskId: id, agentId })
    return await this.toScheduledTaskEntity(snapshot)
  }

  async getTask(agentId: string, taskId: string): Promise<ScheduledTaskEntity | null> {
    const snapshot = await jobScheduleService.getById(taskId)
    if (!snapshot || snapshot.type !== AGENT_TASK_TYPE) return null
    const template = normalizeAgentTaskTemplate(snapshot.jobInputTemplate)
    if (!template || template.agentId !== agentId) return null
    return await this.toScheduledTaskEntity(snapshot)
  }

  async listTasks(
    agentId: string,
    options: ListOptions & { includeHeartbeat?: boolean } = {}
  ): Promise<{ tasks: ScheduledTaskEntity[]; total: number }> {
    const { includeHeartbeat = false, limit, offset } = options
    const all = await jobScheduleService.listAll({ type: AGENT_TASK_TYPE })

    const filtered = all.filter((s) => {
      const template = normalizeAgentTaskTemplate(s.jobInputTemplate)
      if (!template || template.agentId !== agentId) return false
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
      tasks: await Promise.all(sliced.map((s) => this.toScheduledTaskEntity(s))),
      total: filtered.length
    }
  }

  async updateTask(agentId: string, taskId: string, patch: UpdateTaskDto): Promise<ScheduledTaskEntity | null> {
    const existing = await this.getTask(agentId, taskId)
    if (!existing) return null

    const existingSnapshot = await jobScheduleService.getById(taskId)
    const existingTemplate = existingSnapshot ? normalizeAgentTaskTemplate(existingSnapshot.jobInputTemplate) : null
    if (!existingSnapshot || !existingTemplate) return null

    // Build the updated jobInputTemplate when prompt/timeoutMinutes changed.
    const nextPrompt = patch.prompt ?? existingTemplate.prompt
    const nextTimeoutMinutes = patch.timeoutMinutes ?? existingTemplate.timeoutMinutes
    const nextWorkspace = patch.workspace ?? existingTemplate.workspace
    const templateChanged =
      (patch.prompt !== undefined && patch.prompt !== existingTemplate.prompt) ||
      (patch.timeoutMinutes !== undefined && patch.timeoutMinutes !== existingTemplate.timeoutMinutes) ||
      patch.workspace !== undefined

    const updatePatch: UpdateJobScheduleDto = {}
    if (patch.name !== undefined) updatePatch.name = patch.name
    if (patch.trigger !== undefined) updatePatch.trigger = patch.trigger
    if (patch.enabled !== undefined) updatePatch.enabled = patch.enabled
    if (templateChanged) {
      updatePatch.jobInputTemplate = {
        agentId: existingTemplate.agentId,
        prompt: nextPrompt,
        timeoutMinutes: nextTimeoutMinutes,
        workspace: nextWorkspace
      }
    }

    const updated = await application.get('JobManager').updateJobSchedule(taskId, updatePatch)
    if (!updated) return null

    if (patch.channelIds !== undefined) {
      await agentChannelService.replaceTaskSubscriptions(taskId, patch.channelIds)
    }

    logger.info('Task updated', { taskId, agentId })
    const refreshed = await jobScheduleService.getById(taskId)
    if (!refreshed) return null
    return await this.toScheduledTaskEntity(refreshed)
  }

  async deleteTask(agentId: string, taskId: string): Promise<boolean> {
    const existing = await this.getTask(agentId, taskId)
    if (!existing) return false
    const deleted = await application.get('JobManager').unregisterJobScheduleById(taskId)
    if (deleted) {
      logger.info('Task deleted', { taskId, agentId })
    }
    return deleted
  }

  async getTaskLogs(taskId: string, options: ListOptions = {}): Promise<{ logs: TaskRunLogEntity[]; total: number }> {
    const jobs = await jobService.list({ scheduleId: taskId })
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

  private async toScheduledTaskEntity(snapshot: JobScheduleSnapshot): Promise<ScheduledTaskEntity> {
    const tmpl = normalizeAgentTaskTemplate(snapshot.jobInputTemplate)
    if (!tmpl) {
      throw DataApiErrorFactory.invalidOperation('read task', 'invalid agent task template')
    }
    const channelRows = await agentChannelService.getSubscribedChannels(snapshot.id)
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
