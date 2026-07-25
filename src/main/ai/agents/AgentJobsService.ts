import { application } from '@application'
import { agentChannelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { agentTaskService } from '@data/services/AgentTaskService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { ScheduledTaskEntity } from '@shared/data/api/schemas/agents'
import { triggersEqual, type UpdateJobScheduleDto } from '@shared/data/api/schemas/jobs'
import type { AgentTaskForm, AgentTaskPatch } from '@shared/ipc/schemas/ai'

import { agentTaskJobHandler } from './agentTaskJobHandler'

const logger = loggerService.withContext('AgentJobsService')

const AGENT_TASK_TYPE = 'agent.task' as const
const DEFAULT_TIMEOUT_MINUTES = 2

/**
 * Sole command owner for agent scheduled tasks — the renderer (IpcApi
 * `ai.agent.task.*`) and MCP (`cherryAutonomyTools`) both mutate through this
 * service; reads stay on `AgentTaskService` / DataApi. Owns the composition of
 * JobManager's transactional schedule primitives with the channel-subscription
 * writes: mutate inside one `withWriteTx`, then sync the timer on the
 * deterministic post-commit path.
 *
 * Every by-id command guards through `agentTaskService.getTask`, which rejects
 * non-`agent.task` schedules and other agents' tasks in one lookup.
 */
@Injectable('AgentJobsService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['JobManager'])
export class AgentJobsService extends BaseService {
  protected async onInit(): Promise<void> {
    application.get('JobManager').registerHandler('agent.task', agentTaskJobHandler)
  }

  createTask(agentId: string, form: AgentTaskForm): ScheduledTaskEntity {
    this.assertAgentExists(agentId)
    const channelIds = form.channelIds ?? []
    this.assertChannelsBelongToAgent(agentId, channelIds)

    const jobManager = application.get('JobManager')
    const { id } = application.get('DbService').withWriteTx((tx) => {
      const created = jobManager.registerJobScheduleTx(tx, {
        type: AGENT_TASK_TYPE,
        name: form.name,
        trigger: form.trigger,
        jobInputTemplate: {
          agentId,
          prompt: form.prompt,
          timeoutMinutes: form.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES,
          workspace: form.workspace
        },
        catchUpPolicy: { kind: 'skip-missed' }
      })
      if (channelIds.length > 0) {
        agentChannelService.replaceTaskSubscriptionsTx(tx, created.id, channelIds)
      }
      return created
    })
    jobManager.syncJobScheduleTimerById(id)

    const entity = agentTaskService.getTask(agentId, id)
    if (!entity) throw new Error(`Task ${id} disappeared after create`)
    logger.info('Task created', { taskId: id, agentId })
    return entity
  }

  updateTask(agentId: string, taskId: string, patch: AgentTaskPatch): ScheduledTaskEntity | null {
    const existing = agentTaskService.getTask(agentId, taskId)
    if (!existing) return null
    if (patch.channelIds !== undefined) {
      this.assertChannelsBelongToAgent(agentId, patch.channelIds)
    }

    const schedulePatch: UpdateJobScheduleDto = {}
    if (patch.name !== undefined) schedulePatch.name = patch.name
    // Drop a value-identical trigger: the edit dialog submits full-field
    // saves, and JobManager's field-presence re-arm would reset the phase.
    if (patch.trigger !== undefined && !triggersEqual(patch.trigger, existing.trigger)) {
      schedulePatch.trigger = patch.trigger
    }
    const templateChanged =
      (patch.prompt !== undefined && patch.prompt !== existing.prompt) ||
      (patch.timeoutMinutes !== undefined && patch.timeoutMinutes !== existing.timeoutMinutes) ||
      patch.workspace !== undefined
    if (templateChanged) {
      // The armed callback re-reads the row before each fire, so a template
      // write takes effect next fire without touching the timer.
      schedulePatch.jobInputTemplate = {
        agentId,
        prompt: patch.prompt ?? existing.prompt,
        timeoutMinutes: patch.timeoutMinutes ?? existing.timeoutMinutes,
        workspace: patch.workspace ?? existing.workspace
      }
    }

    const jobManager = application.get('JobManager')
    application.get('DbService').withWriteTx((tx) => {
      jobManager.updateJobScheduleTx(tx, taskId, schedulePatch)
      if (patch.channelIds !== undefined) {
        agentChannelService.replaceTaskSubscriptionsTx(tx, taskId, patch.channelIds)
      }
    })
    if (schedulePatch.trigger !== undefined) {
      jobManager.syncJobScheduleTimerById(taskId)
    }

    logger.info('Task updated', { taskId, agentId })
    return agentTaskService.getTask(agentId, taskId)
  }

  async pauseTask(agentId: string, taskId: string): Promise<ScheduledTaskEntity | null> {
    const existing = agentTaskService.getTask(agentId, taskId)
    if (!existing) return null
    // State-aware no-op: `setEnabled`'s changes>0 only reflects row existence,
    // and pausing an already-paused task would still bump `updatedAt`. The
    // read-decide-write sequence is fully synchronous — no await gap.
    if (!existing.enabled) return existing
    await application.get('JobManager').pauseJobScheduleById(taskId)
    logger.info('Task paused', { taskId, agentId })
    return agentTaskService.getTask(agentId, taskId)
  }

  resumeTask(agentId: string, taskId: string): ScheduledTaskEntity | null {
    const existing = agentTaskService.getTask(agentId, taskId)
    if (!existing) return null
    // State-aware no-op: resuming an already-enabled task would re-register
    // the SchedulerService timer and reset an interval's phase.
    if (existing.enabled) return existing
    application.get('JobManager').resumeJobScheduleById(taskId)
    logger.info('Task resumed', { taskId, agentId })
    return agentTaskService.getTask(agentId, taskId)
  }

  /** @returns `false` when the task is not found / not owned by `agentId` (no distinction — no existence leak). */
  async deleteTask(agentId: string, taskId: string): Promise<boolean> {
    const existing = agentTaskService.getTask(agentId, taskId)
    if (!existing) return false
    // Channel subscriptions cascade via the agentChannelTaskTable FK; historical
    // jobs keep their rows with scheduleId set NULL (ON DELETE SET NULL).
    const deleted = await application.get('JobManager').unregisterJobScheduleById(taskId)
    if (deleted) logger.info('Task deleted', { taskId, agentId })
    return deleted
  }

  /** Run a scheduled agent task now (`ai.agent.task.run`). @returns whether the trigger fired (`false` = not found / not owned). */
  async runTask(agentId: string, taskId: string): Promise<boolean> {
    const existing = agentTaskService.getTask(agentId, taskId)
    if (!existing) return false
    return application.get('JobManager').triggerJobScheduleNowById(taskId)
  }

  // Plain Errors on purpose: no renderer branch consumes an agent/channel
  // not-found code (the message reaches the toast through INTERNAL either
  // way), so no AI-domain IpcError code is minted for them — unlike trigger
  // validation, where the form must branch on the code.
  private assertAgentExists(agentId: string): void {
    if (!agentService.getAgent(agentId)) {
      throw new Error(`Agent not found: ${agentId}`)
    }
  }

  private assertChannelsBelongToAgent(agentId: string, channelIds: readonly string[]): void {
    for (const channelId of channelIds) {
      const channel = agentChannelService.getChannel(channelId)
      if (!channel || channel.agentId !== agentId) {
        throw new Error(`Channel not found: ${channelId}`)
      }
    }
  }
}
