import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentTaskRunService } from '@data/services/AgentTaskRunService'
import { HEARTBEAT_PROMPT_SENTINEL } from '@data/services/AgentTaskService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { loggerService } from '@logger'
import { buildAgentSessionTopicId } from '@main/ai/agentSession/topic'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { getFullChromeWindowInfos } from '@main/utils/fullChromeWindows'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import {
  DASHBOARD_IDLE_SECONDS,
  DASHBOARD_LONG_RUN_MS,
  type DashboardFinalStatus,
  type DashboardStopResult
} from '@shared/data/api/schemas/agentTaskDashboard'
import type { JobSnapshot } from '@shared/data/api/schemas/jobs'
import type { WindowId } from '@shared/ipc/types'

const logger = loggerService.withContext('AgentTaskDashboardService')
const staleRun = Symbol('stale-dashboard-run')

interface TrackedWork {
  runId: string
  startedAt: number
  rowId?: string
  messageAnchor?: string
  terminalStatus?: 'success' | 'paused' | 'error'
  excluded: boolean
  timer?: ReturnType<typeof setTimeout>
  unsubscribe: () => void
}

@Injectable('AgentTaskDashboardService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['AgentSessionRuntimeService', 'JobManager', 'PowerService'])
export class AgentTaskDashboardService extends BaseService {
  private readonly work = new Map<string, TrackedWork>()
  private readonly stopRequests = new Set<string>()
  private stopped = false
  private screenLocked = false

  protected onInit(): void {
    this.stopped = false
    for (const row of agentTaskRunService.listActive()) {
      if (row.source === 'agent') {
        agentTaskRunService.finish(row.id, 'failed', {
          endedAt: row.lastActivityAt ?? Date.now(),
          reasonCode: 'interrupted'
        })
      } else {
        agentTaskRunService.updateActive(row.id, { status: 'queued' })
      }
    }
    const runtime = application.get('AgentSessionRuntimeService')
    const jobs = application.get('JobManager')
    const power = application.get('PowerService')
    const resetAttention = () =>
      application.get('IpcApiService').broadcast('ai.agent.task_dashboard.attention_reset', undefined)
    this.registerDisposable(runtime.onWorkChanged((sessionId) => this.observe(() => this.observeSession(sessionId))))
    this.registerDisposable(jobs.onJobChanged((job) => this.observe(() => this.observeJob(job))))
    this.registerDisposable(jobs.onRecoveryCompleted(() => this.observe(() => this.reconcileJobs())))
    this.registerDisposable(
      power.onLockScreen(() => {
        this.screenLocked = true
        resetAttention()
      })
    )
    this.registerDisposable(
      power.onUnlockScreen(() => {
        this.screenLocked = false
        resetAttention()
      })
    )
    this.registerDisposable(power.onSuspend(resetAttention))
    this.registerDisposable(power.onResume(resetAttention))
    if (jobs.startupRecoveryComplete) this.reconcileJobs()
    this.registerInterval(
      () =>
        this.observe(() => {
          const rows = agentTaskRunService.listActive().filter((row) => row.status === 'running')
          agentTaskRunService.heartbeat(
            rows.map((row) => row.id),
            Date.now()
          )
        }),
      60_000
    )
    agentTaskRunService.purgeViewed()
    this.registerInterval(() => this.observe(() => agentTaskRunService.purgeViewed()), 24 * 60 * 60 * 1000)
  }

  private observe(callback: () => void): void {
    if (this.stopped) return
    try {
      callback()
    } catch (error) {
      logger.error('Failed to update task dashboard', error as Error)
    }
  }

  private reconcileJobs(): void {
    const jobs = application.get('JobManager')
    for (const row of agentTaskRunService.listActive().filter((row) => row.source === 'scheduled')) {
      const job = jobService.getById(row.runId)
      if (!job || (job.status === 'running' && !jobs.isExecuting(job.id))) {
        agentTaskRunService.finish(row.id, 'failed', {
          endedAt: row.lastActivityAt ?? Date.now(),
          reasonCode: 'interrupted'
        })
      } else this.observe(() => this.observeJob(job))
    }
    for (const row of jobService.getActiveByType('agent.task')) {
      const job = jobService.getById(row.id)
      if (job && jobs.isExecuting(job.id)) this.observe(() => this.observeJob(job))
    }
  }

  private observeJob(job: JobSnapshot): void {
    if (job.type !== 'agent.task') return
    const input = job.input as { agentId?: string; prompt?: string }
    let sessionId: string | null = null
    if (typeof job.metadata.sessionId === 'string') {
      try {
        const session = agentSessionService.getById(job.metadata.sessionId)
        sessionId = session.deletedAt ? null : session.id
      } catch (error) {
        if (!isDataApiNotFoundError(error)) throw error
      }
    }
    const terminal = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled'
    if (input.prompt === HEARTBEAT_PROMPT_SENTINEL) return
    let row = agentTaskRunService.getByRun('scheduled', job.id)
    if (!row && !job.startedAt && !terminal) return
    const agent = input.agentId ? agentService.getAgent(input.agentId) : undefined
    const schedule = job.scheduleId ? jobScheduleService.getById(job.scheduleId) : undefined
    row ??= agentTaskRunService.create({
      source: 'scheduled',
      runId: job.id,
      agentId: agent?.id ?? null,
      taskId: schedule?.id ?? null,
      sessionId,
      nameSnapshot: schedule?.name ?? '',
      agentNameSnapshot: agent?.name ?? '',
      startedAt: job.startedAt ? Date.parse(job.startedAt) : null,
      lastActivityAt: Date.now()
    })
    if (row.endedAt !== null) return
    const anchor = sessionId
      ? (application.get('AgentSessionRuntimeService').getWorkSnapshot(sessionId)?.messageAnchor ??
        this.work.get(sessionId)?.messageAnchor)
      : undefined
    agentTaskRunService.updateActive(row.id, {
      sessionId,
      startedAt: job.startedAt ? Date.parse(job.startedAt) : null,
      ...(terminal ? {} : { status: job.status === 'running' ? 'running' : 'queued' })
    })
    if (terminal) {
      const skipped = (job.output as { skipped?: boolean } | null)?.skipped === true
      const status: DashboardFinalStatus =
        job.status === 'completed' ? 'succeeded' : (job.status as DashboardFinalStatus)
      agentTaskRunService.finish(row.id, status, {
        messageAnchor: anchor ?? row.messageAnchor,
        endedAt: Date.parse(
          (status === 'cancelled' ? job.cancelRequestedAt : null) ?? job.finishedAt ?? new Date().toISOString()
        ),
        ...(skipped ? { viewedAt: Date.now() } : {}),
        reasonCode: status === 'cancelled' ? 'user_cancelled' : status === 'failed' ? 'error' : null,
        errorSummary: job.error?.message?.slice(0, 2000) ?? null
      })
      if (sessionId) queueMicrotask(() => this.observe(() => this.observeSession(sessionId)))
    }
  }

  private observeSession(sessionId: string): void {
    const runtime = application.get('AgentSessionRuntimeService')
    const snapshot = runtime.getWorkSnapshot(sessionId)
    const cache = application.get('CacheService')
    const key = `topic.stream.statuses.${buildAgentSessionTopicId(sessionId)}` as const
    const blocked = !!cache.getShared(key)?.awaitingApprovalAnchors?.length
    let tracked = this.work.get(sessionId)
    const scheduled = snapshot?.sourceJobId !== undefined
    if (snapshot?.busy || (snapshot && blocked)) {
      if (!tracked) {
        const next: TrackedWork = {
          runId: snapshot.turnId ?? crypto.randomUUID(),
          startedAt: Date.now(),
          excluded: scheduled,
          unsubscribe: cache.subscribeSharedChange(key, () => this.observe(() => this.observeSession(sessionId)))
        }
        this.work.set(sessionId, next)
        tracked = next
        if (!scheduled) {
          next.timer = setTimeout(
            () =>
              this.observe(() => {
                if (this.work.get(sessionId) === next) this.persistWork(sessionId, next)
              }),
            DASHBOARD_LONG_RUN_MS
          )
          next.timer.unref?.()
        }
      }
      tracked.messageAnchor = snapshot.messageAnchor ?? tracked.messageAnchor
      tracked.terminalStatus = snapshot.terminalStatus ?? tracked.terminalStatus
      if (tracked.rowId) this.updateApproval(tracked.rowId, blocked)
      if (snapshot.sourceJobId) {
        const row = agentTaskRunService.getByRun('scheduled', snapshot.sourceJobId)
        if (row) this.updateApproval(row.id, blocked)
      }
      return
    }
    if (!tracked) return
    tracked.terminalStatus = snapshot?.terminalStatus ?? tracked.terminalStatus
    tracked.messageAnchor = snapshot?.messageAnchor ?? tracked.messageAnchor
    try {
      if (!tracked.excluded && Date.now() - tracked.startedAt >= DASHBOARD_LONG_RUN_MS)
        this.persistWork(sessionId, tracked)
      if (tracked.rowId) {
        const cancelled = this.stopRequests.has(tracked.runId) || tracked.terminalStatus === 'paused'
        const status = cancelled ? 'cancelled' : tracked.terminalStatus === 'success' ? 'succeeded' : 'failed'
        agentTaskRunService.finish(tracked.rowId, status, {
          endedAt: Date.now(),
          messageAnchor: tracked.messageAnchor ?? null,
          reasonCode: cancelled ? 'user_cancelled' : status === 'failed' ? 'error' : null
        })
      }
    } finally {
      this.release(sessionId, tracked)
    }
  }

  private updateApproval(id: string, blocked: boolean): void {
    const row = agentTaskRunService.getById(id)
    const blockedOn = blocked ? 'approval' : null
    if (row && row.blockedOn !== blockedOn) {
      agentTaskRunService.updateActive(id, { blockedOn })
    }
  }

  private persistWork(sessionId: string, tracked: TrackedWork): void {
    if (tracked.rowId || tracked.excluded) return
    const session = agentSessionService.getById(sessionId)
    const agent = session.agentId ? agentService.getAgent(session.agentId) : undefined
    tracked.rowId = agentTaskRunService.create({
      source: 'agent',
      runId: tracked.runId,
      sessionId,
      agentId: agent?.id ?? null,
      nameSnapshot: session.name,
      agentNameSnapshot: agent?.name ?? '',
      startedAt: tracked.startedAt,
      lastActivityAt: Date.now(),
      messageAnchor: tracked.messageAnchor ?? null
    }).id
    const status = application
      .get('CacheService')
      .getShared(`topic.stream.statuses.${buildAgentSessionTopicId(sessionId)}`)
    this.updateApproval(tracked.rowId, !!status?.awaitingApprovalAnchors?.length)
  }

  private release(sessionId: string, tracked: TrackedWork): void {
    clearTimeout(tracked.timer)
    tracked.unsubscribe()
    this.work.delete(sessionId)
    this.stopRequests.delete(tracked.runId)
  }

  viewSession(sessionId: string, senderId: WindowId | null, automatic: boolean): void {
    const window = getFullChromeWindowInfos().find((candidate) => candidate.id === senderId)
    const power = application.get('PowerService')
    if (
      !window?.isFocused ||
      !window.isVisible ||
      this.screenLocked ||
      power.getPowerPhase() !== 'active' ||
      power.getSystemIdleState(DASHBOARD_IDLE_SECONDS) !== 'active'
    )
      return
    const session = agentSessionService.getById(sessionId)
    if (session.deletedAt) return
    const now = Date.now()
    agentTaskRunService.review({ sessionId, through: now, automatic }, now)
  }

  async stop(ids: string[]): Promise<DashboardStopResult[]> {
    return Promise.all(
      [...new Set(ids)].map(async (id): Promise<DashboardStopResult> => {
        const row = agentTaskRunService.getById(id)
        if (!row || row.status !== 'running') return { id, result: 'skipped' }
        try {
          if (row.source === 'scheduled') {
            const job = jobService.getById(row.runId)
            if (!job || job.status !== 'running') return { id, result: 'skipped' }
            const outcome = await application.get('JobManager').cancel(row.runId, 'user-requested')
            return {
              id,
              result:
                outcome.outcome === 'not-cancellable'
                  ? 'skipped'
                  : outcome.outcome === 'timed-out'
                    ? 'failed'
                    : 'cancelled'
            }
          }
          if (!row.sessionId) return { id, result: 'skipped' }
          await application
            .get('AiStreamManager')
            .abortAndDrain(buildAgentSessionTopicId(row.sessionId), 'user-requested', () => {
              if (
                this.work.get(row.sessionId!)?.runId !== row.runId ||
                agentTaskRunService.getById(id)?.status !== 'running'
              )
                throw staleRun
              this.stopRequests.add(row.runId)
            })
          return { id, result: 'cancelled' }
        } catch (error) {
          this.stopRequests.delete(row.runId)
          if (error === staleRun) return { id, result: 'skipped' }
          logger.warn('Failed to stop dashboard run', { id, error })
          return { id, result: 'failed' }
        }
      })
    )
  }

  protected onStop(): void {
    this.stopped = true
    for (const [sessionId, tracked] of this.work) {
      if (tracked.rowId)
        agentTaskRunService.finish(tracked.rowId, 'failed', { endedAt: Date.now(), reasonCode: 'interrupted' })
      this.release(sessionId, tracked)
    }
  }
}
