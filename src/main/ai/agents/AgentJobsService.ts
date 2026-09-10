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
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { loggerService } from '@logger'
import { createInFlightWorkTracker } from '@main/core/concurrency/inFlightWork'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { ScheduledTaskEntity } from '@shared/data/api/schemas/agents'
import {
  AGENT_WORKSPACE_TYPE,
  type AgentSessionWorkspaceSource,
  AgentSessionWorkspaceSourceSchema
} from '@shared/data/api/schemas/agentWorkspaces'
import { triggersEqual, type UpdateJobScheduleDto } from '@shared/data/api/schemas/jobs'
import type { AgentTaskForm, AgentTaskPatch } from '@shared/ipc/schemas/ai'

import { DEFAULT_AGENT_TASK_TIMEOUT_MINUTES } from './agentTaskDefaults'
import { agentTaskJobHandler } from './agentTaskJobHandler'
import {
  drainHeartbeatWork,
  isReservedHeartbeatScheduleName,
  repairHeartbeatSchedules,
  syncHeartbeatSchedule
} from './heartbeatSchedule'

const logger = loggerService.withContext('AgentJobsService')

const AGENT_TASK_TYPE = 'agent.task' as const

/**
 * Quiet window before the startup heartbeat repair pass — lets cold-start IO
 * settle first, mirroring JobManager's deferred-recovery shape (the repair
 * writes schedule rows and arms timers, neither of which belongs on the
 * bootstrap path).
 */
