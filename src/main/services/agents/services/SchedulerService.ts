import { loggerService } from '@logger'
import type { CherryClawConfiguration, ScheduledTaskEntity } from '@types'

import { agentService } from './AgentService'
import type { ChannelAdapter } from './channels'
import { channelManager } from './channels/ChannelManager'
import { broadcastSessionChanged } from './channels/sessionStreamIpc'
import { channelService } from './ChannelService'
import { readHeartbeat } from './cherryclaw/heartbeat'
import { sessionMessageService } from './SessionMessageService'
import { sessionService } from './SessionService'
import { taskService } from './TaskService'

const logger = loggerService.withContext('SchedulerService')

const POLL_INTERVAL_MS = 60_000
const MAX_CONSECUTIVE_ERRORS = 3

type RunningTask = {
  taskId: string
  agentId: string
  abortController: AbortController
}

// TODO: refactor lifecycle in V2
class SchedulerService {
  private static instance: SchedulerService | null = null
  private pollTimer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private readonly activeTasks = new Map<string, RunningTask>()
  private readonly consecutiveErrors = new Map<string, number>()
  static getInstance(): SchedulerService {
    if (!SchedulerService.instance) {
      SchedulerService.instance = new SchedulerService()
    }
    return SchedulerService.instance
  }

  startLoop(): void {
    if (this.running) {
      logger.debug('Scheduler loop already running')
      return
    }
    this.running = true
    logger.info('Scheduler poll loop started')
    this.poll()
  }

