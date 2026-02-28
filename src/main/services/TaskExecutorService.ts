/**
 * Task Executor Service
 * Executes periodic tasks by calling AI assistants/agents
 */

import { loggerService } from '@logger'
import type { PeriodicTask, TaskExecution, TaskTarget } from '@types'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('TaskExecutorService')

export interface TaskExecutionResult {
  success: boolean
  output?: string
  error?: string
  duration: number
  metadata?: Record<string, unknown>
}

export interface TaskExecutionPlan {
  steps: Array<{
    target: TaskTarget
    order: number
    reason: string
  }>
  parallelGroups: Array<{
    targets: TaskTarget[]
    description: string
  }>
}

class TaskExecutorService {
  private static instance: TaskExecutorService | null = null
  private runningExecutions: Map<string, AbortController>

  private constructor() {
    this.runningExecutions = new Map()
    logger.info('TaskExecutorService initialized')
  }

  public static getInstance(): TaskExecutorService {
    if (!TaskExecutorService.instance) {
      TaskExecutorService.instance = new TaskExecutorService()
    }
    return TaskExecutorService.instance
  }

  /**
   * Execute a task
   */
  async executeTask(task: PeriodicTask): Promise<TaskExecution> {
    const executionId = `exec-${uuidv4()}`
    const startTime = Date.now()

    const execution: TaskExecution = {
      id: executionId,
      taskId: task.id,
      status: 'running',
      startedAt: new Date().toISOString()
    }

    logger.info(`Starting task execution: ${executionId} for task: ${task.id}`)

    // Create abort controller for this execution
    const abortController = new AbortController()
    this.runningExecutions.set(executionId, abortController)

    // Check if task has max execution time
    const maxTime = task.execution.maxExecutionTime || 300 // Default 5 minutes

    // Create timeout
    let timeoutId: NodeJS.Timeout | undefined
    try {
      timeoutId = setTimeout(() => {
        abortController.abort()
      }, maxTime * 1000)

      // Execute based on number of targets
      let result: TaskExecutionResult

      if (task.targets.length === 0) {
        throw new Error('Task has no targets to execute')
      } else if (task.targets.length === 1) {
        // Single target - execute directly
        result = await this.executeWithSingleTarget(task)
      } else {
        // Multiple targets - plan and execute
        result = await this.executeWithMultipleTargets(task, abortController.signal)
      }

      clearTimeout(timeoutId)

      const duration = Date.now() - startTime

      execution.completedAt = new Date().toISOString()
      execution.status = result.success ? 'completed' : 'failed'
      execution.result = result

      logger.info(`Task execution completed: ${executionId} in ${duration}ms`)
    } catch (error) {
      clearTimeout(timeoutId)

      const duration = Date.now() - startTime
      execution.completedAt = new Date().toISOString()
      execution.status = 'failed'
      execution.result = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration
      }

      logger.error(`Task execution failed: ${executionId}`, error as Error)
    } finally {
      this.runningExecutions.delete(executionId)
    }

