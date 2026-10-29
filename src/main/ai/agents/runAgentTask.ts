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
 * Either way the session used by a fire is recorded in `job.metadata.sessionId`
 * before the run starts, so the run log keeps the link when the fire fails,
 * times out, or is cancelled; the reuse pointer is read from the constrained
 * relation, never from there (job rows are GC'd).
 */

import { application } from '@application'
import type { AgentSessionType } from '@data/db/schemas/agentSession'
import { agentChannelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import {
  readAdmittedRunJobIds,
  readLastExecutedRunJobId,
  readLastExecutedRunStartedAt,
  readTaskGuardApproval,
  HEARTBEAT_PROMPT_SENTINEL,
  normalizeTaskSessionReuseRevision,
  readTaskSessionReuse,
  type TaskSessionReuse
} from '@data/services/AgentTaskService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { loggerService } from '@logger'
import { agentDataDirectoryPath, assertAgentStorageDirectory } from '@main/ai/agents/agentDataDirectory'
import { readHeartbeat } from '@main/ai/agents/heartbeat'
import { pauseHeartbeatSchedule } from '@main/ai/agents/heartbeatSchedule'
import { evaluateTaskGuard } from '@main/ai/agents/taskGuard'
import { buildAgentSessionTopicId } from '@main/ai/agentSession/topic'
import { ChannelAdapterListener, startAgentSessionRun, type StreamListener } from '@main/ai/streamManager'
import type { JobContext } from '@main/core/job/types'
import { isHeartbeatEnabled } from '@shared/ai/agentHeartbeat'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { TaskGuard } from '@shared/data/api/schemas/agents'
import { AGENT_WORKSPACE_TYPE, type AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'

const logger = loggerService.withContext('runAgentTask')

export type AgentTaskInput = {
  agentId: string
  prompt: string
  timeoutMinutes: number
  workspace?: AgentSessionWorkspaceSource
  /** Fire-time precondition; absent on rows written before guards existed. */
  guard?: TaskGuard
  /** Reuse-config epoch captured when this job was enqueued. */
  reuseRevision: number
}

export type AgentTaskOutput = {
  /** First 200 chars of the assistant reply, or a status marker for skipped runs. */
  result: string
  /** Set when a guard stopped the run before any agent turn; the run log shows `skipped`. */
  skipped?: true
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
 * workspace, so the task's workspace source only applies when creating one.
 *
 * Admission is checked atomically under `startAgentSessionRun`'s topic lock, after this
 * read-side resolution step, so an interactive turn cannot slip through between check and start.
 */
function resolveTaskSession(params: {
  sessionType: AgentSessionType
  reuse: TaskSessionReuse
  reuseBinding: { scheduleId: string; reuseRevision: number } | null
  agentId: string
  name: string
  workspace: AgentSessionWorkspaceSource
}): ReturnType<typeof agentSessionService.create> {
  const { reuse, reuseBinding, agentId, name, workspace, sessionType } = params

  if (reuse.enabled && reuseBinding) {
    const existing = loadReusableSession(reuseBinding.scheduleId, agentId)
    if (existing) {
      return existing
    }
    logger.info('Reuse session unavailable — creating a new one', {
      scheduleId: reuseBinding?.scheduleId
    })
  }

  const session = agentSessionService.create({ agentId, name, workspace }, sessionType)
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

/**
 * Start time of the newest earlier run of this schedule that actually reached
 * the agent. Job history is disposable (hourly GC prunes terminal rows by TTL
 * and count), so the durable watermark lives in schedule metadata; the history
 * scan remains as a fallback for schedules that predate it.
 */
function findLastExecutedRunStart(scheduleId: string, currentJobId: string): number | null {
  for (const job of jobService.list({ scheduleId })) {
    if (job.id === currentJobId || !job.startedAt) continue
    // Positive execution evidence only: a completed run whose result is not a
    // skip marker actually reached the agent. `startedAt` alone is not proof —
    // a first attempt whose session creation fails before admission would
    // otherwise become the baseline and skip the unprocessed file after repair.
    if (job.status !== 'completed') continue
    const output = job.output as { skipped?: boolean; result?: string } | null
    if (output?.skipped === true) continue
    // Legacy rows predate `output.skipped`: their busy/guard skips survive only
    // as a `Skipped (…)` result marker, which is likewise not execution evidence.
    if (typeof output?.result === 'string' && output.result.startsWith('Skipped (')) continue
    const startedMs = Date.parse(job.startedAt)
    if (Number.isFinite(startedMs)) return startedMs
  }
  return null
}

export async function runAgentTask(ctx: JobContext<AgentTaskInput>): Promise<AgentTaskOutput> {
  const { agentId, prompt, timeoutMinutes } = ctx.input

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

  // Identity is the reserved prompt, not the schedule name — see HEARTBEAT_PROMPT_SENTINEL.
  const isHeartbeat = prompt === HEARTBEAT_PROMPT_SENTINEL
  const workspace: AgentSessionWorkspaceSource = isHeartbeat
    ? { type: AGENT_WORKSPACE_TYPE.SYSTEM }
    : (ctx.input.workspace ?? { type: AGENT_WORKSPACE_TYPE.SYSTEM })

  let effectivePrompt = prompt

  if (isHeartbeat) {
    if (!isHeartbeatEnabled(config)) {
      logger.debug('Heartbeat skipped (disabled)', { agentId, scheduleId })
      return { result: 'Skipped (disabled)' }
    }
    // Runtime changes may bypass heartbeat configuration events; recheck capabilities at execution.
    const capabilities = Object.hasOwn(AGENT_RUNTIME_CAPABILITIES, agent.type)
      ? AGENT_RUNTIME_CAPABILITIES[agent.type]
      : undefined
    if (capabilities?.heartbeat !== true) {
      logger.debug('Heartbeat skipped (runtime lacks the capability)', { agentId, scheduleId, type: agent.type })
      return { result: 'Skipped (capability)' }
    }
    const agentsDataRoot = application.getPath('feature.agents.data')
    const agentDataPath = agentDataDirectoryPath(agentsDataRoot, agentId)
    // Revalidate at execution because directories may be replaced after provisioning.
    try {
      await assertAgentStorageDirectory(agentsDataRoot, agentDataPath)
    } catch (error) {
      logger.warn('Heartbeat agent data directory failed the storage check; skipping tick', {
        agentId,
        scheduleId,
        agentDataPath,
        error
      })
      const liveTemplate = scheduleSnapshot?.jobInputTemplate as { agentId?: unknown; prompt?: unknown } | null
      if (
        scheduleId &&
        scheduleSnapshot?.type === 'agent.task' &&
        liveTemplate?.agentId === agentId &&
        liveTemplate?.prompt === HEARTBEAT_PROMPT_SENTINEL
      ) {
        pauseHeartbeatSchedule(
          agentId,
          scheduleId,
          'Failed to pause heartbeat schedule on an untrusted agent data path'
        )
        void application
          .get('AgentJobsService')
          .syncHeartbeat(agentId)
          .catch((error) => {
            logger.warn('Post-pause heartbeat sync failed', { agentId, scheduleId, error })
          })
      }
      return { result: 'Skipped (untrusted agent data path)' }
    }
    const content = await readHeartbeat(agentDataPath)
    if (!content) {
      logger.debug('Heartbeat skipped (no heartbeat.md)', { agentId, scheduleId })
      return { result: 'Skipped (no file)' }
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

  if (!isHeartbeat && ctx.input.guard && ctx.input.guard.type !== 'always') {
    // Shell authorization gate: a command guard reaches main-process `exec`, so
    // it runs only after the user approved that exact command string. Agent
    // paths (MCP cron) can persist the guard but can never write the approval
    // record — without this check an agent with Bash disabled could still
    // execute host commands by scheduling a guard. Fail closed: the fire skips
    // (visibly, in the run log) until approval lands.
    if (ctx.input.guard.type === 'command') {
      const approval = readTaskGuardApproval(scheduleSnapshot?.metadata)
      if (approval?.command !== ctx.input.guard.command) {
        logger.debug('Task skipped: command guard pending user approval', { agentId, scheduleId })
        return {
          result:
            'Skipped (guard: command pending user approval). After approving the exact command in Settings > Scheduled Tasks, run the task manually or wait for the next scheduled fire.',
          skipped: true
        }
      }
    }
    // Crash recovery replays the same job under `recovery: 'retry'`. Admission
    // was already persisted for that job (watermark + jobId are written when a
    // run reaches the agent), so the replay must not re-face the guard against
    // its own watermark — an unchanged file would otherwise convert recovery
    // into a completed skip and drop the unfinished work. New scheduled fires
    // (different jobId) still evaluate the guard normally.
    // Membership covers overlapping admissions: with B admitted while A was
    // unfinished, the single slot names B, but A's replay is still a replay.
    // The slot equality remains for schedules admitted before the set existed.
    const isRecoveryReplay =
      scheduleId !== null &&
      (readAdmittedRunJobIds(scheduleSnapshot?.metadata).includes(ctx.jobId) ||
        readLastExecutedRunJobId(scheduleSnapshot?.metadata) === ctx.jobId)
    if (!isRecoveryReplay) {
      const metadataBaseline = scheduleId ? readLastExecutedRunStartedAt(scheduleSnapshot?.metadata) : null
      const recoveredBaseline =
        scheduleId && metadataBaseline === null ? findLastExecutedRunStart(scheduleId, ctx.jobId) : null
      const lastRunStartedAt = metadataBaseline ?? recoveredBaseline
      const outcome = await evaluateTaskGuard(ctx.input.guard, { lastRunStartedAt, signal: ctx.signal })
      if (!outcome.proceed) {
        // A history-derived baseline disappears with the row when job GC
        // prunes it; persist it so the unchanged file stays skipped instead of
        // starting an agent turn after pruning.
        if (scheduleId && recoveredBaseline !== null) {
          try {
            application
              .get('AgentJobsService')
              .persistRecoveredTaskBaseline({ scheduleId, baselineMs: recoveredBaseline })
          } catch (error) {
            logger.warn('Failed to persist the recovered guard baseline', {
              scheduleId,
              error: (error as Error).message
            })
          }
        }
        logger.debug('Task skipped by guard', { agentId, scheduleId, reason: outcome.reason })
        return { result: `Skipped (guard: ${outcome.reason})`, skipped: true }
      }
    }
  }

  const expectedReuseRevision = normalizeTaskSessionReuseRevision(ctx.input.reuseRevision)
  const currentReuse = readTaskSessionReuse(scheduleSnapshot?.metadata)
  // A queued job captures the reuse epoch at enqueue time. It must not attach
  // to a sticky session selected by a newer task configuration.
  const reuseIsCurrent =
    !isHeartbeat &&
    scheduleSnapshot?.type === 'agent.task' &&
    currentReuse.enabled &&
    currentReuse.revision === expectedReuseRevision
  const reuseBinding = reuseIsCurrent && scheduleId ? { scheduleId, reuseRevision: expectedReuseRevision } : null
  const sessionType = isHeartbeat ? 'background' : 'conversation'
  let session = resolveTaskSession({
    sessionType,
    reuse: reuseIsCurrent ? currentReuse : { enabled: false, revision: expectedReuseRevision },
    reuseBinding,
    agentId,
    name: taskName ?? 'Scheduled task',
    workspace
  })
  // Snapshot the task's configured recipients before starting the run. Adapter availability affects
  // delivery, not authority: a temporarily disconnected configured channel must not hide `notify`.
  const subscribedChannels = scheduleId
    ? agentChannelService.getSubscribedChannels(scheduleId).filter((channel) => channel.agentId === agentId)
    : []
  const trustedNotifyChannels = subscribedChannels
    .map((channel) => ({ id: channel.id, type: channel.type }))
    .sort((left, right) => left.id.localeCompare(right.id))
  const channelManager = application.get('ChannelManager')
  const channelListeners: StreamListener[] = subscribedChannels.flatMap((channel) => {
    const adapter = channelManager.getAdapter(channel.id)
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
  const sentinel: StreamListener = {
    id: `agent-task:${scheduleId ?? ctx.jobId}`,
    onChunk(chunk) {
      // `text-delta`'s field is `delta`, not `text` (AI SDK `UIMessageChunk`) — the
      // previous `as { text }` cast silently never accumulated, so the persisted
      // result was always the `'Completed'` fallback.
      if (chunk.type === 'text-delta') accumulatedText += chunk.delta
    },
    // Stream manager already snapshots and invokes every listener, including the
    // channel sinks. Re-invoking them here delivered each cron result twice.
    onDone() {
      complete(() => resolveExecution(accumulatedText.trim()))
    },
    onPaused() {
      if (runSignal.aborted) {
        const reason = runSignal.reason
        complete(() => rejectExecution(reason instanceof Error ? reason : new Error(String(reason ?? 'Task aborted'))))
        return
      }
      complete(() => resolveExecution(accumulatedText.trim()))
    },
    onError(result) {
      complete(() => rejectExecution(new Error(result.error.message ?? 'Execution failed')))
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
      await ctx.patchMetadata({ sessionId: session.id })
      const started = await startAgentSessionRun({
        sessionId: session.id,
        userParts: [{ type: 'text', text: effectivePrompt }],
        listeners: [sentinel, ...channelListeners],
        headless: true,
        trustedNotifyChannels,
        requireIdle: { expectedAgentId: agentId }
      })
      if (started.mode === 'started') {
        // The run reached the agent: advance the durable guard watermark.
        if (scheduleId) {
          const startedMs = jobSnapshot?.startedAt ? Date.parse(jobSnapshot.startedAt) : Number.NaN
          application.get('AgentJobsService').recordTaskExecutionStart({
            scheduleId,
            startedAtMs: Number.isFinite(startedMs) ? startedMs : Date.now(),
            jobId: ctx.jobId
          })
        }
        break
      }
      if (runSignal.aborted) {
        completionActive = false
        const reason = runSignal.reason
        throw reason instanceof Error ? reason : new Error(String(reason ?? 'Task aborted'))
      }
      if (started.reason === 'busy') {
        completionActive = false
        // A busy skip never reached the agent: mark it skipped so it neither
        // displays as an executed run nor advances the guard watermark.
        return { result: 'Skipped (session busy)', skipped: true }
      }
      if (rebound) throw new Error(`Agent session ${session.id} became invalid while starting task`)
      rebound = true
      session = agentSessionService.create({ agentId, name: taskName ?? 'Scheduled task', workspace }, sessionType)
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

  return { result: resultText.slice(0, 200) || 'Completed' }
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
