import { randomUUID } from 'node:crypto'

import { agentChannelService as channelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { agentTaskService as taskService } from '@data/services/AgentTaskService'
import { sessionService } from '@data/services/SessionService'
import { loggerService } from '@logger'
import { buildAgentSessionTopicId, parseAgentSessionModel } from '@main/ai/provider/claudeCodeSettingsBuilder'
import { ChannelAdapterListener, type StreamListener } from '@main/ai/stream-manager'
import type { AiStreamManager } from '@main/ai/stream-manager/AiStreamManager'
import { application } from '@main/core/application'
import type { ScheduledTaskEntity } from '@shared/data/types/agent'

import { channelManager } from './channels/ChannelManager'
import { readHeartbeat } from './cherryclaw/heartbeat'

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

  /** Ensure the poll loop is running iff active tasks exist. */
  async syncScheduler(): Promise<void> {
    const hasActive = await taskService.hasActiveTasks()
    if (hasActive) {
      this.startLoop()
    } else if (this.running) {
      this.stopLoop()
    } else {
      logger.debug('No active tasks, scheduler not running')
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
      const currentInterval = existing.scheduleValue
      const newInterval = String(intervalMinutes)
      if (currentInterval !== newInterval) {
        await taskService.updateTask(agentId, existing.id, { scheduleValue: newInterval })
        logger.info('Updated heartbeat task interval', { agentId, interval: intervalMinutes })
      }
    } else {
      await taskService.createTask(agentId, {
        name: 'heartbeat',
        prompt: '__heartbeat__',
        scheduleType: 'interval',
        scheduleValue: String(intervalMinutes)
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
      agentId: task.agentId,
      abortController
    }
    this.activeTasks.set(task.id, runningTask)

    // Set up timeout if configured
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null
    if (task.timeoutMinutes && task.timeoutMinutes > 0) {
      const timeoutMs = task.timeoutMinutes * 60_000
      timeoutTimer = setTimeout(() => {
        logger.warn('Task timed out, aborting', { taskId: task.id, timeoutMinutes: task.timeoutMinutes })
        abortController.abort(new Error(`Task timed out after ${task.timeoutMinutes} minutes`))
      }, timeoutMs)
    }

    let result: string | null = null
    let error: string | null = null
    let sessionId: string | undefined
    let subscribedChannels: { id: string; sessionId?: string | null }[] = []

    // Create log entry immediately so UI shows the running task
    const logId = await taskService.logTaskRun({
      taskId: task.id,
      sessionId: null,
      runAt: Date.now(),
      durationMs: 0,
      status: 'running',
      result: null,
      error: null
    })

    try {
      logger.info('Running scheduled task', { taskId: task.id, agentId: task.agentId })
      const agent = await agentService.getAgent(task.agentId)
      if (!agent) {
        throw new Error(`Agent not found: ${task.agentId}`)
      }

      const config = agent.configuration ?? {}

      // Resolve subscribed channels
      subscribedChannels = await channelService.getSubscribedChannels(task.id)

      // Resolve session BEFORE reading workspace — workspace now lives on the
      // session (CMA Environment binding). createSession inherits accessiblePaths
      // from the latest sibling session of the same agent when omitted.
      const lastSessionId = await taskService.getLastRunSessionId(task.id)
      let session = lastSessionId ? await sessionService.getById(lastSessionId).catch(() => null) : null

      if (session) {
        sessionId = session.id
        logger.debug('Reusing session from last run', { taskId: task.id, sessionId })
      } else {
        session = await sessionService.createSession({ agentId: task.agentId, name: task.name || 'Scheduled run' })
        sessionId = session.id
        logger.debug('Created new session for task', { taskId: task.id, sessionId })
      }

      const workspacePath = session.accessiblePaths?.[0]

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

      if (!agent.model) {
        throw new Error(`Agent ${task.agentId} has no model configured`)
      }

      // Build listeners: ChannelAdapterListener per subscribed channel + completion sentinel
      const listeners: StreamListener[] = subscribedChannels
        .map((ch) => {
          const adapter = channelManager.getAdapter(ch.id)
          if (!adapter) return undefined
          return adapter.notifyChatIds.map((chatId) => new ChannelAdapterListener(adapter, chatId))
        })
        .flat()
        .filter((l) => l !== undefined)

      // Completion tracking via sentinel listener
      let resolveExecution!: (text: string) => void
      let rejectExecution!: (err: unknown) => void
      const executionDone = new Promise<string>((resolve, reject) => {
        resolveExecution = resolve
        rejectExecution = reject
      })
      let accumulatedText = ''
      const sentinel: StreamListener = {
        id: `scheduler:${task.id}`,
        onChunk(chunk) {
          const c = chunk as { type: string; text?: string }
          if (c.type === 'text-delta' && c.text) accumulatedText += c.text
        },
        onDone() {
          resolveExecution(accumulatedText.trim())
        },
        onPaused() {
          // If we're paused because the task was aborted (e.g. timeout fired),
          // surface that as a rejection — otherwise the post-await abort
          // check below would race against `await executionDone` resolving
          // with the partial text and we'd record a successful run.
          if (abortController.signal.aborted) {
            const reason = abortController.signal.reason
            rejectExecution(reason instanceof Error ? reason : new Error(String(reason ?? 'Task aborted')))
            return
          }
          resolveExecution(accumulatedText.trim())
        },
        onError(result) {
          rejectExecution(new Error(result.error.message ?? 'Execution failed'))
        },
        isAlive: () => !abortController.signal.aborted
      }
      listeners.push(sentinel)

      // Start execution via AiStreamManager
      const topicId = buildAgentSessionTopicId(session.id)
      const uniqueModelId = parseAgentSessionModel(agent.model)

      const aiStreamManager = application.get('AiStreamManager') as unknown as AiStreamManager
      aiStreamManager.send({
        topicId,
        models: [
          {
            modelId: uniqueModelId,
            request: {
              chatId: topicId,
              trigger: 'submit-message',
              assistantId: task.agentId,
              uniqueModelId,
              messages: [{ id: randomUUID(), role: 'user', parts: [{ type: 'text', text: fullPrompt }] }]
            }
          }
        ],
        listeners
      })

      const responseText = await executionDone

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
        await taskService.updateTask(task.agentId, task.id, { status: 'paused' })
        this.consecutiveErrors.delete(task.id)
      }
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer)
      this.activeTasks.delete(task.id)
    }

    const durationMs = Date.now() - startTime

    // Update the log entry with final results
    await taskService.updateTaskRunLog(logId, {
      sessionId: sessionId ?? null,
      durationMs,
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
