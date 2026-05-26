/**
 * Business logic for `agent.task` jobs — owned by `AgentTaskJobHandler`.
 *
 * Each fire creates a fresh agent session. Per-fire sessions are recorded in
 * `job.output.sessionId` for audit only — there is no cross-fire session
 * reuse pointer on the schedule. Scheduled tasks are discrete background
 * invocations (heartbeat, periodic summary, polling), not conversations, so
 * carrying context across fires would only stuff the model's window with
 * stale state. Persistent agent memory belongs in workspace files
 * (`heartbeat.md`, agent memory) instead of session history.
 */

import { agentChannelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { sessionService } from '@data/services/SessionService'
import { loggerService } from '@logger'
import { readHeartbeat } from '@main/ai/agents/cherryclaw/heartbeat'
import { ChannelAdapterListener, type StreamListener } from '@main/ai/streamManager'
import { startAgentSessionRun } from '@main/ai/streamManager/api/startAgentSessionRun'
import { application } from '@main/core/application'
import type { JobContext } from '@main/core/job/types'

const logger = loggerService.withContext('runAgentTask')

const HEARTBEAT_PROMPT_SENTINEL = '__heartbeat__'
const HEARTBEAT_TASK_NAME = 'heartbeat'

export type AgentTaskInput = {
  agentId: string
  prompt: string
  timeoutMinutes: number
}

export type AgentTaskOutput = {
  /** Session created for this fire. Persisted to `jobTable.output` purely as
   *  an audit trail — the task scheduler never reads this back for continuity. */
  sessionId: string | null
  /** First 200 chars of the assistant reply, or a status marker for skipped runs. */
  result: string
}

/** Combine the JobManager-provided abort signal with an optional per-task timeout. */
function makeRunSignal(
  outerSignal: AbortSignal,
  timeoutMinutes: number | undefined
): { signal: AbortSignal; dispose: () => void } {
  if (!timeoutMinutes || timeoutMinutes <= 0) {
    return { signal: outerSignal, dispose: () => {} }
  }
  const timeoutSignal = AbortSignal.timeout(timeoutMinutes * 60_000)
  const signal = AbortSignal.any([outerSignal, timeoutSignal])
  return { signal, dispose: () => {} }
}

export async function runAgentTask(ctx: JobContext<AgentTaskInput>): Promise<AgentTaskOutput> {
  const { agentId, prompt, timeoutMinutes } = ctx.input

  // schedule-fired jobs carry `scheduleId` on the row; manual ad-hoc enqueues
  // (no schedule) degrade gracefully: skip channel notification.
  const jobSnapshot = await jobService.getById(ctx.jobId)
  const scheduleId = jobSnapshot?.scheduleId ?? null
  const scheduleSnapshot = scheduleId ? await jobScheduleService.getById(scheduleId) : null
  const taskName = scheduleSnapshot?.name ?? null

  const agent = await agentService.getAgent(agentId)
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`)
  }

  const config = agent.configuration ?? {}

  // Always create a fresh session per fire. Scheduled tasks are discrete
  // invocations; cross-fire session reuse would only carry stale model
  // context. Persistent state lives in workspace files (heartbeat.md, etc.).
  const session = await sessionService.createSession({ agentId, name: taskName ?? 'Scheduled task' })
  const workspacePath = session.workspace?.path

  let effectivePrompt = prompt

  // Heartbeat (name='heartbeat' + sentinel prompt) — skip when disabled or
  // workspace missing; otherwise compose the periodic prompt from heartbeat.md.
  if (taskName === HEARTBEAT_TASK_NAME && prompt === HEARTBEAT_PROMPT_SENTINEL) {
    if (config.heartbeat_enabled === false || !workspacePath) {
      logger.debug('Heartbeat skipped (disabled or no workspace)', { agentId, scheduleId })
      return { sessionId: session.id, result: 'Skipped (disabled)' }
    }
    const content = await readHeartbeat(workspacePath)
    if (!content) {
      logger.debug('Heartbeat skipped (no heartbeat.md)', { agentId, scheduleId })
      return { sessionId: session.id, result: 'Skipped (no file)' }
    }
    effectivePrompt = [
      '[Heartbeat]',
      'This is a periodic heartbeat. The instructions below are from your heartbeat.md file.',
      'Process each item, take action where possible, and use the notify tool to alert the user of important results.',
      '',
      '---',
      content
    ].join('\n')
  }

  const subscribedChannels = scheduleId ? await agentChannelService.getSubscribedChannels(scheduleId) : []

  const channelManager = application.get('ChannelManager')
  const channelListeners: StreamListener[] = subscribedChannels.flatMap((ch) => {
    const adapter = channelManager.getAdapter(ch.id)
    if (!adapter) return []
    return adapter.notifyChatIds.map((chatId) => new ChannelAdapterListener(adapter, chatId))
  })

  const { signal: runSignal, dispose } = makeRunSignal(ctx.signal, timeoutMinutes)
  const startTimeMs = Date.now()

  let resolveExecution!: (text: string) => void
  let rejectExecution!: (err: unknown) => void
  const executionDone = new Promise<string>((resolve, reject) => {
    resolveExecution = resolve
    rejectExecution = reject
  })
  let accumulatedText = ''
  const sentinel: StreamListener = {
    id: `agent-task:${scheduleId ?? ctx.jobId}`,
    onChunk(chunk) {
      const c = chunk as { type: string; text?: string }
      if (c.type === 'text-delta' && c.text) accumulatedText += c.text
    },
    onDone() {
      resolveExecution(accumulatedText.trim())
    },
    onPaused() {
      if (runSignal.aborted) {
        const reason = runSignal.reason
        rejectExecution(reason instanceof Error ? reason : new Error(String(reason ?? 'Task aborted')))
        return
      }
      resolveExecution(accumulatedText.trim())
    },
    onError(result) {
      rejectExecution(new Error(result.error.message ?? 'Execution failed'))
    },
    isAlive: () => !runSignal.aborted
  }

  let runError: Error | null = null
  let resultText = ''
  try {
    await startAgentSessionRun({
      sessionId: session.id,
      userParts: [{ type: 'text', text: effectivePrompt }],
      listeners: [sentinel, ...channelListeners]
    })

    resultText = await executionDone

    if (runSignal.aborted) {
      const reason = runSignal.reason
      throw reason instanceof Error ? reason : new Error(String(reason ?? 'Task aborted'))
    }
  } catch (err) {
    runError = err instanceof Error ? err : new Error(String(err))
    if (!runSignal.aborted && subscribedChannels.length > 0) {
      await notifyTaskError(
        { id: scheduleId, name: taskName, durationMs: Date.now() - startTimeMs },
        runError.message,
        subscribedChannels
      )
    }
    throw runError
  } finally {
    dispose()
  }

  return {
    sessionId: session.id,
    result: resultText.slice(0, 200) || 'Completed'
  }
}

async function notifyTaskError(
  task: { id: string | null; name: string | null; durationMs: number },
  error: string,
  subscribedChannels: Array<{ id: string }>
): Promise<void> {
  const channelManager = application.get('ChannelManager')
  try {
    const durationSec = Math.round(task.durationMs / 1000)
    const label = task.name ?? task.id ?? '(unknown)'
    const text = `[Task failed] ${label}\nDuration: ${durationSec}s\nError: ${error}`

    for (const ch of subscribedChannels) {
      const adapter = channelManager.getAdapter(ch.id)
      if (!adapter) continue
      for (const chatId of adapter.notifyChatIds) {
        adapter.sendMessage(chatId, text).catch((err) => {
          logger.warn('Failed to deliver task error notification', {
            scheduleId: task.id,
            channelId: ch.id,
            chatId,
            error: err instanceof Error ? err.message : String(err)
          })
        })
      }
    }
  } catch (err) {
    logger.warn('Error while building task error notification', {
      scheduleId: task.id,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}
