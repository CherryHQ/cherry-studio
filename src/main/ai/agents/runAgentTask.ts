/**
 * Business logic for `agent.task` jobs — owned by `agentTaskJobHandler`.
 *
 * By default each fire creates a fresh agent session: scheduled tasks are
 * discrete background invocations (heartbeat, periodic summary, polling), not
 * conversations, so carrying context across fires would only stuff the model's
 * window with stale state. Persistent agent memory belongs in workspace files
 * (`heartbeat.md`, agent memory) instead of session history.
 *
 * A task may opt into `reuseSession`, which binds one sticky session through a
 * constrained session→schedule relation and continues it on every
 * fire. That session grows unbounded by design — reset it by disabling and
 * saving, then enabling and saving. Rotate automatically only if unbounded
 * growth turns out to bite in practice.
 *
 * Because a sticky session is reachable by the user (the run log links to it),
 * a reusing fire stands down when that session already has a turn in flight.
 * Admission is enforced under the stream manager's per-topic dispatch lock.
 *
 * Either way the session used by a fire is recorded in `job.output.sessionId`
 * for the run log; the reuse pointer is read from the constrained relation,
 * never from there (job rows are GC'd).
 */

import { application } from '@application'
import { agentChannelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import {
  normalizeTaskSessionReuseRevision,
  readTaskSessionReuse,
  type TaskSessionReuse
} from '@data/services/AgentTaskService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { loggerService } from '@logger'
import { readHeartbeat } from '@main/ai/agents/heartbeat'
import { buildAgentSessionTopicId } from '@main/ai/agentSession/topic'
import { ChannelAdapterListener, startAgentSessionRun, type StreamListener } from '@main/ai/streamManager'
import type { JobContext } from '@main/core/job/types'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'
import { AGENT_WORKSPACE_TYPE, type AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'

const logger = loggerService.withContext('runAgentTask')

const HEARTBEAT_PROMPT_SENTINEL = '__heartbeat__'
const HEARTBEAT_TASK_NAME = 'heartbeat'

export type AgentTaskInput = {
  agentId: string
  prompt: string
  timeoutMinutes: number
  workspace: AgentSessionWorkspaceSource
  /** Reuse-config epoch captured when this job was enqueued. */
  reuseRevision: number
}

export type AgentTaskOutput = {
  /** Session this fire ran in — created fresh, or the sticky one under
   *  `reuseSession`. Persisted to `jobTable.output` purely as an audit trail;
   *  continuity is driven by the schedule's reuse pointer, never by this. */
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

/**
 * Load the sticky session for a reusing task, or `null` when it can no longer
 * be used — deleted, or (defensively) re-owned by a different agent. Callers
 * treat `null` as "rebind a fresh one" rather than an error: a user deleting
 * the session must not break the schedule.
 */
function loadReusableSession(taskScheduleId: string, agentId: string) {
  const session = agentSessionService.getByTaskScheduleId(taskScheduleId)
  if (!session) return null
  if (session.agentId !== agentId) {
    logger.warn('Reuse session belongs to another agent — rebinding', { taskScheduleId, agentId })
    return null
  }
  return session
}

/**
 * Resolve the session this fire runs in. A reused session keeps its own
 * workspace, so the task's `workspace` field only applies when creating one —
 * system for regular tasks (the picker defaults there), the validated user
 * workspace for heartbeats.
 *
 * Admission is checked atomically under `startAgentSessionRun`'s topic lock, after this
 * read-side resolution step, so an interactive turn cannot slip through between check and start.
 */
function resolveTaskSession(params: {
  reuse: TaskSessionReuse
  reuseBinding: { scheduleId: string; reuseRevision: number } | null
  agentId: string
  name: string
  workspace: AgentSessionWorkspaceSource
}): ReturnType<typeof agentSessionService.create> {
  const { reuse, reuseBinding, agentId, name, workspace } = params

  if (reuse.enabled && reuseBinding) {
    const existing = loadReusableSession(reuseBinding.scheduleId, agentId)
    if (existing) {
      return existing
    }
    logger.info('Reuse session unavailable — creating a new one', {
      scheduleId: reuseBinding?.scheduleId
    })
  }

  const session = agentSessionService.create({ agentId, name, workspace })
  if (reuse.enabled && reuseBinding) {
    application.get('AgentJobsService').bindTaskSessionReuse({
      ...reuseBinding,
      sessionId: session.id,
      agentId,
      workspace
    })
  }
  return session
}

export async function runAgentTask(ctx: JobContext<AgentTaskInput>): Promise<AgentTaskOutput> {
  const { agentId, prompt, timeoutMinutes, workspace } = ctx.input

  // schedule-fired jobs carry `scheduleId` on the row; manual ad-hoc enqueues
  // (no schedule) degrade gracefully: skip channel notification.
  const jobSnapshot = jobService.getById(ctx.jobId)
  const scheduleId = jobSnapshot?.scheduleId ?? null
  const scheduleSnapshot = scheduleId ? jobScheduleService.getById(scheduleId) : null
  const taskName = scheduleSnapshot?.name ?? null

  const agent = agentService.getAgent(agentId)
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
      workspaceRow = agentWorkspaceService.getById(workspace.workspaceId)
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

  const expectedReuseRevision = normalizeTaskSessionReuseRevision(ctx.input.reuseRevision)
  const currentReuse = readTaskSessionReuse(scheduleSnapshot?.metadata)
  // A queued job captures the reuse epoch at enqueue time. It must not attach
  // to a sticky session selected by a newer task configuration.
  const reuseIsCurrent =
    scheduleSnapshot?.type === 'agent.task' && currentReuse.enabled && currentReuse.revision === expectedReuseRevision
  const reuseBinding = reuseIsCurrent && scheduleId ? { scheduleId, reuseRevision: expectedReuseRevision } : null
  let session = resolveTaskSession({
    reuse: reuseIsCurrent ? currentReuse : { enabled: false, revision: expectedReuseRevision },
    reuseBinding,
    agentId,
    name: taskName ?? 'Scheduled task',
    workspace
  })
  // Guards legacy rows and races that data hygiene cannot catch.
  const subscribedChannels = scheduleId
    ? agentChannelService.getSubscribedChannels(scheduleId).filter((channel) => channel.agentId === agentId)
    : []

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
  let topicId = buildAgentSessionTopicId(session.id)
  let accumulatedText = ''
  let completionActive = true
  const complete = (settle: () => void) => {
    if (!completionActive) return
    completionActive = false
    // `startRuntimeTurn` carries ordinary listeners into a queued successor. Remove this fire's
    // task/channel listeners synchronously, before the later runtime terminal listener can launch it.
    for (const listener of channelListeners) application.get('AiStreamManager').removeListener(topicId, listener.id)
    application.get('AiStreamManager').removeListener(topicId, `agent-task:${scheduleId ?? ctx.jobId}`)
    settle()
  }
  const fanOutTerminalToChannels = (invoke: (listener: StreamListener) => void | Promise<void>) => {
    for (const listener of channelListeners) {
      if (!listener.isAlive()) continue
      try {
        void Promise.resolve(invoke(listener)).catch((error) => {
          logger.warn('Task channel terminal listener failed', { scheduleId, error })
        })
      } catch (error) {
        logger.warn('Task channel terminal listener threw', { scheduleId, error })
      }
    }
  }
  const sentinel: StreamListener = {
    id: `agent-task:${scheduleId ?? ctx.jobId}`,
    onChunk(chunk) {
      // `text-delta`'s field is `delta`, not `text` (AI SDK `UIMessageChunk`) — the
      // previous `as { text }` cast silently never accumulated, so the persisted
      // result was always the `'Completed'` fallback.
      if (chunk.type === 'text-delta') accumulatedText += chunk.delta
    },
    onDone(result) {
      complete(() => resolveExecution(accumulatedText.trim()))
      fanOutTerminalToChannels((listener) => listener.onDone(result))
    },
    onPaused(result) {
      if (runSignal.aborted) {
        const reason = runSignal.reason
        complete(() => rejectExecution(reason instanceof Error ? reason : new Error(String(reason ?? 'Task aborted'))))
        fanOutTerminalToChannels((listener) => listener.onPaused(result))
        return
      }
      complete(() => resolveExecution(accumulatedText.trim()))
      fanOutTerminalToChannels((listener) => listener.onPaused(result))
    },
    onError(result) {
      complete(() => rejectExecution(new Error(result.error.message ?? 'Execution failed')))
      fanOutTerminalToChannels((listener) => listener.onError(result))
    },
    // Terminal dispatch calls this before every event. `complete()` is only reached by that
    // terminal callback, then removes the listener synchronously before a queued successor starts.
    isAlive: () => completionActive
  }

  // On JobManager cancel or per-task timeout, stop the upstream run: the execution's
  // own controller never sees `runSignal`, so abort the live stream and settle
  // `executionDone` here — otherwise the handler promise leaks until the JobManager's
  // force-finalize timeout.
  const onRunAbort = () => {
    if (!completionActive) return
    completionActive = false
    for (const listener of channelListeners) application.get('AiStreamManager').removeListener(topicId, listener.id)
    application.get('AiStreamManager').removeListener(topicId, sentinel.id)
    const reason = runSignal.reason
    application
      .get('AiStreamManager')
      .abort(topicId, reason instanceof Error ? reason.message : String(reason ?? 'task-aborted'))
    rejectExecution(reason instanceof Error ? reason : new Error(String(reason ?? 'Task aborted')))
  }
  let runError: Error | null = null
  let resultText = ''
  try {
    let rebound = false
    while (true) {
      const started = await startAgentSessionRun({
        sessionId: session.id,
        userParts: [{ type: 'text', text: effectivePrompt }],
        listeners: [sentinel, ...channelListeners],
        headless: true,
        requireIdle: { expectedAgentId: agentId }
      })
      if (started.mode === 'started') break
      if (runSignal.aborted) {
        completionActive = false
        const reason = runSignal.reason
        throw reason instanceof Error ? reason : new Error(String(reason ?? 'Task aborted'))
      }
      if (started.reason === 'busy') {
        completionActive = false
        return { sessionId: session.id, result: 'Skipped (session busy)' }
      }
      if (rebound) throw new Error(`Agent session ${session.id} became invalid while starting task`)
      rebound = true
      session = agentSessionService.create({ agentId, name: taskName ?? 'Scheduled task', workspace })
      topicId = buildAgentSessionTopicId(session.id)
      if (reuseBinding) {
        application.get('AgentJobsService').bindTaskSessionReuse({
          ...reuseBinding,
          sessionId: session.id,
          agentId,
          workspace
        })
      }
    }

    // Do not arm topic-level cancellation before admission. While this call waits for the
    // dispatch lock, the topic may legitimately belong to a user's live turn; aborting there
    // would kill exactly the stream that `requireIdle` is meant to stand down from.
    if (runSignal.aborted) onRunAbort()
    else runSignal.addEventListener('abort', onRunAbort, { once: true })

    resultText = await executionDone
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
