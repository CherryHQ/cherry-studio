/**
 * Job handler for `agent.task` — scheduled agent prompts.
 *
 * Thin metadata + execute wrapper; business logic lives in `./runAgentTask`.
 * Failure backstop: after three consecutive failed terminal jobs on the same
 * schedule, pauses the schedule (atomic `enabled=false` + circuit-breaker
 * marker, then a post-commit timer sync). The
 * `jobTable` rows are the single source of truth — no in-memory counter
 * (the legacy `SchedulerService.consecutiveErrors` map reset on every process
 * restart, making the breaker effectively unreachable in practice).
 */

import { application } from '@application'
import { agentTaskService, writeCircuitBreakerPaused } from '@data/services/AgentTaskService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { loggerService } from '@logger'
import type { JobHandler } from '@main/core/job/types'

import { type AgentTaskInput, runAgentTask } from './runAgentTask'

declare module '@main/core/job/jobRegistry' {
  interface JobRegistry {
    'agent.task': {
      agentId: string
      prompt: string
      workspace: AgentTaskInput['workspace']
      reuseRevision: number
      /** Per-task timeout in minutes. Enforced inside `runAgentTask`; handler-level
       *  `defaultTimeoutMs` is intentionally unset so each task may set its own value. */
      timeoutMinutes: number
    }
  }
}

const logger = loggerService.withContext('agentTaskJobHandler')

const RECENT_TERMINAL_WINDOW = 3

export const agentTaskJobHandler: JobHandler<AgentTaskInput> = {
  /** Preserve the existing at-least-once recovery contract; reuse mode inherits its crash-replay limitation. */
  recovery: 'retry',

  /** Bound same-agent parallelism to limit subprocess and workspace contention. */
  defaultQueue: (input) => `agent:${input.agentId}`,

  defaultConcurrency: 3,

  /**
   * Schedule-driven tasks do not retry inside the Job runtime — failure
   * surfaces to `onSettled` and the circuit breaker decides whether to pause.
   * Re-attempting an LLM call automatically is rarely helpful and can rack
   * up token spend without diagnostic value.
   */
  defaultRetryPolicy: { maxAttempts: 1, backoff: 'none', baseDelayMs: 0, maxDelayMs: 0 },

  async execute(ctx) {
    // The row is already `running` here; publish so open task lists leave the
    // previous run's state. JobContext carries no scheduleId — resolve the row.
    const scheduleId = jobService.getById(ctx.jobId)?.scheduleId
    if (scheduleId) agentTaskService.notifyReadModelChange([scheduleId])
    return await runAgentTask(ctx)
  },

  async onSettled(event) {
    if (event.scheduleId) agentTaskService.notifyReadModelChange([event.scheduleId])
    if (event.status !== 'failed' || !event.scheduleId) return
    // Captured once — closure capture would lose the narrowing above.
    const scheduleId = event.scheduleId

    const recent = jobService.listRecentTerminalByScheduleId(scheduleId, RECENT_TERMINAL_WINDOW)
    if (recent.length < RECENT_TERMINAL_WINDOW) return
    if (!recent.every((j) => j.status === 'failed')) return

    logger.warn('Agent task schedule failed in last N terminal runs — pausing', {
      scheduleId,
      window: RECENT_TERMINAL_WINDOW
    })
    try {
      // Pause and mark in one transaction: a heartbeat sync landing between a
      // separate pause commit and marker write would re-arm the schedule. The
      // post-commit timer sync disposes the armed timer (same two-step pattern
      // as the other schedule mutations).
      application.get('DbService').withWriteTx((tx) => {
        const snapshot = jobScheduleService.getByIdTx(tx, scheduleId)
        application.get('JobManager').updateJobScheduleTx(tx, scheduleId, {
          enabled: false,
          metadata: writeCircuitBreakerPaused(snapshot?.metadata, true)
        })
      })
      application.get('JobManager').syncJobScheduleTimerById(scheduleId)
    } catch (err) {
      logger.error('Failed to pause schedule after consecutive failures', err as Error, {
        scheduleId
      })
    }
  }
}