const STARTUP_REPAIR_QUIET_WINDOW_MS = 60_000

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
    timeoutMinutes:
      typeof template.timeoutMinutes === 'number' ? template.timeoutMinutes : DEFAULT_AGENT_TASK_TIMEOUT_MINUTES,
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
  // In-flight schedule work started by this service (deletion sweeps),
  // drained in onStop. Heartbeat work is tracked at its own module level
  // (see drainHeartbeatWork) since createAgent also starts it.
  private readonly inFlightWork = createInFlightWorkTracker()

  private trackWork(work: Promise<unknown>): void {
    void this.inFlightWork.track(work)
  }

  private isShuttingDown = false

  protected async onInit(): Promise<void> {
    application.get('JobManager').registerHandler('agent.task', agentTaskJobHandler)

    // Deleting an agent used to leave its schedules behind: nothing listened
    // to onAgentDeleted, so every interval kept firing for an agent that no
    // longer exists, each run failing with 'Agent not found'. The event fires
    // post-commit, after the agent row is already gone.
    this.registerDisposable(
      agentService.onAgentDeleted(({ agentId }) => {
        // Gate producers during shutdown: the drain in onStop must converge,
        // not chase an ever-refilling set.
        if (this.isShuttingDown) return
        this.trackWork(
          this.deleteSchedulesForAgent(agentId).catch((error) => {
            logger.warn('Failed to delete schedules for removed agent', { agentId, error })
          })
        )
      })
    )

    // The restore path (ensureBuiltinAgent) never goes through createAgent;
    // the creation event is the seam that covers both — a soft-deleted
    // builtin restored via claimBuiltinSupportIdentityTx re-fires it.
    this.registerDisposable(
      agentService.onAgentCreated(({ agentId }) => {
        if (this.isShuttingDown) return
        void syncHeartbeatSchedule(agentId).catch((error) => {
          logger.warn('Failed to provision heartbeat schedule for created agent', { agentId, error })
        })
      })
    )

    // The heartbeat schedule is derived state of the agent configuration —
    // re-sync on saves carrying the heartbeat keys, so switch/interval
    // changes take effect on the next tick instead of after a restart.
    this.registerDisposable(
      agentService.onAgentUpdated(({ updates, agent }) => {
        if (this.isShuttingDown) return
        const configPatch = updates.configuration
        if (!configPatch) return
        if (!('heartbeat_enabled' in configPatch) && !('heartbeat_interval' in configPatch)) return
        void syncHeartbeatSchedule(agent.id).catch((error) => {
          // Failure stays per-agent: the next config save or startup sweep
          // converges this one agent (the dominant failure is deterministic,
          // so a whole-population re-repair could not fix it anyway).
          logger.warn('Failed to sync heartbeat schedule after config update', { agentId: agent.id, error })
        })
      })
    )
  }

  protected override onAllReady(): void {
    // Startup repair pass for migrated rows and producer-less agents (#19203) —
    // scheduled, not run: onAllReady is fire-and-forget for the framework.
    const handle = setTimeout(() => {
      if (this.isShuttingDown) return
      void repairHeartbeatSchedules().catch((error) => {
        logger.warn('Heartbeat schedule repair failed at startup', { error })
      })
    }, STARTUP_REPAIR_QUIET_WINDOW_MS)
    this.registerDisposable(() => clearTimeout(handle))
  }

  protected async onStop(): Promise<void> {
    this.isShuttingDown = true
    // Drain at stop, not destroy: dependency ordering stops this service
    // before JobManager/DbService, so the work we wait out still has live
    // infrastructure underneath it. Producers are gated on isShuttingDown
    // above and both drains carry a deadline, so a stray event mid-shutdown
    // cannot stall stop() indefinitely.
    const settled = await this.inFlightWork.drain()
    const heartbeatSettled = await drainHeartbeatWork()
    if (!settled || !heartbeatSettled) {
      logger.warn('Stopped with schedule work still in flight past the drain deadline', {
        settled,
        heartbeatSettled
      })
    }
  }

  createTask(agentId: string, form: AgentTaskForm): ScheduledTaskEntity {
    this.assertAgentExists(agentId)
    this.assertPromptNotReserved(form.prompt)
    this.assertNameNotReserved(form.name)
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
          timeoutMinutes:
            form.timeoutMinutes === null ? 0 : (form.timeoutMinutes ?? DEFAULT_AGENT_TASK_TIMEOUT_MINUTES),
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
    this.assertNameNotReserved(patch.name)
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

    // The heartbeat's user workspace row (pointing at the agent data directory)
    // outlives the agent unless removed here — it renders in the workspace picker.
    const heartbeatWorkspaceIds = new Set<string>()
    for (const schedule of schedules) {
      const template = readAgentTaskJobInputTemplate(schedule.jobInputTemplate)
      if (template?.prompt === HEARTBEAT_PROMPT_SENTINEL && template.workspace.type === AGENT_WORKSPACE_TYPE.USER) {
        heartbeatWorkspaceIds.add(template.workspace.workspaceId)
      }
    }

    let deleted = 0
    let failed = 0
    for (const schedule of schedules) {
      // A transient unregister failure (SQLITE_BUSY, timer teardown) must not
      // abort the sweep — the remaining schedules and the workspace cleanup
      // below are independent of this row. The failed row converges on the
      // next deletion pass or startup sweep instead of orphaning everything.
      try {
        if (await application.get('JobManager').unregisterJobScheduleById(schedule.id)) {
          deleted += 1
        }
      } catch (error) {
        failed += 1
        logger.warn('Failed to unregister schedule for removed agent', { agentId, scheduleId: schedule.id, error })
      }
    }
    if (failed > 0) {
      logger.warn('Some schedules survived the deletion sweep after transient failures', { agentId, failed })
    }
    for (const workspaceId of heartbeatWorkspaceIds) {
      try {
        // find-or-create may have reused a workspace the user created at the
        // agent data path, and the row may since have been shared with
        // sessions (FK cascade), channels, or other agents' task schedules —
        // deleting a referenced row would cascade unrelated sessions and
        // leave dangling template references, so only an unreferenced row goes.
        const removed = application
          .get('DbService')
          .withWriteTx((tx) => agentWorkspaceService.deleteIfUnreferencedTx(tx, workspaceId))
        if (!removed) {
          logger.info('Kept heartbeat workspace still referenced after agent removal', { agentId, workspaceId })
        }
      } catch (error) {
        logger.warn('Failed to delete heartbeat workspace for removed agent', { agentId, workspaceId, error })
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

  /**
   * The reserved names are exactly the `heartbeat_<agentId>` rows heartbeat
   * sync can mint for a live agent — (type, name) is UNIQUE across ALL agents,
   * so any agent's reserved name is reserved for everyone. A plain
   * `heartbeat_daily` collides with nothing and stays allowed. Guarded here
   * for the same reason as the prompt guard.
   */
  private assertNameNotReserved(name: string | undefined): void {
    if (name && isReservedHeartbeatScheduleName(name)) {
      throw new Error(`Name is reserved for the agent heartbeat: ${name}`)
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
