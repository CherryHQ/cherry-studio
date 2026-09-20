import { application } from '@application'
import { agentChannelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import {
  agentTaskService,
  clearMissedTask,
  HEARTBEAT_PROMPT_SENTINEL,
  isMissedTask,
  normalizeTaskSessionReuseRevision,
  readTaskSessionReuse,
  writeTaskSessionReuse
} from '@data/services/AgentTaskService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { loggerService } from '@logger'
import { createInFlightWorkTracker } from '@main/core/concurrency/inFlightWork'
import { BaseService, DependsOn, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isHeartbeatEnabled } from '@shared/ai/agentHeartbeat'
import type { ScheduledTaskEntity } from '@shared/data/api/schemas/agents'
import {
  AGENT_WORKSPACE_TYPE,
  type AgentSessionWorkspaceSource,
  AgentSessionWorkspaceSourceSchema
} from '@shared/data/api/schemas/agentWorkspaces'
import { triggersEqual, type JobScheduleSnapshot, type UpdateJobScheduleDto } from '@shared/data/api/schemas/jobs'
import type { AgentTaskForm, AgentTaskPatch, HeartbeatDocument, HeartbeatRunResult } from '@shared/ipc/schemas/ai'

import { DEFAULT_AGENT_TASK_TIMEOUT_MINUTES } from './agentTaskDefaults'
import { agentTaskJobHandler } from './agentTaskJobHandler'
import { readHeartbeat } from './heartbeat'
import { readHeartbeatDocument, writeHeartbeatDocument } from './heartbeatDocument'
import {
  type HeartbeatSyncOutcome,
  isReservedHeartbeatScheduleName,
  pauseHeartbeatSchedule,
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
  if (typeof template.agentId !== 'string') return null
  let workspace: AgentSessionWorkspaceSource
  if (template.workspace === undefined) {
    workspace = { type: AGENT_WORKSPACE_TYPE.SYSTEM }
  } else {
    const parsedWorkspace = AgentSessionWorkspaceSourceSchema.safeParse(template.workspace)
    if (!parsedWorkspace.success) return null
    workspace = parsedWorkspace.data
  }
  return {
    agentId: template.agentId,
    prompt: typeof template.prompt === 'string' ? template.prompt : '',
    timeoutMinutes:
      typeof template.timeoutMinutes === 'number' ? template.timeoutMinutes : DEFAULT_AGENT_TASK_TIMEOUT_MINUTES,
    workspace,
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
 * Every by-id command first requires an active Agent, then guards through
 * `agentTaskService.getTask`, which rejects non-task and foreign schedules.
 */
@Injectable('AgentJobsService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['JobManager'])
export class AgentJobsService extends BaseService {
  // All autonomous schedule writes participate in shutdown and backup quiescence.
  private readonly inFlightWork = createInFlightWorkTracker()

  private trackWork(work: Promise<unknown>): void {
    void this.inFlightWork.track(work)
  }

  private isShuttingDown = false
  private heartbeatAbort = new AbortController()
  private readonly heartbeatChains = new Map<string, Promise<HeartbeatSyncOutcome | undefined>>()
  private readonly pauseHolds = new Set<symbol>()
  private readonly pendingHeartbeats = new Set<string>()
  private repairPending = false
  private readonly heartbeatRuns = new Set<string>()

  syncHeartbeat(agentId: string, rows?: JobScheduleSnapshot[]): Promise<HeartbeatSyncOutcome | undefined> {
    if (this.isShuttingDown) return Promise.resolve(undefined)
    if (this.pauseHolds.size > 0) {
      this.pendingHeartbeats.add(agentId)
      return Promise.resolve(undefined)
    }
    const signal = this.heartbeatAbort.signal
    const previous = this.heartbeatChains.get(agentId) ?? Promise.resolve()
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        if (signal.aborted) return undefined
        if (this.pauseHolds.size > 0) {
          this.pendingHeartbeats.add(agentId)
          return undefined
        }
        if (agentService.getLifecycleState(agentId) === 'missing') {
          await this.deleteSchedulesForAgent(agentId)
          return 'skipped-missing-agent' as const
        }
        return syncHeartbeatSchedule(agentId, signal, rows)
      })
    this.heartbeatChains.set(agentId, current)
    const settled = () => {
      if (this.heartbeatChains.get(agentId) === current) this.heartbeatChains.delete(agentId)
    }
    void current.then(settled, settled)
    return this.inFlightWork.track(current)
  }

  /** Join the creation event's provisioning without scheduling the same work twice. */
  waitForHeartbeat(agentId: string): Promise<HeartbeatSyncOutcome | undefined> {
    return this.heartbeatChains.get(agentId) ?? this.syncHeartbeat(agentId)
  }

  pause(reason?: string): Disposable {
    const token = Symbol(reason)
    this.pauseHolds.add(token)
    return {
      dispose: () => {
        if (!this.pauseHolds.delete(token) || this.pauseHolds.size > 0 || this.isShuttingDown) return
        const pending = [...this.pendingHeartbeats]
        this.pendingHeartbeats.clear()
        for (const agentId of pending) this.requestHeartbeat(agentId)
        if (this.repairPending) this.repairHeartbeats()
      }
    }
  }

  async drainInFlight(options: { timeoutMs: number }): Promise<{ settled: boolean }> {
    return { settled: await this.inFlightWork.drain(options) }
  }

  private requestHeartbeat(agentId: string): void {
    void this.syncHeartbeat(agentId).catch((error) => {
      if (!this.isShuttingDown) logger.warn('Failed to sync heartbeat schedule', { agentId, error })
    })
  }

  private repairHeartbeats(): void {
    if (this.isShuttingDown) return
    if (this.pauseHolds.size > 0) {
      this.repairPending = true
      return
    }
    this.repairPending = false
    this.trackWork(
      repairHeartbeatSchedules((agentId, rows) => this.syncHeartbeat(agentId, rows), this.heartbeatAbort.signal).catch(
        (error) => {
          if (!this.isShuttingDown) logger.warn('Heartbeat schedule repair failed at startup', { error })
        }
      )
    )
  }

  protected async onInit(): Promise<void> {
    // A restart re-runs onInit on the same instance after onStop set the gate,
    // so clear it here or every event producer stays dead for the new lifetime.
    this.isShuttingDown = false
    this.heartbeatAbort = new AbortController()
    application.get('JobManager').registerHandler('agent.task', agentTaskJobHandler)

    // Creation events cover both new agents and restored built-ins.
    this.registerDisposable(
      agentService.onAgentCreated(({ agentId }) => {
        if (this.isShuttingDown) return
        this.requestHeartbeat(agentId)
      })
    )

    // Only heartbeat configuration changes require schedule convergence.
    this.registerDisposable(
      agentService.onAgentUpdated(({ updates, agent }) => {
        if (this.isShuttingDown) return
        const configPatch = updates.configuration
        if (!configPatch) return
        if (!('heartbeat_enabled' in configPatch) && !('heartbeat_interval' in configPatch)) return
        this.requestHeartbeat(agent.id)
      })
    )
  }

  protected override onAllReady(): void {
    // Startup repair pass for migrated rows and producer-less agents (#19203) —
    // scheduled, not run: onAllReady is fire-and-forget for the framework.
    const handle = setTimeout(() => {
      if (this.isShuttingDown) return
      this.repairHeartbeats()
    }, STARTUP_REPAIR_QUIET_WINDOW_MS)
    this.registerDisposable(() => clearTimeout(handle))
  }

  protected async onStop(): Promise<void> {
    this.isShuttingDown = true
    this.heartbeatAbort.abort()
    this.pendingHeartbeats.clear()
    this.repairPending = false
    const settled = await this.inFlightWork.drain()
    if (!settled) logger.warn('Stopped with schedule work still in flight past the drain deadline')
  }

  createTask(agentId: string, form: AgentTaskForm): ScheduledTaskEntity {
    this.assertAgentIsActive(agentId)
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
    const existing = this.getActiveTask(agentId, taskId)
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
      if (
        snapshot &&
        isMissedTask(snapshot.metadata) &&
        schedulePatch.trigger &&
        (schedulePatch.trigger.kind !== 'once' || schedulePatch.trigger.at > Date.now())
      ) {
        schedulePatch.metadata = clearMissedTask(schedulePatch.metadata ?? snapshot.metadata)
        schedulePatch.enabled = false
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
    return this.getActiveTask(agentId, taskId)
  }

  async pauseTask(agentId: string, taskId: string): Promise<ScheduledTaskEntity | null> {
    const existing = this.getActiveTask(agentId, taskId)
    if (!existing) return null
    // State-aware no-op: `setEnabled`'s changes>0 only reflects row existence,
    // and pausing an already-paused task would still bump `updatedAt`. The
    // read-decide-write sequence is fully synchronous — no await gap.
    if (!existing.enabled) return existing
    await application.get('JobManager').pauseJobScheduleById(taskId)
    logger.info('Task paused', { taskId, agentId })
    return this.getActiveTask(agentId, taskId)
  }

  resumeTask(agentId: string, taskId: string): ScheduledTaskEntity | null {
    const existing = this.getActiveTask(agentId, taskId)
    if (!existing) return null
    if (existing.status === 'missed') return existing
    // State-aware no-op: resuming an already-enabled task would re-register
    // the SchedulerService timer and reset an interval's phase.
    if (existing.enabled) return existing
    application.get('JobManager').resumeJobScheduleById(taskId)
    logger.info('Task resumed', { taskId, agentId })
    return this.getActiveTask(agentId, taskId)
  }

  /** @returns `false` when the task is not found / not owned by `agentId` (no distinction — no existence leak). */
  async deleteTask(agentId: string, taskId: string): Promise<boolean> {
    const existing = this.getActiveTask(agentId, taskId)
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
    // Use raw agentId ownership so malformed templates cannot strand armed schedules.
    const schedules = jobScheduleService.listAll({ type: AGENT_TASK_TYPE }).filter((s) => {
      const template = s.jobInputTemplate as { agentId?: unknown } | null
      return typeof template?.agentId === 'string' && template.agentId === agentId
    })

    // The heartbeat's user workspace row (pointing at the agent data directory)
    // outlives the agent unless removed here — it renders in the workspace picker.
    const heartbeatWorkspaceIds = new Set<string>()
    for (const schedule of schedules) {
      const template = readAgentTaskJobInputTemplate(schedule.jobInputTemplate)
      // Exact sentinels identify migrated heartbeats regardless of name.
      // Trim tolerance applies only to reserved names, preserving ordinary user workspaces.
      const exactSentinel = template?.prompt === HEARTBEAT_PROMPT_SENTINEL
      const reservedNameShape =
        schedule.name === `heartbeat_${agentId}` || schedule.name?.startsWith(`heartbeat_${agentId}__`)
      if (
        template &&
        template.workspace.type === AGENT_WORKSPACE_TYPE.USER &&
        (exactSentinel || (template.prompt.trim() === HEARTBEAT_PROMPT_SENTINEL && reservedNameShape))
      ) {
        heartbeatWorkspaceIds.add(template.workspace.workspaceId)
      }
    }

    let deleted = 0
    let failed = 0
    for (const schedule of schedules) {
      this.heartbeatAbort.signal.throwIfAborted()
      // Keep sweeping independent rows after a failure; pause survivors until startup repair.
      try {
        if (await application.get('JobManager').unregisterJobScheduleById(schedule.id)) {
          deleted += 1
        }
      } catch (error) {
        failed += 1
        logger.warn('Failed to unregister schedule for removed agent', { agentId, scheduleId: schedule.id, error })
        pauseHeartbeatSchedule(agentId, schedule.id, 'Failed to pause a schedule that survived the deletion sweep')
      }
    }
    if (failed > 0) {
      logger.warn('Some schedules survived the deletion sweep after transient failures', { agentId, failed })
    }
    for (const workspaceId of heartbeatWorkspaceIds) {
      try {
        // A reused workspace may serve other sessions, channels or tasks; preserve referenced rows.
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

  readHeartbeatDocument(agentId: string): Promise<HeartbeatDocument> {
    this.assertHeartbeatAvailable()
    return this.inFlightWork.track(readHeartbeatDocument(agentId))
  }

  writeHeartbeatDocument(agentId: string, document: HeartbeatDocument): Promise<HeartbeatDocument> {
    this.assertHeartbeatAvailable()
    return this.inFlightWork.track(writeHeartbeatDocument(agentId, document))
  }

  runHeartbeat(agentId: string): Promise<HeartbeatRunResult> {
    this.assertHeartbeatAvailable()
    if (this.heartbeatRuns.has(agentId)) return Promise.resolve('busy')
    this.heartbeatRuns.add(agentId)
    return this.inFlightWork.track(this.triggerHeartbeat(agentId).finally(() => this.heartbeatRuns.delete(agentId)))
  }

  private assertHeartbeatAvailable(): void {
    if (this.isShuttingDown || this.pauseHolds.size > 0) throw new Error('Agent jobs are temporarily paused')
  }

  private async triggerHeartbeat(agentId: string): Promise<HeartbeatRunResult> {
    await this.syncHeartbeat(agentId)
    this.assertHeartbeatAvailable()
    const agent = agentService.getAgent(agentId)
    if (!agent || !isHeartbeatEnabled(agent.configuration ?? {})) return 'disabled'
    const schedule = agentTaskService.getHeartbeatSchedule(agentId)
    if (!schedule?.enabled) return 'paused'
    const template = readAgentTaskJobInputTemplate(schedule.jobInputTemplate)
    if (template?.workspace.type !== 'user') return 'paused'
    const workspace = agentWorkspaceService.getById(template.workspace.workspaceId)
    if (!workspace?.path || !(await readHeartbeat(workspace.path))) return 'empty'
    this.assertHeartbeatAvailable()
    if (jobService.list({ scheduleId: schedule.id, status: ['pending', 'delayed', 'running'], limit: 1 }).length) {
      return 'busy'
    }
    return (await application.get('JobManager').triggerJobScheduleNowById(schedule.id)) ? 'started' : 'paused'
  }

  /** Run a scheduled agent task now (`ai.agent.task.run`). @returns whether the trigger fired (`false` = not found / not owned). */
  async runTask(agentId: string, taskId: string): Promise<boolean> {
    const existing = this.getActiveTask(agentId, taskId)
    if (!existing) return false
    if (existing.status === 'missed') {
      const enqueued = application.get('DbService').withWriteTx((tx) => {
        const schedule = jobScheduleService.getByIdTx(tx, taskId)
        if (!schedule || !isMissedTask(schedule.metadata)) return false
        const template = readAgentTaskJobInputTemplate(schedule.jobInputTemplate)
        if (!template) return false
        const missed = schedule.metadata.missed as { reason: string; at: number; jobId?: string }
        const job = application.get('JobManager').enqueueTx(tx, AGENT_TASK_TYPE, template, {
          scheduleId: taskId,
          idempotencyKey: `agent-task-missed:${taskId}:${missed.at}`
        })
        jobScheduleService.updateTx(tx, taskId, {
          metadata: { ...schedule.metadata, missed: { ...missed, jobId: job.id } }
        })
        return true
      })
      if (enqueued) agentTaskService.notifyReadModelChange([taskId])
      return enqueued
    }
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
    if (!agentService.agentExists(params.agentId)) return false
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
  private assertAgentIsActive(agentId: string): void {
    // Trashed is refused with missing: the row would register and arm, then the
    // post-commit read refuses a non-active owner, stranding the schedule.
    if (agentService.getLifecycleState(agentId) !== 'active') {
      throw new Error(`Agent not found: ${agentId}`)
    }
  }

  private getActiveTask(agentId: string, taskId: string): ScheduledTaskEntity | null {
    if (!agentService.agentExists(agentId)) return null
    return agentTaskService.getTask(agentId, taskId)
  }

  /**
   * The heartbeat sentinel is what identifies a heartbeat run, so a user task
   * must never carry it — not even padded with whitespace, which the deletion
   * sweep's tolerant identity would read as a heartbeat row: `AgentTaskService`
   * would hide the task and `runAgentTask` would run `heartbeat.md` under the
   * heartbeat toggle instead of the task's own prompt. Guarded here rather than
   * in `agentTaskFormSchema` because MCP's `cherryAutonomyTools` calls this
   * service directly.
   */
  private assertPromptNotReserved(prompt: string | undefined): void {
    if (prompt?.trim() === HEARTBEAT_PROMPT_SENTINEL) {
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
