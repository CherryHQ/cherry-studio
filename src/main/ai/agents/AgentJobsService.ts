import { application } from '@application'
import { agentChannelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import {
  agentTaskService,
  HEARTBEAT_PROMPT_SENTINEL,
  normalizeTaskSessionReuseRevision,
  readTaskSessionReuse,
  writeTaskSessionReuse
} from '@data/services/AgentTaskService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { ScheduledTaskEntity } from '@shared/data/api/schemas/agents'
import {
  AGENT_WORKSPACE_TYPE,
  type AgentSessionWorkspaceSource,
  AgentSessionWorkspaceSourceSchema
} from '@shared/data/api/schemas/agentWorkspaces'
import { triggersEqual, type UpdateJobScheduleDto } from '@shared/data/api/schemas/jobs'
import type { AgentTaskForm, AgentTaskPatch } from '@shared/ipc/schemas/ai'

import { agentTaskJobHandler } from './agentTaskJobHandler'

const logger = loggerService.withContext('AgentJobsService')

const AGENT_TASK_TYPE = 'agent.task' as const
const DEFAULT_TIMEOUT_MINUTES = 2

type AgentTaskJobInputTemplate = {
  agentId: string
  prompt: string
  timeoutMinutes: number
  workspace: AgentSessionWorkspaceSource
  reuseRevision: number
}

function workspacesEqual(a: AgentSessionWorkspaceSource, b: AgentSessionWorkspaceSource): boolean {
  if (a.type !== b.type) return false
  return a.type === AGENT_WORKSPACE_TYPE.USER ? a.workspaceId === (b as typeof a).workspaceId : true
}

function readAgentTaskJobInputTemplate(value: unknown): AgentTaskJobInputTemplate | null {
  if (typeof value !== 'object' || value === null) return null
  const template = value as Partial<AgentTaskJobInputTemplate>
  const workspace = AgentSessionWorkspaceSourceSchema.safeParse(template.workspace)
  if (!workspace.success || typeof template.agentId !== 'string') return null
  return {
    agentId: template.agentId,
    prompt: typeof template.prompt === 'string' ? template.prompt : '',
    timeoutMinutes: typeof template.timeoutMinutes === 'number' ? template.timeoutMinutes : DEFAULT_TIMEOUT_MINUTES,
    workspace: workspace.data,
    reuseRevision: normalizeTaskSessionReuseRevision(template.reuseRevision)
  }
}

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

    // Deleting an agent used to leave its schedules behind: nothing listened
    // to onAgentDeleted, so every interval kept firing for an agent that no
    // longer exists, each run failing with 'Agent not found'. The event fires
    // post-commit, after the agent row is already gone.
    this.registerDisposable(
      agentService.onAgentDeleted(({ agentId }) => {
        void this.deleteSchedulesForAgent(agentId).catch((error) => {
          logger.warn('Failed to delete schedules for removed agent', { agentId, error })
        })
      })
    )
  }

  createTask(agentId: string, form: AgentTaskForm): ScheduledTaskEntity {
    this.assertAgentExists(agentId)
    this.assertPromptNotReserved(form.prompt)
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
          timeoutMinutes: form.timeoutMinutes === null ? 0 : (form.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES),
          workspace: form.workspace,
          reuseRevision: 0
        },
        // Reuse configuration lives in metadata; the sticky session itself is
        // a constrained relation owned by AgentSessionService.
        metadata: writeTaskSessionReuse(undefined, {
          enabled: form.reuseSession === true,
          revision: 0
        }),
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
    this.assertPromptNotReserved(patch.prompt)
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
    const nextTimeoutMinutes = patch.timeoutMinutes === null ? 0 : (patch.timeoutMinutes ?? existing.timeoutMinutes)
    const templateChanged =
      (patch.prompt !== undefined && patch.prompt !== existing.prompt) ||
      (patch.timeoutMinutes !== undefined && nextTimeoutMinutes !== existing.timeoutMinutes) ||
      patch.workspace !== undefined

    const nextReuseEnabled = patch.reuseSession ?? existing.reuseSession
    const reuseChanged = patch.reuseSession !== undefined && patch.reuseSession !== existing.reuseSession
    // A bound session keeps its OWN workspace, so re-pointing the task at a
    // different workspace would otherwise be silently ignored while the form
    // still displays the new one. Drop the pointer instead: the next fire
    // creates a session in the workspace the user actually picked.
    const workspaceChanged =
      nextReuseEnabled && patch.workspace !== undefined && !workspacesEqual(patch.workspace, existing.workspace)
    const reuseConfigChanged = reuseChanged || workspaceChanged

    const jobManager = application.get('JobManager')
    let bindingCleared = false
    application.get('DbService').withWriteTx((tx) => {
      const snapshot = jobScheduleService.getByIdTx(tx, taskId)
      const currentReuse = readTaskSessionReuse(snapshot?.metadata)
      const reuseRevision = currentReuse.revision + (reuseConfigChanged ? 1 : 0)
      if (reuseConfigChanged) {
        // Read-merge-write inside the tx: `updateTx` replaces `metadata`
        // wholesale, so preserve unrelated schedule state.
        schedulePatch.metadata = writeTaskSessionReuse(snapshot?.metadata, {
          enabled: nextReuseEnabled,
          revision: reuseRevision
        })
        bindingCleared = agentSessionService.clearTaskScheduleTx(tx, taskId)
      }
      if (templateChanged || reuseConfigChanged) {
        // The armed callback re-reads the row before each fire, so a template
        // write takes effect next fire without touching the timer.
        schedulePatch.jobInputTemplate = {
          agentId,
          prompt: patch.prompt ?? existing.prompt,
          timeoutMinutes: nextTimeoutMinutes,
          workspace: patch.workspace ?? existing.workspace,
          reuseRevision
        }
      }
      jobManager.updateJobScheduleTx(tx, taskId, schedulePatch)
      if (patch.channelIds !== undefined) {
        agentChannelService.replaceTaskSubscriptionsTx(tx, taskId, patch.channelIds)
      }
    })
    if (schedulePatch.trigger !== undefined) {
      jobManager.syncJobScheduleTimerById(taskId)
    }
    if (reuseConfigChanged || bindingCleared) agentTaskService.notifyReadModelChange([taskId])

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

  /**
   * Delete every `agent.task` schedule owned by `agentId` — the schedule-side
   * half of agent deletion. Historical jobs keep their rows with `scheduleId`
   * set NULL (`ON DELETE SET NULL`, same as `deleteTask`).
   *
   * @returns How many schedule rows were removed.
   */
  async deleteSchedulesForAgent(agentId: string): Promise<number> {
    const schedules = jobScheduleService.listAll({ type: AGENT_TASK_TYPE }).filter((s) => {
      const template = readAgentTaskJobInputTemplate(s.jobInputTemplate)
      return template?.agentId === agentId
    })

    let deleted = 0
    for (const schedule of schedules) {
      if (await application.get('JobManager').unregisterJobScheduleById(schedule.id)) {
        deleted += 1
      }
    }
    if (deleted > 0) {
      logger.info('Deleted task schedules for removed agent', { agentId, deleted })
      agentTaskService.notifyReadModelChange(schedules.map((s) => s.id))
    }
    return deleted
  }

  /** Run a scheduled agent task now (`ai.agent.task.run`). @returns whether the trigger fired (`false` = not found / not owned). */
  async runTask(agentId: string, taskId: string): Promise<boolean> {
    const existing = agentTaskService.getTask(agentId, taskId)
    if (!existing) return false
    return application.get('JobManager').triggerJobScheduleNowById(taskId)
  }

  /**
   * Atomically bind a newly created sticky session only when the queued job's
   * captured reuse configuration is still current. AgentSessionService owns
   * the constrained relation; this command service only validates task state.
   */
  bindTaskSessionReuse(params: {
    scheduleId: string
    sessionId: string
    agentId: string
    workspace: AgentSessionWorkspaceSource
    reuseRevision: number
  }): boolean {
    const bound = application.get('DbService').withWriteTx((tx) => {
      const snapshot = jobScheduleService.getByIdTx(tx, params.scheduleId)
      if (!snapshot || snapshot.type !== AGENT_TASK_TYPE) return false
      const template = readAgentTaskJobInputTemplate(snapshot.jobInputTemplate)
      const reuse = readTaskSessionReuse(snapshot.metadata)
      if (
        !template ||
        template.agentId !== params.agentId ||
        !workspacesEqual(template.workspace, params.workspace) ||
        !reuse.enabled ||
        reuse.revision !== params.reuseRevision ||
        template.reuseRevision !== params.reuseRevision
      ) {
        return false
      }
      return agentSessionService.bindTaskScheduleTx(tx, {
        sessionId: params.sessionId,
        taskScheduleId: params.scheduleId,
        expectedAgentId: params.agentId
      })
    })
    if (bound) agentTaskService.notifyReadModelChange([params.scheduleId])
    return bound
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

  /**
   * The heartbeat sentinel is what identifies a heartbeat run, so a user task
   * must never carry it: `AgentTaskService` would hide the task and
   * `runAgentTask` would run `heartbeat.md` under the heartbeat toggle instead
   * of the task's own prompt. Guarded here rather than in `agentTaskFormSchema`
   * because MCP's `cherryAutonomyTools` calls this service directly.
   */
  private assertPromptNotReserved(prompt: string | undefined): void {
    if (prompt === HEARTBEAT_PROMPT_SENTINEL) {
      throw new Error(`Prompt is reserved for the agent heartbeat: ${HEARTBEAT_PROMPT_SENTINEL}`)
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
