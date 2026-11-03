import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { HEARTBEAT_PROMPT_SENTINEL } from '@data/services/AgentTaskService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { loggerService } from '@logger'
import { buildAgentSessionTopicId } from '@main/ai/agentSession/topic'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import {
  AGENT_TASK_DASHBOARD_CACHE_KEY,
  DASHBOARD_LONG_RUN_MS,
  type DashboardEntry,
  type DashboardStopResult
} from '@shared/ai/agentTaskDashboard'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import { debounce } from '@shared/utils/async'

const logger = loggerService.withContext('AgentTaskDashboardService')
const staleRun = Symbol('stale-dashboard-run')

interface TrackedWork {
  runId: string
  startedAt: number
  sourceJobId?: string
  timer?: ReturnType<typeof setTimeout>
}

@Injectable('AgentTaskDashboardService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['AgentSessionRuntimeService', 'JobManager'])
export class AgentTaskDashboardService extends BaseService {
  private readonly work = new Map<string, TrackedWork>()
  private readonly schedulePublish = debounce(() => this.observe(() => this.publish()), 250, { maxWait: 1000 })
  private stopped = false

  protected onInit(): void {
    this.stopped = false
    const runtime = application.get('AgentSessionRuntimeService')
    this.registerDisposable(runtime.onWorkChanged((sessionId) => this.observe(() => this.observeSession(sessionId))))
    this.registerDisposable(
      toolApprovalRegistry.onChanged((sessionId) => this.observe(() => this.observeSession(sessionId)))
    )
    this.registerDisposable(
      application.get('CacheService').subscribeSharedChange('jobs.state.${jobId}', (job, previous) => {
        if ((job ?? previous)?.type === 'agent.task') this.schedulePublish()
      })
    )
    this.registerDisposable(() => this.schedulePublish.cancel())
    for (const snapshot of runtime.listSnapshots()) this.observeSession(snapshot.sessionId)
    this.publish()
  }

  private observe(callback: () => void): void {
    if (this.stopped) return
    try {
      callback()
    } catch (error) {
      logger.error('Failed to update task dashboard', error as Error)
    }
  }

  private observeSession(sessionId: string): void {
    const snapshot = application.get('AgentSessionRuntimeService').inspect(sessionId)
    let tracked = this.work.get(sessionId)
    // A different admission source starts a separate episode even when the runtime stays allocated.
    if (tracked && tracked.sourceJobId !== snapshot?.sourceJobId) {
      this.release(sessionId, tracked)
      tracked = undefined
    }
    if (snapshot && (snapshot.busy || toolApprovalRegistry.hasSession(sessionId))) {
      if (!tracked) {
        const next: TrackedWork = {
          runId: `agent:${crypto.randomUUID()}`,
          startedAt: Date.now(),
          sourceJobId: snapshot.sourceJobId
        }
        this.work.set(sessionId, next)
        if (!next.sourceJobId) {
          next.timer = setTimeout(() => this.observe(() => this.publish()), DASHBOARD_LONG_RUN_MS)
          next.timer.unref?.()
        }
      }
    } else if (tracked) this.release(sessionId, tracked)
    this.schedulePublish()
  }

  private getSession(sessionId: string | null) {
    if (!sessionId) return null
    try {
      const session = agentSessionService.getById(sessionId)
      return session.deletedAt ? null : session
    } catch (error) {
      if (!isDataApiNotFoundError(error)) throw error
      return null
    }
  }

  private publish(): void {
    const runtime = application.get('AgentSessionRuntimeService')
    const groups = new Map<string, { entry: DashboardEntry; sortTime: number }>()
    const jobs = application.get('JobManager')
    for (const job of jobService.list({ type: 'agent.task', status: ['running'] })) {
      const input = job.input as { agentId?: string; prompt?: string }
      // DB rows can still say running before startup recovery; only live executions belong here.
      if (!jobs.isExecuting(job.id) || !job.startedAt || input.prompt === HEARTBEAT_PROMPT_SENTINEL) continue
      const agent = input.agentId ? agentService.getAgent(input.agentId) : null
      const schedule = job.scheduleId ? jobScheduleService.getById(job.scheduleId) : null
      const session = this.getSession(typeof job.metadata.sessionId === 'string' ? job.metadata.sessionId : null)
      const snapshot = session ? runtime.inspect(session.id) : undefined
      const ownsSession = snapshot?.sourceJobId === job.id
      const startedAt = Date.parse(job.startedAt)
      const id = `scheduled:${schedule?.id ?? job.id}`
      const runId = `scheduled:${job.id}`
      const entry: DashboardEntry = {
        id,
        source: 'scheduled',
        taskId: schedule?.id ?? null,
        sessionId: session?.id ?? null,
        agentId: agent?.id ?? null,
        nameSnapshot: schedule?.name ?? '',
        agentNameSnapshot: agent?.name ?? '',
        messageAnchor: ownsSession ? (snapshot?.assistantMessageId ?? null) : null,
        startedAt,
        blockedOn: ownsSession && session && toolApprovalRegistry.hasSession(session.id) ? 'approval' : null,
        runIds: [runId],
        runCount: 1
      }
      const group = groups.get(id)
      if (!group) groups.set(id, { entry, sortTime: startedAt })
      else {
        const latest = startedAt > group.sortTime ? entry : group.entry
        group.entry = {
          ...latest,
          startedAt: Math.min(group.entry.startedAt, startedAt),
          blockedOn: group.entry.blockedOn ?? entry.blockedOn,
          runIds: [...group.entry.runIds, runId],
          runCount: group.entry.runCount + 1
        }
        group.sortTime = Math.max(group.sortTime, startedAt)
      }
    }
    for (const [sessionId, tracked] of this.work) {
      if (tracked.sourceJobId || Date.now() - tracked.startedAt < DASHBOARD_LONG_RUN_MS) continue
      const snapshot = runtime.inspect(sessionId)
      const session = this.getSession(sessionId)
      if (!snapshot || !session) continue
      const agent = agentService.getAgent(snapshot.agentId)
      const id = `agent:${sessionId}`
      groups.set(id, {
        sortTime: tracked.startedAt,
        entry: {
          id,
          source: 'agent',
          taskId: null,
          sessionId,
          agentId: agent?.id ?? null,
          nameSnapshot: session.name,
          agentNameSnapshot: agent?.name ?? '',
          messageAnchor: snapshot.assistantMessageId ?? null,
          startedAt: tracked.startedAt,
          blockedOn: toolApprovalRegistry.hasSession(sessionId) ? 'approval' : null,
          runIds: [tracked.runId],
          runCount: 1
        }
      })
    }
    const entries = [...groups.values()]
      .sort(
        (a, b) =>
          Number(!!b.entry.blockedOn) - Number(!!a.entry.blockedOn) ||
          b.sortTime - a.sortTime ||
          a.entry.id.localeCompare(b.entry.id)
      )
      .map(({ entry }) => entry)
    application.get('CacheService').setShared(AGENT_TASK_DASHBOARD_CACHE_KEY, entries)
  }

  private release(sessionId: string, tracked: TrackedWork): void {
    clearTimeout(tracked.timer)
    this.work.delete(sessionId)
  }

  async stop(ids: string[]): Promise<DashboardStopResult[]> {
    return Promise.all(
      [...new Set(ids)].map(async (id): Promise<DashboardStopResult> => {
        try {
          if (id.startsWith('scheduled:')) {
            const jobId = id.slice('scheduled:'.length)
            const job = jobService.getById(jobId)
            if (
              !job ||
              job.type !== 'agent.task' ||
              job.status !== 'running' ||
              (job.input as { prompt?: string }).prompt === HEARTBEAT_PROMPT_SENTINEL ||
              !application.get('JobManager').isExecuting(jobId)
            )
              return { id, result: 'skipped' }
            const { outcome } = await application.get('JobManager').cancel(jobId, 'user-requested')
            return {
              id,
              result: outcome === 'not-cancellable' ? 'skipped' : outcome === 'timed-out' ? 'failed' : 'cancelled'
            }
          }
          const sessionId = [...this.work].find(([, tracked]) => !tracked.sourceJobId && tracked.runId === id)?.[0]
          if (!sessionId) return { id, result: 'skipped' }
          await application
            .get('AiStreamManager')
            .abortAndDrain(buildAgentSessionTopicId(sessionId), 'user-requested', () => {
              // Recheck under the stream's topic lock: a newer episode may have started while waiting.
              if (this.work.get(sessionId)?.runId !== id) throw staleRun
            })
          return { id, result: 'cancelled' }
        } catch (error) {
          if (error === staleRun) return { id, result: 'skipped' }
          logger.warn('Failed to stop dashboard run', { id, error })
          return { id, result: 'failed' }
        }
      })
    )
  }

  protected onStop(): void {
    this.stopped = true
    this.schedulePublish.cancel()
    for (const [sessionId, tracked] of this.work) this.release(sessionId, tracked)
    application.get('CacheService').setShared(AGENT_TASK_DASHBOARD_CACHE_KEY, [])
  }
}
