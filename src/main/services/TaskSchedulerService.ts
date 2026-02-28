/**
 * Task Scheduler Service
 * Manages scheduling and execution of periodic tasks using node-cron
 */

import { loggerService } from '@logger'
import type { PeriodicTask, TaskExecution } from '@types'
import type { BrowserWindow } from 'electron'
import { powerMonitor } from 'electron'
import cron from 'node-cron'
import { v4 as uuidv4 } from 'uuid'

import taskExecutorService from './TaskExecutorService'
import taskStorageService from './TaskStorageService'

const logger = loggerService.withContext('TaskSchedulerService')

interface ScheduledTask {
  task: PeriodicTask
  cronJob?: { stop: () => void }
  intervalId?: NodeJS.Timeout
  timeoutId?: NodeJS.Timeout
  isRunning: boolean
}

class TaskSchedulerService {
  private static instance: TaskSchedulerService | null = null
  private scheduledTasks: Map<string, ScheduledTask>
  private isStarted: boolean = false
  private mainWindow: BrowserWindow | null = null

  private constructor() {
    this.scheduledTasks = new Map()
    this.setupPowerMonitor()
    logger.info('TaskSchedulerService initialized')
  }

  public static getInstance(): TaskSchedulerService {
    if (!TaskSchedulerService.instance) {
      TaskSchedulerService.instance = new TaskSchedulerService()
    }
    return TaskSchedulerService.instance
  }