    return execution
  }

  /**
   * Execute task with a single target
   */
  private async executeWithSingleTarget(task: PeriodicTask): Promise<TaskExecutionResult> {
    const target = task.targets[0]
    const startTime = Date.now()

    logger.info(`Executing task ${task.id} with single target: ${target.type}/${target.id}`)

    try {
      const output = await this.executeTarget(task, target)

      return {
        success: true,
        output,
        duration: Date.now() - startTime,
        metadata: {
          target: {
            type: target.type,
            id: target.id,
            name: target.name
          }
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime
      }
    }
  }

  /**
   * Execute task with multiple targets (plan and execute)
   */
  private async executeWithMultipleTargets(task: PeriodicTask, signal: AbortSignal): Promise<TaskExecutionResult> {
    const startTime = Date.now()

    logger.info(`Executing task ${task.id} with ${task.targets.length} targets`)

    try {
      // Step 1: Plan execution order using LLM
      const plan = await this.planExecution(task)

      logger.info(`Execution plan generated for task ${task.id}:`, plan)

      // Step 2: Execute targets according to plan
      const results: Array<{
        target: TaskTarget
        result: string
        success: boolean
        error?: string
      }> = []

      // Execute parallel groups first
      for (const group of plan.parallelGroups) {
        if (signal.aborted) throw new Error('Execution aborted')

        const groupResults = await Promise.all(
          group.targets.map(async (target) => {
            try {
              const output = await this.executeTarget(task, target)
              return {
                target,
                result: output,
                success: true
              }
            } catch (error) {
              return {
                target,
                result: '',
                success: false,
                error: error instanceof Error ? error.message : String(error)
              }
            }
          })
        )

        results.push(...groupResults)
      }

      // Execute sequential steps
      for (const step of plan.steps) {
        if (signal.aborted) throw new Error('Execution aborted')

        try {
          const output = await this.executeTarget(task, step.target)
          results.push({
            target: step.target,
            result: output,
            success: true
          })
        } catch (error) {
          results.push({
            target: step.target,
            result: '',
            success: false,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }

      // Step 3: Aggregate results
      const aggregatedOutput = await this.aggregateResults(task, results)

      const allSuccess = results.every((r) => r.success)

      return {
        success: allSuccess,
        output: aggregatedOutput,
        duration: Date.now() - startTime,
        metadata: {
          plan,
          results: results.map((r) => ({
            target: { type: r.target.type, id: r.target.id, name: r.target.name },
            success: r.success,
            output: r.result,
            error: r.error
          }))
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime
      }
    }
  }

  /**
   * Plan execution order for multiple targets using LLM
   */
  private async planExecution(task: PeriodicTask): Promise<TaskExecutionPlan> {
    // For now, use a simple strategy:
    // - Group assistants (can run in parallel)
    // - Run agents sequentially (they may have dependencies)

    const assistants = task.targets.filter((t) => t.type === 'assistant')
    const agents = task.targets.filter((t) => t.type === 'agent')
    const agentSessions = task.targets.filter((t) => t.type === 'agent_session')

    const plan: TaskExecutionPlan = {
      parallelGroups: [],
      steps: []
    }

    // Group assistants to run in parallel
    if (assistants.length > 0) {
      plan.parallelGroups.push({
        targets: assistants,
        description: 'Execute all assistants in parallel'
      })
    }

    // Add agent sessions as sequential steps
    agentSessions.forEach((session) => {
      plan.steps.push({
        target: session,
        order: (plan.steps.length || 0) + 1,
        reason: 'Agent sessions are executed sequentially for consistency'
      })
    })

    // Add agents as sequential steps
    agents.forEach((agent) => {
      plan.steps.push({
        target: agent,
        order: (plan.steps.length || 0) + 1,
        reason: 'Agents are executed sequentially to avoid conflicts'
      })
    })

    return plan
  }

  /**
   * Execute a single target by delegating to renderer process
   * The renderer process handles actual AI assistant/agent calls
   * Note: For manual execution, use the renderer-side executeTaskDirect instead
   * This method is used by the task scheduler for background execution
   */
  private async executeTarget(task: PeriodicTask, target: TaskTarget): Promise<string> {
    logger.info(`Executing target: ${target.type}/${target.id}`)

    // Delegate to renderer process for actual AI execution
    // The renderer has access to message sending infrastructure
    const { BrowserWindow } = await import('electron')
    const windows = BrowserWindow.getAllWindows()

    // Find the main window (not splash, hidden, etc.)
    const mainWindow = windows.find((w) => w.isVisible() && !w.isDestroyed())

    if (!mainWindow) {
      throw new Error('No visible window found to execute task')
    }

    // Send execution request to renderer
    // The renderer will execute and send back results via task-execution-completed/failed events
    mainWindow.webContents.send('task-execute-target', {
      taskId: task.id,
      taskName: task.name,
      target,
      message: task.execution.message,
      continueConversation: task.execution.continueConversation,
      maxExecutionTime: task.execution.maxExecutionTime
    })

    // Wait for the result from renderer
    const maxExecutionTime = task.execution.maxExecutionTime || 300
    const result = await new Promise<{ success: boolean; output?: string; error?: string }>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        cleanup()
        reject(new Error('Task execution timeout'))
      }, maxExecutionTime * 1000)

      const completedHandler = (_event: Electron.IpcRendererEvent, data: any) => {
        if (data.taskId === task.id) {
          cleanup()
          resolve({
            success: true,
            output: data.execution.result?.output
          })
        }
      }

      const failedHandler = (_event: Electron.IpcRendererEvent, data: any) => {
        if (data.taskId === task.id) {
          cleanup()
          resolve({
            success: false,
            error: data.execution.result?.error || data.error
          })
        }
      }

      const cleanup = () => {
        clearTimeout(timeoutId)
        // @ts-ignore - custom event
        mainWindow.removeListener('task-execution-completed', completedHandler)
        // @ts-ignore - custom event
        mainWindow.removeListener('task-execution-failed', failedHandler)
      }

      // @ts-ignore - custom event
      mainWindow.on('task-execution-completed', completedHandler)
      // @ts-ignore - custom event
      mainWindow.on('task-execution-failed', failedHandler)
    })

    if (!result.success) {
      throw new Error(result.error || 'Task execution failed')
    }

    return result.output || 'Task completed successfully'
  }

  /**
   * Aggregate results from multiple targets
   */
  private async aggregateResults(
    task: PeriodicTask,
    results: Array<{
      target: TaskTarget
      result: string
      success: boolean
      error?: string
    }>
  ): Promise<string> {
    // Build a summary of all results
    const lines: string[] = []
    lines.push(`# Task Execution Summary: ${task.name}`)
    lines.push('')
    lines.push(`**Total targets:** ${results.length}`)
    lines.push(`**Successful:** ${results.filter((r) => r.success).length}`)
    lines.push(`**Failed:** ${results.filter((r) => !r.success).length}`)
    lines.push('')

    for (const { target, result, success, error } of results) {
      lines.push(`## ${target.name} (${target.type})`)
      lines.push(`**Status:** ${success ? '✅ Success' : '❌ Failed'}`)
      if (result) {
        lines.push(`**Output:**`)
        lines.push(result)
      }
      if (error) {
        lines.push(`**Error:** ${error}`)
      }
      lines.push('')
    }

    return lines.join('\n')
  }

  /**
   * Abort a running execution
   */
  abortExecution(executionId: string): boolean {
    const controller = this.runningExecutions.get(executionId)
    if (controller) {
      controller.abort()
      this.runningExecutions.delete(executionId)
      logger.info(`Execution aborted: ${executionId}`)
      return true
    }
    return false
  }

  /**
   * Get list of running executions
   */
  getRunningExecutions(): string[] {
    return Array.from(this.runningExecutions.keys())
  }
}

export default TaskExecutorService.getInstance()
