/**
 * Job handler for `agent.task` — scheduled agent prompts.
 *
 * Thin metadata + execute wrapper; business logic lives in `./runAgentTask`.
 * Failure backstop: after three consecutive failed terminal jobs on the same
 * schedule, pauses the schedule via `JobManager.pauseJobScheduleById`. The
 * `jobTable` rows are the single source of truth — no in-memory counter
 * (the legacy `SchedulerService.consecutiveErrors` map reset on every process
 * restart, making the breaker effectively unreachable in practice).
 */

import { application } from '@application'
import { jobService } from '@data/services/JobService'
import { loggerService } from '@logger'
import type { JobHandler } from '@main/core/job/types'

import { runAgentTask } from './runAgentTask'

declare module '@main/core/job/jobRegistry' {
  interface JobRegistry {
    'agent.task': {
      agentId: string
      prompt: string
      /** Per-task timeout in minutes. Enforced inside `runAgentTask`; handler-level
       *  `defaultTimeoutMs` is intentionally unset so each task may set its own value. */
      timeoutMinutes: number
    }
  }
}

const logger = loggerService.withContext('AgentTaskJobHandler')

const RECENT_TERMINAL_WINDOW = 3

export const AgentTaskJobHandler: JobHandler<{ agentId: string; prompt: string; timeoutMinutes: number }> = {
  /**
   * 'retry': non-terminal jobs from a previous run are re-pended on startup
   * so the recovered job dispatches against the latest agent configuration.
   * This matches the legacy poll-loop semantics where a task missed by a
   * crash was simply picked up on the next 60s tick.
   */
  recovery: 'retry',

  /**
   * Per-agent serialization queue: a single agent never runs two scheduled
   * tasks concurrently (Claude Code subprocess + workspace state would
   * collide). Cross-agent parallelism is unaffected.
   */
  defaultQueue: (input) => `agent:${input.agentId}`,

  defaultConcurrency: 1,

  /**
   * Schedule-driven tasks do not retry inside the Job runtime — failure
   * surfaces to `onSettled` and the circuit breaker decides whether to pause.
   * Re-attempting an LLM call automatically is rarely helpful and can rack
   * up token spend without diagnostic value.
   */
  defaultRetryPolicy: { maxAttempts: 1, backoff: 'none', baseDelayMs: 0, maxDelayMs: 0 },

  async execute(ctx) {
    return await runAgentTask(ctx)
  },

  async onSettled(event) {
    if (event.status !== 'failed' || !event.scheduleId) return

    const recent = await jobService.listRecentTerminalByScheduleId(event.scheduleId, RECENT_TERMINAL_WINDOW)
    if (recent.length < RECENT_TERMINAL_WINDOW) return
    if (!recent.every((j) => j.status === 'failed')) return

    logger.warn('Agent task schedule failed in last N terminal runs — pausing', {
      scheduleId: event.scheduleId,
      window: RECENT_TERMINAL_WINDOW
    })
    try {
      await application.get('JobManager').pauseJobScheduleById(event.scheduleId)
    } catch (err) {
      logger.error('Failed to pause schedule after consecutive failures', err as Error, {
        scheduleId: event.scheduleId
      })
    }
  }
}