  public setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window
  }

  /**
   * Start the scheduler service
   */
  start(): void {
    if (this.isStarted) {
      logger.warn('TaskSchedulerService already started')
      return
    }

    this.isStarted = true
    this.loadAndScheduleAllTasks()
    logger.info('TaskSchedulerService started')
  }

  /**
   * Stop the scheduler service
   */
  stop(): void {
    if (!this.isStarted) {
      return
    }

    // Clear all scheduled tasks
    for (const [taskId, scheduled] of this.scheduledTasks) {
      this.unscheduleTask(taskId, scheduled)
    }

    this.scheduledTasks.clear()
    this.isStarted = false
    logger.info('TaskSchedulerService stopped')
  }

  /**
   * Add or update a task schedule
   */
  async upsertTask(task: PeriodicTask): Promise<void> {
    // Remove existing schedule if any
    if (this.scheduledTasks.has(task.id)) {
      this.removeTask(task.id)
    }

    // Only schedule if task is enabled
    if (!task.enabled) {
      logger.info(`Task ${task.id} is disabled, not scheduling`)
      return
    }

    const scheduledTask: ScheduledTask = {
      task,
      isRunning: false
    }

    switch (task.schedule.type) {
      case 'cron':
        this.scheduleCronTask(task, scheduledTask)
        break
      case 'interval':
        this.scheduleIntervalTask(task, scheduledTask)
        break
      case 'once':
        this.scheduleOnceTask(task, scheduledTask)
        break
      case 'manual':
        // Manual tasks are not scheduled automatically
        logger.info(`Task ${task.id} is manual, will not be scheduled`)
        break
    }

    this.scheduledTasks.set(task.id, scheduledTask)
    logger.info(`Task scheduled: ${task.id} (${task.schedule.type})`)
  }

  /**
   * Remove a task from scheduling
   */
  removeTask(taskId: string): void {
    const scheduled = this.scheduledTasks.get(taskId)
    if (scheduled) {
      this.unscheduleTask(taskId, scheduled)
      this.scheduledTasks.delete(taskId)
      logger.info(`Task unscheduled: ${taskId}`)
    }
  }

  /**
   * Execute a task immediately (for manual execution)
   */
  async executeTaskNow(taskId: string): Promise<TaskExecution> {
    // Get task from storage
    const task = await taskStorageService.getTask(taskId)
    if (!task) {
      throw new Error(`Task not found: ${taskId}`)
    }

    logger.info(`Executing task now: ${taskId}`)

    // Create execution record
    const execution: TaskExecution = {
      id: `exec-${uuidv4()}`,
      taskId,
      status: 'running',
      startedAt: new Date().toISOString()
    }

    // Save execution record
    await taskStorageService.addExecution(execution)

    // Send execution started event
    this.sendExecutionEvent('Task_ExecutionStarted', { taskId, executionId: execution.id })

    // Execute the task
    const result = await taskExecutorService.executeTask(task)

    // Update execution record with result
    await taskStorageService.updateExecution(execution.id, {
      status: result.status || (execution.result?.success ? 'completed' : 'failed'),
      completedAt: result.completedAt,
      result: result.result
    })

    // Send completion event
    if (result.status === 'completed') {
      this.sendExecutionEvent('Task_ExecutionCompleted', { taskId, execution: result })
    } else {
      this.sendExecutionEvent('Task_ExecutionFailed', { taskId, execution: result })
    }

    return result
  }

  /**
   * Pause a task
   */
  pauseTask(taskId: string): void {
    const scheduled = this.scheduledTasks.get(taskId)
    if (scheduled) {
      this.unscheduleTask(taskId, scheduled)
      scheduled.isRunning = false
      logger.info(`Task paused: ${taskId}`)
    }
  }

  /**
   * Resume a task
   */
  async resumeTask(taskId: string): Promise<void> {
    const scheduled = this.scheduledTasks.get(taskId)
    if (scheduled) {
      const task = await taskStorageService.getTask(taskId)
      if (task && task.enabled) {
        await this.upsertTask(task)
        logger.info(`Task resumed: ${taskId}`)
      }
    }
  }

  /**
   * Get all active (scheduled) tasks
   */
  getActiveTasks(): PeriodicTask[] {
    return Array.from(this.scheduledTasks.values())
      .filter((s) => !s.isRunning)
      .map((s) => s.task)
  }

  /**
   * Schedule a cron-based task
   */
  private scheduleCronTask(task: PeriodicTask, scheduled: ScheduledTask): void {
    if (!task.schedule.cronExpression) {
      logger.error(`Task ${task.id} has cron type but no cron expression`)
      return
    }

    try {
      const cronJob = cron.schedule(task.schedule.cronExpression, async () => {
        await this.executeTaskNow(task.id)
      })

      scheduled.cronJob = cronJob
      logger.info(`Cron job scheduled for task ${task.id}: ${task.schedule.cronExpression}`)
    } catch (error) {
      logger.error(`Failed to schedule cron task ${task.id}:`, error as Error)
    }
  }

  /**
   * Schedule an interval-based task
   */
  private scheduleIntervalTask(task: PeriodicTask, scheduled: ScheduledTask): void {
    const interval = task.schedule.interval || 60000 // Default 1 minute

    const intervalId = setInterval(async () => {
      await this.executeTaskNow(task.id)
    }, interval)

    scheduled.intervalId = intervalId
    logger.info(`Interval task scheduled for ${task.id}: ${interval}ms`)
  }

  /**
   * Schedule a one-time task
   */
  private scheduleOnceTask(task: PeriodicTask, scheduled: ScheduledTask): void {
    // For 'once' tasks, we schedule them to run after a short delay
    // This allows the task to be triggered after creation
    const timeoutId = setTimeout(async () => {
      await this.executeTaskNow(task.id)
      // Remove from scheduled tasks after execution
      this.removeTask(task.id)
    }, 1000) // 1 second delay

    scheduled.timeoutId = timeoutId
    logger.info(`Once task scheduled for ${task.id}`)
  }

  /**
   * Unschedule a task (clear timers/jobs)
   */
  private unscheduleTask(_taskId: string, scheduled: ScheduledTask): void {
    if (scheduled.cronJob) {
      scheduled.cronJob.stop()
      scheduled.cronJob = undefined
    }
    if (scheduled.intervalId) {
      clearInterval(scheduled.intervalId)
      scheduled.intervalId = undefined
    }
    if (scheduled.timeoutId) {
      clearTimeout(scheduled.timeoutId)
      scheduled.timeoutId = undefined
    }
  }

  /**
   * Load and schedule all tasks from storage
   */
  private async loadAndScheduleAllTasks(): Promise<void> {
    try {
      const tasks = await taskStorageService.listTasks()
      const enabledTasks = tasks.filter((t) => t.enabled)

      logger.info(`Loading ${enabledTasks.length} enabled tasks for scheduling`)

      for (const task of enabledTasks) {
        await this.upsertTask(task)
      }

      logger.info(`Successfully loaded ${this.scheduledTasks.size} tasks`)
    } catch (error) {
      logger.error('Failed to load tasks from storage:', error as Error)
    }
  }

  /**
   * Setup power monitor for system suspend/resume
   */
  private setupPowerMonitor(): void {
    // Pause all tasks when system suspends
    powerMonitor.on('suspend', () => {
      logger.info('System suspending, pausing all tasks')
      for (const [, scheduled] of this.scheduledTasks) {
        this.unscheduleTask(scheduled.task.id, scheduled)
        scheduled.isRunning = false
      }
    })

    // Resume tasks when system wakes up
    powerMonitor.on('resume', async () => {
      logger.info('System resumed, resuming all tasks')
      const tasks = await taskStorageService.listTasks()
      for (const task of tasks) {
        if (task.enabled) {
          await this.upsertTask(task)
        }
      }
    })

    logger.info('Power monitor setup complete')
  }

  /**
   * Send execution event to renderer process
   */
  private sendExecutionEvent(channel: string, data: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data)
    }
  }
}

export default TaskSchedulerService.getInstance()