  stopLoop(): void {
    this.running = false
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }
    // Abort all running tasks
    for (const [taskId, rt] of this.activeTasks) {
      rt.abortController.abort()
      logger.info('Aborted running task on shutdown', { taskId })
    }
    this.activeTasks.clear()
    logger.info('Scheduler poll loop stopped')
  }

  /** Ensure the poll loop is running after agent config changes. */
  async syncScheduler(): Promise<void> {
    const hasActive = await taskService.hasActiveTasks()
    if (hasActive) {
      this.startLoop()
    } else {
      logger.debug('No active tasks, skipping scheduler start')
    }
  }

  stopAll(): void {
    this.stopLoop()
  }

  async restoreSchedulers(): Promise<void> {
    const hasActive = await taskService.hasActiveTasks()
    if (hasActive) {
      this.startLoop()
    } else {
      logger.debug('No active tasks found, scheduler not started')
    }
  }

  /**
   * Ensure a heartbeat task exists for the given agent.
   * Creates one if missing, or updates the interval if it changed.
   */
  async ensureHeartbeatTask(agentId: string, intervalMinutes: number = 30): Promise<void> {
    const { tasks } = await taskService.listTasks(agentId, { includeHeartbeat: true })
    const existing = tasks.find((t) => t.name === 'heartbeat')

    if (existing) {
      const currentInterval = existing.schedule_value
      const newInterval = String(intervalMinutes)
      if (currentInterval !== newInterval) {
        await taskService.updateTask(agentId, existing.id, { schedule_value: newInterval })
        logger.info('Updated heartbeat task interval', { agentId, interval: intervalMinutes })
      }
    } else {
      await taskService.createTask(agentId, {
        name: 'heartbeat',
        prompt: '__heartbeat__',
        schedule_type: 'interval',
        schedule_value: String(intervalMinutes)
      })
      logger.info('Created heartbeat task', { agentId, interval: intervalMinutes })
      this.startLoop()
    }
  }

  /** Manually trigger a task run (from UI). Returns immediately; task runs in background. */
  async runTaskNow(agentId: string, taskId: string): Promise<void> {
    const task = await taskService.getTask(agentId, taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)
    if (this.activeTasks.has(task.id)) throw new Error('Task is already running')

    // Fire and forget
    this.runTask(task).catch((error) => {
      logger.error('Unhandled error in manual runTask', {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error)
      })
    })
  }

  private poll(): void {
    if (!this.running) return

    this.tick()
      .catch((error) => {
        logger.error('Error in scheduler tick', {
          error: error instanceof Error ? error.message : String(error)
        })
      })
      .finally(() => {
        if (this.running) {
          this.pollTimer = setTimeout(() => this.poll(), POLL_INTERVAL_MS)
        }
      })
  }

  private async tick(): Promise<void> {
    const dueTasks = await taskService.getDueTasks()
    if (dueTasks.length > 0) {
      logger.info('Found due tasks', { count: dueTasks.length })
    }

    for (const task of dueTasks) {
      // Skip if already running
      if (this.activeTasks.has(task.id)) {
        logger.debug('Task already running, skipping', { taskId: task.id })
        continue
      }

      // Fire and forget — don't block the poll loop
      this.runTask(task).catch((error) => {
        logger.error('Unhandled error in runTask', {
          taskId: task.id,
          error: error instanceof Error ? error.message : String(error)
        })
      })
    }
  }

  private async runTask(task: ScheduledTaskEntity): Promise<void> {
    const startTime = Date.now()
    const abortController = new AbortController()
    const runningTask: RunningTask = {
      taskId: task.id,
      agentId: task.agent_id,
      abortController
    }
    this.activeTasks.set(task.id, runningTask)

    // Set up timeout if configured
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null
    if (task.timeout_minutes && task.timeout_minutes > 0) {
      const timeoutMs = task.timeout_minutes * 60_000
      timeoutTimer = setTimeout(() => {
        logger.warn('Task timed out, aborting', { taskId: task.id, timeoutMinutes: task.timeout_minutes })
        abortController.abort(new Error(`Task timed out after ${task.timeout_minutes} minutes`))
      }, timeoutMs)
    }

    let result: string | null = null
    let error: string | null = null
    let sessionId: string | undefined
    let subscribedChannels: { id: string; sessionId?: string | null }[] = []

    // Create log entry immediately so UI shows the running task
    const logId = await taskService.logTaskRun({
      task_id: task.id,
      session_id: null,
      run_at: new Date().toISOString(),
      duration_ms: 0,
      status: 'running',
      result: null,
      error: null
    })

    try {
      logger.info('Running scheduled task', { taskId: task.id, agentId: task.agent_id })
      const agent = await agentService.getAgent(task.agent_id)
      if (!agent) {
        throw new Error(`Agent not found: ${task.agent_id}`)
      }

      const config = (agent.configuration ?? {}) as CherryClawConfiguration
      const workspacePath = agent.accessible_paths?.[0]

      // For heartbeat tasks, read prompt from workspace heartbeat.md file
      let fullPrompt = task.prompt
      if (task.name === 'heartbeat') {
        if (config.heartbeat_enabled === false || !workspacePath) {
          logger.debug('Heartbeat task skipped (disabled or no workspace)', { taskId: task.id })
          // Still update next_run so it doesn't fire again immediately
          const nextRun = taskService.computeNextRun(task)
          await taskService.updateTaskAfterRun(task.id, nextRun, 'Skipped (disabled)')
          this.activeTasks.delete(task.id)
          return
        }
        const heartbeatContent = await readHeartbeat(workspacePath)
        if (!heartbeatContent) {
          logger.debug('Heartbeat task skipped (no heartbeat.md)', { taskId: task.id })
          const nextRun = taskService.computeNextRun(task)
          await taskService.updateTaskAfterRun(task.id, nextRun, 'Skipped (no file)')
          this.activeTasks.delete(task.id)
          return
        }
        fullPrompt = [
          '[Heartbeat]',
          'This is a periodic heartbeat. The instructions below are from your heartbeat.md file.',
          'Process each item, take action where possible, and use the notify tool to alert the user of important results.',
          '',
          '---',
          heartbeatContent
        ].join('\n')
      }

      // Resolve subscribed channels
      subscribedChannels = await channelService.getSubscribedChannels(task.id)

      // Try to reuse the session from the last successful run for context continuity
      const lastSessionId = await taskService.getLastRunSessionId(task.id)
      let session = lastSessionId ? await sessionService.getSession(task.agent_id, lastSessionId) : null

      if (session) {
        sessionId = session.id
        logger.debug('Reusing session from last run', { taskId: task.id, sessionId })
      } else {
        const newSession = await sessionService.createSession(task.agent_id, {})
        sessionId = newSession!.id
        session = await sessionService.getSession(task.agent_id, sessionId)
        if (!session) {
          throw new Error(`Session not found: ${sessionId}`)
        }
        logger.debug('Created new session for task', { taskId: task.id, sessionId })
      }

      // Send as user message (triggers agent response)
      const { stream, completion } = await sessionMessageService.createSessionMessage(
        session,
        { content: fullPrompt },
        abortController,
        { persist: true }
      )

      // Collect the response text and stream to subscribed channels only
      const targetAdapters = subscribedChannels
        .map((ch) => {
          const adapter = channelManager.getAdapter(ch.id)
          logger.info('Task stream channel check', {
            channelId: ch.id,
            hasAdapter: !!adapter,
            notifyChatIds: adapter?.notifyChatIds ?? []
          })
          return adapter
        })
        .filter((a) => a !== undefined)
      const responseText = await this.collectAndStreamResponse(stream, targetAdapters)
      await completion

      // Notify renderer so the session list refreshes and messages can be loaded
      broadcastSessionChanged(task.agent_id, sessionId, true)

      // Check if the task was aborted (e.g. by timeout)
      if (abortController.signal.aborted) {
        const reason = abortController.signal.reason
        throw reason instanceof Error ? reason : new Error(String(reason ?? 'Task aborted'))
      }

      result = responseText.slice(0, 200) || 'Completed'
      this.consecutiveErrors.delete(task.id)
      logger.info('Task completed', { taskId: task.id, durationMs: Date.now() - startTime })
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      logger.error('Task failed', { taskId: task.id, error })

      // Track consecutive errors across invocations
      const errCount = (this.consecutiveErrors.get(task.id) ?? 0) + 1
      this.consecutiveErrors.set(task.id, errCount)
      if (errCount >= MAX_CONSECUTIVE_ERRORS) {
        logger.warn('Pausing task after consecutive errors', {
          taskId: task.id,
          errors: errCount
        })
        await taskService.updateTask(task.agent_id, task.id, { status: 'paused' })
        this.consecutiveErrors.delete(task.id)
      }
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer)
      this.activeTasks.delete(task.id)
    }

    const durationMs = Date.now() - startTime

    // Update the log entry with final results
    await taskService.updateTaskRunLog(logId, {
      session_id: sessionId ?? null,
      duration_ms: durationMs,
      status: error ? 'error' : 'success',
      result,
      error
    })

    // Compute next run and update task
    const nextRun = taskService.computeNextRun(task)
    const resultSummary = error ? `Error: ${error}` : result ? result.slice(0, 200) : 'Completed'
    await taskService.updateTaskAfterRun(task.id, nextRun, resultSummary)

    // Send error notification or final response to channels
    if (error) {
      await this.notifyTaskError(task, durationMs, error, subscribedChannels)
    }
  }

  /**
   * Collect the stream response text and simultaneously stream to channel adapters.
   * Mirrors the logic in ChannelMessageHandler.collectStreamResponse.
   */
  private async collectAndStreamResponse(stream: ReadableStream, adapters: ChannelAdapter[]): Promise<string> {
    const reader = stream.getReader()
    let completedText = ''
    let currentBlockText = ''

    // Pick the first notifyChatId from each adapter for streaming
    const adapterChats = adapters.flatMap((a) => a.notifyChatIds.map((chatId) => ({ adapter: a, chatId })))

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        // Skip user message echoes
        const rawType = value.providerMetadata?.raw?.type
        if (rawType === 'user') continue

        switch (value.type) {
          case 'text-delta':
            if (value.text) {
              currentBlockText = value.text
              const fullText = completedText + currentBlockText
              // Stream to all channel adapters
              for (const { adapter, chatId } of adapterChats) {
                adapter.onTextUpdate(chatId, fullText).catch(() => {})
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

      // Finalize streaming on all adapters, fall back to sendMessage if not handled
      for (const { adapter, chatId } of adapterChats) {
        try {
          const handled = await adapter.onStreamComplete(chatId, finalText)
          if (!handled && finalText) {
            await adapter.sendMessage(chatId, finalText)
          }
        } catch (err) {
          logger.warn('Failed to send task response to channel', {
            channelId: adapter.channelId,
            chatId,
            error: err instanceof Error ? err.message : String(err)
          })
        }
      }

      return finalText
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      for (const { adapter, chatId } of adapterChats) {
        adapter.onStreamError(chatId, errorMsg).catch(() => {})
      }
      throw error
    }
  }

  private async notifyTaskError(
    task: ScheduledTaskEntity,
    durationMs: number,
    error: string,
    subscribedChannels: { id: string; sessionId?: string | null }[]
  ): Promise<void> {
    try {
      if (subscribedChannels.length === 0) return

      const durationSec = Math.round(durationMs / 1000)
      const text = `[Task failed] ${task.name}\nDuration: ${durationSec}s\nError: ${error}`

      for (const ch of subscribedChannels) {
        const adapter = channelManager.getAdapter(ch.id)
        logger.info('Task notification channel check', {
          channelId: ch.id,
          hasAdapter: !!adapter,
          notifyChatIds: adapter?.notifyChatIds ?? []
        })
        if (!adapter) continue
        for (const chatId of adapter.notifyChatIds) {
          adapter.sendMessage(chatId, text).catch((err) => {
            logger.warn('Failed to send task error notification', {
              taskId: task.id,
              channelId: ch.id,
              chatId,
              error: err instanceof Error ? err.message : String(err)
            })
          })
        }
      }
    } catch (err) {
      logger.warn('Error sending task error notification', {
        taskId: task.id,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }
}

export const schedulerService = SchedulerService.getInstance()
