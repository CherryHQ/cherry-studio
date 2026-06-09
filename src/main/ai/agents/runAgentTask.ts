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
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { loggerService } from '@logger'
import { readHeartbeat } from '@main/ai/agents/cherryclaw/heartbeat'
import { buildAgentSessionTopicId } from '@main/ai/agentSession/topic'
import { ChannelAdapterListener, type StreamListener } from '@main/ai/streamManager'
import { startAgentSessionRun } from '@main/ai/streamManager/api/startAgentSessionRun'
import { application } from '@main/core/application'
import type { JobContext } from '@main/core/job/types'
import { ErrorCode, isDataApiError } from '@shared/data/api'
import { AGENT_WORKSPACE_TYPE, type AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'

const logger = loggerService.withContext('runAgentTask')

const HEARTBEAT_PROMPT_SENTINEL = '__heartbeat__'
const HEARTBEAT_TASK_NAME = 'heartbeat'

export type AgentTaskInput = {
  agentId: string
  prompt: string
  timeoutMinutes: number
  workspace: AgentSessionWorkspaceSource
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
  // Own the timeout so `dispose()` can actually release the timer on normal
  // completion (an `AbortSignal.timeout` keeps a live timer until it fires).
  const timeoutController = new AbortController()
  const timer = setTimeout(
    () => timeoutController.abort(new Error(`Task timed out after ${timeoutMinutes} minute(s)`)),
    timeoutMinutes * 60_000
  )
  const signal = AbortSignal.any([outerSignal, timeoutController.signal])
  return { signal, dispose: () => clearTimeout(timer) }
}

export async function runAgentTask(ctx: JobContext<AgentTaskInput>): Promise<AgentTaskOutput> {
  const { agentId, prompt, timeoutMinutes, workspace } = ctx.input

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

  const isHeartbeat = taskName === HEARTBEAT_TASK_NAME && prompt === HEARTBEAT_PROMPT_SENTINEL

  let effectivePrompt = prompt

  if (isHeartbeat) {
    if (config.heartbeat_enabled === false) {
      logger.debug('Heartbeat skipped (disabled)', { agentId, scheduleId })
      return { sessionId: null, result: 'Skipped (disabled)' }
    }
    switch (workspace.type) {
      case AGENT_WORKSPACE_TYPE.SYSTEM:
        logger.debug('Heartbeat skipped (no file)', { agentId, scheduleId })
        return { sessionId: null, result: 'Skipped (no file)' }
      case AGENT_WORKSPACE_TYPE.USER:
        break
      default: {
        const exhaustive: never = workspace
        throw new Error(`Unsupported heartbeat workspace source: ${String(exhaustive)}`)
      }
    }
    let workspaceRow: Awaited<ReturnType<typeof agentWorkspaceService.getById>>
    try {
      workspaceRow = await agentWorkspaceService.getById(workspace.workspaceId)
    } catch (error) {
      if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
        logger.debug('Heartbeat skipped (workspace deleted)', {
          agentId,
          scheduleId,
          workspaceId: workspace.workspaceId
        })
        return { sessionId: null, result: 'Skipped (workspace deleted)' }
      }
      throw error
    }
    if (workspaceRow.type !== AGENT_WORKSPACE_TYPE.USER) {
      throw new Error(`Heartbeat workspace must be user-owned: ${workspace.workspaceId}`)
    }
    const workspacePath = workspaceRow.path
    const content = await readHeartbeat(workspacePath)
    if (!content) {
      logger.debug('Heartbeat skipped (no heartbeat.md)', { agentId, scheduleId })
      return { sessionId: null, result: 'Skipped (no file)' }
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

  // Always create a fresh session per fire. Scheduled tasks are discrete
  // invocations; cross-fire session reuse would only carry stale model
  // context. Persistent state lives in workspace files (heartbeat.md, etc.).
  const session = await agentSessionService.create({
    agentId,
    name: taskName ?? 'Scheduled task',
    workspace
  })

  const subscribedChannels = scheduleId ? await agentChannelService.getSubscribedChannels(scheduleId) : []

  const channelManager = application.get('ChannelManager')
  const channelListeners: StreamListener[] = subscribedChannels.flatMap((ch) => {
    const adapter = channelManager.getAdapter(ch.id)
    if (!adapter) return []
    // Suppress the listener's generic `Error: …` — `notifyTaskError` below sends a richer
    // `[Task failed]` summary to the same chats, so leaving it on would double-notify.
    return adapter.notifyChatIds.map((chatId) => new ChannelAdapterListener(adapter, chatId, true))
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
      // `text-delta`'s field is `delta`, not `text` (AI SDK `UIMessageChunk`) — the
      // previous `as { text }` cast silently never accumulated, so the persisted
      // result was always the `'Completed'` fallback.
      if (chunk.type === 'text-delta') accumulatedText += chunk.delta
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
    // Keep `true`: the manager prunes a listener whose `isAlive()` is false BEFORE
    // firing its terminal callback, so gating on `runSignal` here would make an
    // aborted run's terminal event never settle `executionDone`. Abort is handled
    // explicitly via `onRunAbort` below.
    isAlive: () => true
  }

  const topicId = buildAgentSessionTopicId(session.id)
  // On JobManager cancel or per-task timeout, stop the upstream run: the execution's
  // own controller never sees `runSignal`, so abort the live stream and settle
  // `executionDone` here — otherwise the handler promise leaks until the JobManager's
  // force-finalize timeout.
  const onRunAbort = () => {
    const reason = runSignal.reason
    application
      .get('AiStreamManager')
      .abort(topicId, reason instanceof Error ? reason.message : String(reason ?? 'task-aborted'))
    rejectExecution(reason instanceof Error ? reason : new Error(String(reason ?? 'Task aborted')))
  }
  if (runSignal.aborted) onRunAbort()
  else runSignal.addEventListener('abort', onRunAbort, { once: true })

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
    runSignal.removeEventListener('abort', onRunAbort)
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
