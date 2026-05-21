/**
 * Business logic for `agent.task` jobs — migrated from the legacy
 * `SchedulerService.runTask` flow. Owned by `AgentTaskJobHandler`.
 */

import { agentChannelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { loggerService } from '@logger'
import type { JobContext } from '@main/core/job/types'
import type { ChannelAdapter } from '@main/services/agents/services/channels'
import { channelManager } from '@main/services/agents/services/channels/ChannelManager'
import { broadcastSessionChanged } from '@main/services/agents/services/channels/sessionStreamIpc'
import { readHeartbeat } from '@main/services/agents/services/cherryclaw/heartbeat'
import { sessionMessageOrchestrator } from '@main/services/agents/services/SessionMessageOrchestrator'
import type { GetAgentSessionResponse } from '@types'

const logger = loggerService.withContext('runAgentTask')

const HEARTBEAT_PROMPT_SENTINEL = '__heartbeat__'
const HEARTBEAT_TASK_NAME = 'heartbeat'

export type AgentTaskInput = {
  agentId: string
  prompt: string
  timeoutMinutes: number
}

export type AgentTaskOutput = {
  /** Reused or newly-created session id; persisted to `jobTable.output` so the next
   *  fire can recover it via `jobService.list({ scheduleId, status: ['completed'] })`. */
  sessionId: string | null
  /** First 200 chars of the assistant reply, or a status marker for skipped runs. */
  result: string
}

type SubscribedChannel = { id: string; sessionId?: string | null }

/**
 * Wire an outer `AbortSignal` (provided by JobManager — covers user cancel,
 * handler-level timeout, shutdown) into a fresh `AbortController` plus an
 * optional per-task timeout. Returns the controller plus a `dispose` that
 * unbinds the inner timer (callers must invoke it from `finally`).
 */
function makeRunController(
  outerSignal: AbortSignal,
  timeoutMinutes: number | undefined
): { controller: AbortController; dispose: () => void } {
  const controller = new AbortController()
  const onOuterAbort = () => controller.abort(outerSignal.reason ?? new Error('Job aborted'))

  if (outerSignal.aborted) {
    onOuterAbort()
  } else {
    outerSignal.addEventListener('abort', onOuterAbort, { once: true })
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  if (timeoutMinutes && timeoutMinutes > 0) {
    timer = setTimeout(
      () => controller.abort(new Error(`Task timed out after ${timeoutMinutes} minutes`)),
      timeoutMinutes * 60_000
    )
  }

  return {
    controller,
    dispose: () => {
      if (timer) clearTimeout(timer)
      outerSignal.removeEventListener('abort', onOuterAbort)
    }
  }
}

export async function runAgentTask(ctx: JobContext<AgentTaskInput>): Promise<AgentTaskOutput> {
  const { agentId, prompt, timeoutMinutes } = ctx.input

  // schedule-fired jobs carry `scheduleId` on the row; manual ad-hoc enqueues
  // (no schedule) degrade gracefully: skip channel notification + session reuse.
  const jobSnapshot = await jobService.getById(ctx.jobId)
  const scheduleId = jobSnapshot?.scheduleId ?? null
  const scheduleSnapshot = scheduleId ? await jobScheduleService.getById(scheduleId) : null
  const taskName = scheduleSnapshot?.name ?? null

  const agent = await agentService.getAgent(agentId)
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`)
  }

  const config = agent.configuration ?? {}
  const workspacePath = agent.accessiblePaths?.[0]

  let effectivePrompt = prompt

  // Heartbeat (name='heartbeat' + sentinel prompt) — skip when disabled or
  // workspace missing; otherwise compose the periodic prompt from heartbeat.md.
  if (taskName === HEARTBEAT_TASK_NAME && prompt === HEARTBEAT_PROMPT_SENTINEL) {
    if (config.heartbeat_enabled === false || !workspacePath) {
      logger.debug('Heartbeat skipped (disabled or no workspace)', { agentId, scheduleId })
      return { sessionId: null, result: 'Skipped (disabled)' }
    }
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

  const subscribedChannels: SubscribedChannel[] = scheduleId
    ? (await agentChannelService.getSubscribedChannels(scheduleId)).map((c) => ({
        id: c.id,
        sessionId: c.sessionId
      }))
    : []

  // Reuse the session id from the latest completed run for context continuity;
  // fall back to creating a fresh session.
  let sessionId: string | undefined
  if (scheduleId) {
    const lastTerminal = await jobService.list({
      scheduleId,
      status: ['completed'],
      limit: 1
    })
    const lastOutput = lastTerminal[0]?.output as AgentTaskOutput | null
    const lastSessionId = lastOutput?.sessionId ?? null
    if (lastSessionId) {
      const reused = await agentSessionService.getSession(agentId, lastSessionId)
      if (reused) {
        sessionId = reused.id
        logger.debug('Reusing session from last completed run', { agentId, scheduleId, sessionId })
      }
    }
  }

  let session: GetAgentSessionResponse | null = null
  if (sessionId) {
    session = (await agentSessionService.getSession(agentId, sessionId)) as GetAgentSessionResponse | null
  }
  if (!session) {
    session = (await agentSessionService.createSession(agentId, {
      name: taskName ?? undefined
    })) as GetAgentSessionResponse | null
    if (!session) {
      throw new Error(`Failed to create session for agent ${agentId}`)
    }
    sessionId = session.id
  }

  const startTimeMs = Date.now()
  const { controller, dispose } = makeRunController(ctx.signal, timeoutMinutes)

  let resultText = ''
  let runError: Error | null = null

  try {
    const { stream, completion } = await sessionMessageOrchestrator.createSessionMessage(
      session,
      { content: effectivePrompt },
      controller,
      { persist: true }
    )

    const targetAdapters = subscribedChannels
      .map((ch) => channelManager.getAdapter(ch.id))
      .filter((a): a is ChannelAdapter => a !== undefined)

    resultText = await collectAndStreamResponse(stream, targetAdapters, controller.signal)
    await completion

    const aborted = controller.signal.aborted
    // Tell the renderer the session changed regardless, but flag whether the
    // run actually completed — UIs key off this to distinguish "session has a
    // new full reply" from "session was interrupted mid-stream".
    broadcastSessionChanged(agentId, session.id, !aborted)

    if (aborted) {
      const reason = controller.signal.reason
      throw reason instanceof Error ? reason : new Error(String(reason ?? 'Task aborted'))
    }
  } catch (err) {
    runError = err instanceof Error ? err : new Error(String(err))
    // Best-effort channel notification before re-throwing — failure to notify
    // a channel should not mask the real error reaching the Job runtime. On
    // user-initiated cancel we skip this: `collectAndStreamResponse` has
    // already surfaced the cancel via `onStreamError`, and a second "[Task
    // failed]" message would read as a duplicate / surprising notification.
    if (!controller.signal.aborted) {
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

/**
 * Read the orchestrator stream, accumulate the assistant reply, and fan out
 * each text-delta to channel adapters as they arrive. Mirrors the legacy
 * `SchedulerService.collectAndStreamResponse` for the happy-path on-channel
 * UX (typing indicator, intermediate text).
 *
 * On `signal.aborted` we route the final-delivery through `onStreamError`
 * rather than `onStreamComplete`/`sendMessage`, so channels receive an
 * explicit cancellation marker instead of a "completed reply" with whatever
 * partial text accumulated up to the abort.
 */
async function collectAndStreamResponse(
  stream: ReadableStream,
  adapters: ChannelAdapter[],
  signal: AbortSignal
): Promise<string> {
  const reader = stream.getReader()
  let completedText = ''
  let currentBlockText = ''

  const adapterChats = adapters.flatMap((a) => a.notifyChatIds.map((chatId) => ({ adapter: a, chatId })))

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const part = value as {
        type?: string
        text?: string
        providerMetadata?: { raw?: { type?: string } }
      }
      const rawType = part.providerMetadata?.raw?.type
      if (rawType === 'user') continue

      switch (part.type) {
        case 'text-delta':
          if (part.text) {
            currentBlockText = part.text
            const fullText = completedText + currentBlockText
            for (const { adapter, chatId } of adapterChats) {
              adapter
                .onTextUpdate(chatId, fullText)
                .catch((err) => logger.debug('Adapter onTextUpdate error', { channelId: adapter.channelId, err }))
            }
          }
          break
        case 'text-end':
          if (currentBlockText) {
            completedText += currentBlockText + '\n\n'
            currentBlockText = ''
          }
          break
      }
    }

    const finalText = (completedText + currentBlockText).replace(/\n+$/, '')

    // Cancellation path: the orchestrator closes the stream cleanly on abort
    // (no thrown error), so we reach here with `signal.aborted === true`.
    // Skip the "complete" broadcast — channels would otherwise interpret the
    // partial text as a successful reply.
    if (signal.aborted) {
      const reason = signal.reason
      const message = reason instanceof Error ? reason.message : String(reason ?? 'Task cancelled')
      for (const { adapter, chatId } of adapterChats) {
        adapter
          .onStreamError(chatId, message)
          .catch((err) => logger.debug('Adapter onStreamError error', { channelId: adapter.channelId, err }))
      }
      return finalText
    }

    for (const { adapter, chatId } of adapterChats) {
      try {
        const handled = await adapter.onStreamComplete(chatId, finalText)
        if (!handled && finalText) {
          await adapter.sendMessage(chatId, finalText)
        }
      } catch (err) {
        logger.warn('Failed to deliver final task response to channel', {
          channelId: adapter.channelId,
          chatId,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }

    return finalText
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    for (const { adapter, chatId } of adapterChats) {
      adapter
        .onStreamError(chatId, message)
        .catch((err) => logger.debug('Adapter onStreamError error', { channelId: adapter.channelId, err }))
    }
    throw error
  }
}

async function notifyTaskError(
  task: { id: string | null; name: string | null; durationMs: number },
  error: string,
  subscribedChannels: SubscribedChannel[]
): Promise<void> {
  if (subscribedChannels.length === 0) return
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
