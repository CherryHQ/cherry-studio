import { loggerService } from '@logger'
import type { CherryClawConfiguration, ScheduledTaskEntity } from '@types'

import { agentService } from './AgentService'
import { CherryClawService } from './cherryclaw'
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
  consecutiveErrors: number
}

class SchedulerService {
  private static instance: SchedulerService | null = null
  private pollTimer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private readonly activeTasks = new Map<string, RunningTask>()
  private cherryClawService: CherryClawService | null = null

  static getInstance(): SchedulerService {
    if (!SchedulerService.instance) {
      SchedulerService.instance = new SchedulerService()
    }
    return SchedulerService.instance
  }

  private getCherryClawService(): CherryClawService {
    if (!this.cherryClawService) {
      this.cherryClawService = new CherryClawService()
    }
    return this.cherryClawService
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

  // Keep backward-compatible aliases used by agent handlers and main/index.ts
  stopScheduler(_agentId: string): void {
    // No-op — the poll loop handles everything via DB state.
    // Individual task abort is handled by stopLoop or task deletion.
  }

  startScheduler(_agent: any): void {
    // No-op — the poll loop picks up tasks from DB automatically.
    // Just ensure the loop is running.
    this.startLoop()
  }

  stopAll(): void {
    this.stopLoop()
  }

  async restoreSchedulers(): Promise<void> {
    this.startLoop()
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
      abortController,
      consecutiveErrors: 0
    }
    this.activeTasks.set(task.id, runningTask)

    let result: string | null = null
    let error: string | null = null

    try {
      logger.info('Running scheduled task', { taskId: task.id, agentId: task.agent_id })

      const agent = await agentService.getAgent(task.agent_id)
      if (!agent) {
        throw new Error(`Agent not found: ${task.agent_id}`)
      }

      const config = (agent.configuration ?? {}) as CherryClawConfiguration
      const workspacePath = agent.accessible_paths?.[0]

      // Build the prompt — optionally prepend heartbeat content
      let fullPrompt = task.prompt
      if (config.heartbeat_enabled !== false && workspacePath) {
        const clawService = this.getCherryClawService()
        const heartbeatContent = await clawService.heartbeatReader.readHeartbeat(workspacePath, config.heartbeat_file)
        if (heartbeatContent) {
          fullPrompt = `[Heartbeat]\n${heartbeatContent}\n\n[Task]\n${task.prompt}`
        }
      }

      // Find or create session based on context mode
      let sessionId: string
      if (task.context_mode === 'session') {
        const { sessions } = await sessionService.listSessions(task.agent_id, { limit: 1 })
        if (sessions.length === 0) {
          const newSession = await sessionService.createSession(task.agent_id, {})
          sessionId = newSession!.id
        } else {
          sessionId = sessions[0].id
        }
      } else {
        const newSession = await sessionService.createSession(task.agent_id, {})
        sessionId = newSession!.id
      }

      const session = await sessionService.getSession(task.agent_id, sessionId)
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`)
      }

      // Send as user message (triggers agent response)
      const { stream, completion } = await sessionMessageService.createSessionMessage(
        session,
        { content: fullPrompt },
        abortController,
        { persist: true }
      )

      // Drain the stream so completion resolves
      const reader = stream.getReader()
      while (!(await reader.read()).done) {
        // discard chunks
      }
      await completion

      result = 'Completed'
      logger.info('Task completed', { taskId: task.id, durationMs: Date.now() - startTime })
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      logger.error('Task failed', { taskId: task.id, error })

      // Track consecutive errors
      runningTask.consecutiveErrors++
      if (runningTask.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        logger.warn('Pausing task after consecutive errors', {
          taskId: task.id,
          errors: runningTask.consecutiveErrors
        })
        await taskService.updateTask(task.agent_id, task.id, { status: 'paused' })
      }
    } finally {
      this.activeTasks.delete(task.id)
    }

    const durationMs = Date.now() - startTime

    // Log the run
    await taskService.logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: durationMs,
      status: error ? 'error' : 'success',
      result,
      error
    })

    // Compute next run and update task
    const nextRun = taskService.computeNextRun(task)
    const resultSummary = error ? `Error: ${error}` : result ? result.slice(0, 200) : 'Completed'
    await taskService.updateTaskAfterRun(task.id, nextRun, resultSummary)
  }
}

export const schedulerService = SchedulerService.getInstance()
