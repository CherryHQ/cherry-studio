/**
 * Task Executor Service
 * Executes periodic tasks by calling AI assistants/agents
 */

import { loggerService } from '@logger'
import type {
  PeriodicTask,
  PlanExecutionAnalysis,
  TargetExecutionResult,
  TaskExecution,
  TaskExecutionPlan,
  TaskTarget
} from '@types'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('TaskExecutorService')

export interface TaskExecutionResult {
  success: boolean
  output?: string
  error?: string
  duration: number
  metadata?: Record<string, unknown>
}

export interface RetryConfig {
  maxAttempts: number
  initialDelay: number
  maxDelay: number
  backoffMultiplier: number
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2
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
   * @param task - The task to execute
   * @param preGeneratedPlan - Optional pre-generated execution plan (skips AI planning if provided)
   */
  async executeTask(task: PeriodicTask, preGeneratedPlan?: TaskExecutionPlan): Promise<TaskExecution> {
    const executionId = `exec-${uuidv4()}`
    const startTime = Date.now()

    const execution: TaskExecution = {
      id: executionId,
      taskId: task.id,
      status: 'running',
      startedAt: new Date().toISOString()
    }

    logger.info(`[executeTask] Starting task execution: ${executionId} for task: ${task.id}`)
    logger.info(`[executeTask] Task: ${task.name}, targets: ${task.targets.length}`)
    logger.info(`[executeTask] enableSmartPlanning: ${task.execution.enableSmartPlanning}`)

    // Create abort controller for this execution
    const abortController = new AbortController()
    this.runningExecutions.set(executionId, abortController)

    // Check if task has max execution time
    const maxTime = task.execution.maxExecutionTime || 300 // Default 5 minutes
    logger.info(`[executeTask] Max execution time: ${maxTime}s`)

    // Create timeout
    let timeoutId: NodeJS.Timeout | undefined
    try {
      timeoutId = setTimeout(() => {
        logger.warn(`[executeTask] Execution timeout for ${executionId}, aborting...`)
        abortController.abort()
      }, maxTime * 1000)

      // Execute based on number of targets
      let result: TaskExecutionResult

      logger.info(`[executeTask] Determining execution path...`)

      if (task.targets.length === 0) {
        throw new Error('Task has no targets to execute')
      } else if (task.targets.length === 1) {
        // Single target - execute directly
        logger.info(`[executeTask] Single target path`)
        result = await this.executeWithSingleTarget(task)
      } else {
        // Multiple targets - plan and execute
        logger.info(`[executeTask] Multiple targets path, calling executeWithMultipleTargets...`)
        result = await this.executeWithMultipleTargets(task, abortController.signal, execution, preGeneratedPlan)
        logger.info(`[executeTask] executeWithMultipleTargets completed`)
      }

      clearTimeout(timeoutId)

      const duration = Date.now() - startTime

      execution.completedAt = new Date().toISOString()
      execution.status = result.success ? 'completed' : 'failed'
      execution.result = result

      logger.info(`[executeTask] Task execution completed: ${executionId} in ${duration}ms`)
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

      logger.error(`[executeTask] Task execution failed: ${executionId}`, error as Error)
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
   * @param task - The task to execute
   * @param signal - Abort signal for cancellation
   * @param execution - Execution record to update
   * @param preGeneratedPlan - Optional pre-generated execution plan (skips AI planning if provided)
   */
  private async executeWithMultipleTargets(
    task: PeriodicTask,
    signal: AbortSignal,
    execution: TaskExecution,
    preGeneratedPlan?: TaskExecutionPlan
  ): Promise<TaskExecutionResult> {
    const startTime = Date.now()

    console.log(`[TaskExecutorService] executeWithMultipleTargets called for task ${task.id}`)
    logger.info(`[executeWithMultipleTargets] Executing task ${task.id} with ${task.targets.length} targets`)
    logger.info(`[executeWithMultipleTargets] Smart planning enabled: ${task.execution.enableSmartPlanning ?? true}`)

    try {
      // Check if smart planning is enabled
      const enableSmartPlanning = task.execution.enableSmartPlanning ?? true

      console.log(`[TaskExecutorService] enableSmartPlanning: ${enableSmartPlanning}`)
      console.log(`[TaskExecutorService] hasPreGeneratedPlan: ${!!preGeneratedPlan}`)

      let plan: TaskExecutionPlan
      if (preGeneratedPlan) {
        // Use pre-generated plan (from user confirmation)
        console.log(`[TaskExecutorService] Using pre-generated plan`)
        logger.info(`[executeWithMultipleTargets] Using pre-generated plan for task ${task.id}`)
        plan = preGeneratedPlan
      } else if (enableSmartPlanning) {
        // Step 1: Plan execution order using AI
        console.log(`[TaskExecutorService] Calling planExecution...`)
        logger.info(`[executeWithMultipleTargets] Using AI-powered planning for task ${task.id}`)
        plan = await this.planExecution(task)
        console.log(`[TaskExecutorService] planExecution returned`)
        logger.info(`[executeWithMultipleTargets] Execution plan generated for task ${task.id}`, {
          parallelGroups: plan.parallelGroups.length,
          steps: plan.steps.length,
          hasSummary: !!plan.summary,
          hasMetadata: !!plan.planningMetadata
        })
      } else {
        // Step 1: Use simple rule-based plan
        console.log(`[TaskExecutorService] Using rule-based planning`)
        logger.info(`[executeWithMultipleTargets] Using rule-based planning for task ${task.id}`)
        plan = this.generateRuleBasedPlan(task.targets)
        logger.info(`[executeWithMultipleTargets] Rule-based execution plan for task ${task.id}`, {
          parallelGroups: plan.parallelGroups.length,
          steps: plan.steps.length
        })
      }

      // Save plan to execution record immediately after generation
      // Create a simplified plan without circular references to avoid serialization issues
      execution.plan = this.simplifyPlan(plan)
      logger.info(`[executeWithMultipleTargets] Plan saved to execution ${execution.id}`)

      console.log(
        `[TaskExecutorService] Plan: ${plan.parallelGroups.length} parallel groups, ${plan.steps.length} sequential steps`
      )
      logger.info(
        `[executeWithMultipleTargets] Plan: ${plan.parallelGroups.length} parallel groups, ${plan.steps.length} sequential steps`
      )

      // Step 2: Execute targets according to plan
      const results: Array<{
        target: TaskTarget
        result: string
        success: boolean
        error?: string
      }> = []

      // Execute parallel groups first
      logger.info(`[executeWithMultipleTargets] Executing ${plan.parallelGroups.length} parallel groups...`)
      for (const group of plan.parallelGroups) {
        if (signal.aborted) throw new Error('Execution aborted')

        logger.info(`[executeWithMultipleTargets] Executing parallel group with ${group.targets.length} targets`)
        const groupResults = await Promise.all(
          group.targets.map(async (target) => {
            try {
              logger.info(`[executeWithMultipleTargets] Executing target: ${target.type}/${target.id}`)
              const output = await this.executeTarget(task, target)
              logger.info(`[executeWithMultipleTargets] Target completed: ${target.type}/${target.id}`)
              return {
                target,
                result: output,
                success: true
              }
            } catch (error) {
              logger.error(`[executeWithMultipleTargets] Target failed: ${target.type}/${target.id}`, error as Error)
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
      logger.info(`[executeWithMultipleTargets] Executing ${plan.steps.length} sequential steps...`)
      for (const step of plan.steps) {
        if (signal.aborted) throw new Error('Execution aborted')

        try {
          logger.info(`[executeWithMultipleTargets] Executing step: ${step.target.type}/${step.target.id}`)
          const output = await this.executeTarget(task, step.target)
          logger.info(`[executeWithMultipleTargets] Step completed: ${step.target.type}/${step.target.id}`)
          results.push({
            target: step.target,
            result: output,
            success: true
          })
        } catch (error) {
          logger.error(
            `[executeWithMultipleTargets] Step failed: ${step.target.type}/${step.target.id}`,
            error as Error
          )
          results.push({
            target: step.target,
            result: '',
            success: false,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }

      // Step 3: Aggregate results
      logger.info(`[executeWithMultipleTargets] Aggregating results...`)
      const aggregatedOutput = await this.aggregateResults(task, results)

      const allSuccess = results.every((r) => r.success)
      logger.info(`[executeWithMultipleTargets] All targets success: ${allSuccess}`)

      // Step 4: Analyze plan execution
      const totalDuration = Date.now() - startTime
      logger.info(`[executeWithMultipleTargets] Analyzing plan execution...`)
      const planAnalysis = this.analyzePlanExecution(plan, results, totalDuration)

      // Save analysis to execution record
      execution.planAnalysis = planAnalysis
      logger.info(`[executeWithMultipleTargets] Plan analysis saved to execution ${execution.id}`)

      return {
        success: allSuccess,
        output: aggregatedOutput,
        duration: totalDuration,
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
      logger.error(`[executeWithMultipleTargets] Execution failed`, error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime
      }
    }
  }

  /**
   * Plan execution order for multiple targets using AI-powered planning
   * Note: This method always uses AI planning. The enableSmartPlanning check is done in executeWithMultipleTargets.
   * Falls back to rule-based planning if AI planning fails.
   */
  private async planExecution(task: PeriodicTask): Promise<TaskExecutionPlan> {
    console.log(`[TaskExecutorService] planExecution called for task ${task.id}`)
    logger.info(`[planExecution] Starting AI-powered planning for task ${task.id}`, {
      targetsCount: task.targets.length,
      taskName: task.name,
      planModel: task.execution.planModel
    })

    try {
      // Import TaskPlanningService
      console.log(`[TaskExecutorService] Importing TaskPlanningService...`)
      logger.info(`[planExecution] Importing TaskPlanningService...`)
      const taskPlanningService = (await import('./TaskPlanningService')).default
      console.log(`[TaskExecutorService] TaskPlanningService imported`)
      logger.info(`[planExecution] TaskPlanningService imported, calling generateExecutionPlan...`)

      // Generate intelligent execution plan with planModel configuration
      console.log(`[TaskExecutorService] Calling generateExecutionPlan with planModel: ${task.execution.planModel}...`)
      const planningResult = await taskPlanningService.generateExecutionPlan(
        task.name,
        task.description,
        task.targets,
        task.execution.message,
        task.execution.planModel // Pass the planModel from task configuration
      )
      console.log(`[TaskExecutorService] generateExecutionPlan returned:`, {
        success: planningResult.success,
        duration: planningResult.duration,
        hasPlan: !!planningResult.plan,
        error: planningResult.error
      })

      logger.info(`[planExecution] Planning result received:`, {
        success: planningResult.success,
        duration: planningResult.duration,
        hasPlan: !!planningResult.plan,
        error: planningResult.error
      })

      if (planningResult.success && planningResult.plan) {
        console.log(`[TaskExecutorService] AI planning succeeded`)
        logger.info(`[planExecution] ✅ AI planning succeeded for task ${task.id}`, {
          confidence: planningResult.plan.planningMetadata?.confidence,
          planningTime: planningResult.duration,
          summary: planningResult.plan.summary
        })
        return planningResult.plan
      } else {
        console.log(`[TaskExecutorService] AI planning failed, falling back to rule-based planning`)
        const error = planningResult.error || 'Unknown error'
        logger.warn(`[planExecution] ⚠️ AI planning failed for task ${task.id}, falling back to rule-based planning`, {
          error
        })
        // Fall back to rule-based planning instead of throwing error
        return this.generateRuleBasedPlan(task.targets)
      }
    } catch (error) {
      console.error(`[TaskExecutorService] Error in planExecution:`, error)
      logger.error(
        `[planExecution] ❌ Error during AI planning for task ${task.id}, falling back to rule-based planning`,
        error as Error
      )
      // Fall back to rule-based planning instead of throwing error
      logger.info(`[planExecution] 🔄 Using rule-based fallback plan for task ${task.id}`)
      return this.generateRuleBasedPlan(task.targets)
    }
  }

  /**
   * Generate a rule-based execution plan as fallback
   */
  private generateRuleBasedPlan(targets: TaskTarget[]): TaskExecutionPlan {
    const assistants = targets.filter((t) => t.type === 'assistant')
    const agents = targets.filter((t) => t.type === 'agent')
    const agentSessions = targets.filter((t) => t.type === 'agent_session')

    const plan: TaskExecutionPlan = {
      parallelGroups: [],
      steps: []
    }

    // Group assistants to run in parallel
    if (assistants.length > 0) {
      plan.parallelGroups.push({
        targets: assistants,
        description: 'Execute all assistants in parallel',
        reason: 'Assistants generate independent responses'
      })
    }

    let order = 1
    // Add agent sessions as sequential steps
    agentSessions.forEach((session) => {
      plan.steps.push({
        target: session,
        order: order++,
        reason: 'Agent sessions are executed sequentially for consistency'
      })
    })

    // Add agents as sequential steps
    agents.forEach((agent) => {
      plan.steps.push({
        target: agent,
        order: order++,
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
   * Includes retry logic for transient failures.
   */
  private async executeTarget(task: PeriodicTask, target: TaskTarget): Promise<string> {
    const operationName = `Execute target ${target.type}/${target.id}`

    return this.executeWithRetry(
      async () => {
        logger.info(`[executeTarget] Executing target: ${target.type}/${target.id}`)

        // Delegate to renderer process for actual AI execution
        // The renderer has access to message sending infrastructure
        const { BrowserWindow } = await import('electron')
        const windows = BrowserWindow.getAllWindows()

        logger.info(`[executeTarget] Found ${windows.length} windows`)

        // Find the main window (not splash, hidden, etc.)
        const mainWindow = windows.find((w) => w.isVisible() && !w.isDestroyed())

        if (!mainWindow) {
          logger.error(`[executeTarget] No visible window found to execute task`)
          throw new Error('No visible window found to execute task')
        }

        logger.info(`[executeTarget] Found main window, sending task-execute-target event`)

        // Generate unique execution ID for this target execution to avoid confusion when multiple targets execute in parallel
        const targetExecutionId = `${task.id}::${target.type}/${target.id}::${Date.now()}`

        // Send execution request to renderer via IPC
        // The renderer will execute and send back results via IPC
        mainWindow.webContents.send('task-execute-target', {
          taskId: task.id,
          taskName: task.name,
          target,
          targetExecutionId, // Add unique identifier to distinguish parallel executions
          message: task.execution.message,
          continueConversation: task.execution.continueConversation,
          maxExecutionTime: task.execution.maxExecutionTime
        })

        logger.info(`[executeTarget] IPC event sent, waiting for response...`, { targetExecutionId })

        // Wait for the result from renderer via IPC
        const maxExecutionTime = task.execution.maxExecutionTime || 300
        logger.info(`[executeTarget] Max wait time: ${maxExecutionTime}s`)

        const { ipcMain } = await import('electron')

        const result = await new Promise<{ success: boolean; output?: string; error?: string }>((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            logger.error(`[executeTarget] Timeout waiting for renderer response`)
            cleanup()
            reject(new Error('Task execution timeout'))
          }, maxExecutionTime * 1000)

          const completedHandler = (_event: Electron.IpcMainEvent, data: any) => {
            logger.info(`[executeTarget] Received task-execution-completed IPC event`, {
              taskId: data.taskId,
              targetExecutionId: data.targetExecutionId
            })
            // Match both taskId AND targetExecutionId to ensure we get the correct target's result
            if (data.taskId === task.id && data.targetExecutionId === targetExecutionId) {
              cleanup()
              resolve({
                success: true,
                output: data.execution?.result?.output
              })
            }
          }

          const failedHandler = (_event: Electron.IpcMainEvent, data: any) => {
            logger.info(`[executeTarget] Received task-execution-failed IPC event`, {
              taskId: data.taskId,
              targetExecutionId: data.targetExecutionId,
              error: data.error
            })
            // Match both taskId AND targetExecutionId to ensure we get the correct target's result
            if (data.taskId === task.id && data.targetExecutionId === targetExecutionId) {
              cleanup()
              resolve({
                success: false,
                error: data.execution?.result?.error || data.error
              })
            }
          }

          const cleanup = () => {
            clearTimeout(timeoutId)
            ipcMain.removeListener('task-execution-completed', completedHandler)
            ipcMain.removeListener('task-execution-failed', failedHandler)
          }

          // Listen for IPC messages from renderer
          ipcMain.on('task-execution-completed', completedHandler)
          ipcMain.on('task-execution-failed', failedHandler)

          logger.info(`[executeTarget] Registered IPC event listeners`)
        })

        logger.info(`[executeTarget] Received result from renderer`, { success: result.success })

        if (!result.success) {
          throw new Error(result.error || 'Task execution failed')
        }

        return result.output || 'Task completed successfully'
      },
      DEFAULT_RETRY_CONFIG,
      operationName
    )
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
   * Simplify execution plan to avoid circular references
   * Creates a clean plan with simple target objects
   */
  private simplifyPlan(plan: TaskExecutionPlan): TaskExecutionPlan {
    return {
      summary: plan.summary,
      parallelGroups: plan.parallelGroups.map((group) => ({
        targets: group.targets.map((target) => ({
          type: target.type,
          id: target.id,
          name: target.name
        })),
        description: group.description,
        estimatedDuration: group.estimatedDuration,
        reason: group.reason
      })),
      steps: plan.steps.map((step) => ({
        target: {
          type: step.target.type,
          id: step.target.id,
          name: step.target.name
        },
        order: step.order,
        reason: step.reason,
        estimatedDuration: step.estimatedDuration
      })),
      planningMetadata: plan.planningMetadata
        ? {
            modelUsed: plan.planningMetadata.modelUsed,
            planningTime: plan.planningMetadata.planningTime,
            confidence: plan.planningMetadata.confidence,
            dependencies: plan.planningMetadata.dependencies.map((dep) => ({
              from: {
                type: dep.from.type,
                id: dep.from.id,
                name: dep.from.name
              },
              to: {
                type: dep.to.type,
                id: dep.to.id,
                name: dep.to.name
              },
              reason: dep.reason,
              type: dep.type
            })),
            estimatedDuration: plan.planningMetadata.estimatedDuration,
            plannedAt: plan.planningMetadata.plannedAt,
            reasoning: plan.planningMetadata.reasoning
          }
        : undefined
    }
  }

  /**
   * Analyze plan execution results comparing planned vs actual
   */
  private analyzePlanExecution(
    plan: TaskExecutionPlan,
    results: Array<{
      target: TaskTarget
      result: string
      success: boolean
      error?: string
    }>,
    totalActualDuration: number
  ): PlanExecutionAnalysis {
    logger.info(`[analyzePlanExecution] Analyzing plan execution...`)

    // Calculate total estimated duration
    const totalEstimatedDuration = plan.planningMetadata?.estimatedDuration

    // Calculate duration accuracy (how close actual was to estimated)
    let durationAccuracy = 1
    if (totalEstimatedDuration && totalEstimatedDuration > 0) {
      const actualSeconds = totalActualDuration / 1000
      durationAccuracy = 1 - Math.abs(actualSeconds - totalEstimatedDuration) / totalEstimatedDuration
      durationAccuracy = Math.max(0, Math.min(1, durationAccuracy)) // Clamp to 0-1
    }

    // Build target results with timing information
    const targetResults: TargetExecutionResult[] = results.map((r) => {
      // Find estimated duration for this target from plan
      const estimatedDuration = this.findEstimatedDurationForTarget(plan, r.target)

      return {
        target: r.target,
        success: r.success,
        actualDuration: 0, // We don't track individual target durations yet
        estimatedDuration,
        output: r.result,
        error: r.error
      }
    })

    // Calculate success metrics
    const totalTargets = results.length
    const successfulTargets = results.filter((r) => r.success).length
    const failedTargets = totalTargets - successfulTargets
    const successRate = totalTargets > 0 ? successfulTargets / totalTargets : 0

    // Identify slow and fast targets
    const slowTargets: string[] = []
    const fastTargets: string[] = []

    // For now, we'll classify based on success/failure since we don't have individual durations
    const failedTargetNames = results.filter((r) => !r.success).map((r) => r.target.name)

    // Generate insights and suggestions
    const suggestions: string[] = []

    // Suggestion 1: Duration accuracy
    if (totalEstimatedDuration) {
      const actualSeconds = totalActualDuration / 1000
      const diffPercent = ((actualSeconds - totalEstimatedDuration) / totalEstimatedDuration) * 100

      if (Math.abs(diffPercent) > 50) {
        if (diffPercent > 0) {
          suggestions.push(`实际执行时间比预估长 ${diffPercent.toFixed(0)}%，建议增加预估时间`)
        } else {
          suggestions.push(`实际执行时间比预估短 ${Math.abs(diffPercent).toFixed(0)}%，可以优化预估时间`)
        }
      }
    }

    // Suggestion 2: Success rate
    if (successRate < 1) {
      suggestions.push(`${failedTargets} 个目标执行失败，建议检查配置或增加错误处理`)
    }

    // Suggestion 3: Planning quality
    if (plan.planningMetadata) {
      const confidence = plan.planningMetadata.confidence
      if (confidence > 0.8 && successRate < 0.8) {
        suggestions.push(`AI 规划置信度高 (${(confidence * 100).toFixed(0)}%) 但成功率较低，建议检查目标配置`)
      }
    }

    // Suggestion 4: Recommendation for rule-based planning
    const recommendRuleBased = successRate < 0.5 || (plan.planningMetadata && plan.planningMetadata.confidence < 0.5)
    if (recommendRuleBased) {
      suggestions.push('建议下次使用基于规则的规划方式')
    }

    const analysis: PlanExecutionAnalysis = {
      analyzedAt: new Date().toISOString(),
      totalActualDuration,
      totalEstimatedDuration,
      durationAccuracy,
      totalTargets,
      successfulTargets,
      failedTargets,
      successRate,
      targetResults,
      insights: {
        withinEstimatedTime: totalEstimatedDuration ? totalActualDuration / 1000 <= totalEstimatedDuration * 1.5 : true,
        slowTargets,
        fastTargets,
        failedTargetNames,
        suggestions
      },
      planningQuality: plan.planningMetadata
        ? {
            confidenceJustified: successRate >= plan.planningMetadata.confidence * 0.8,
            dependenciesWorked: successRate >= 0.8,
            recommendRuleBased: recommendRuleBased || false
          }
        : undefined
    }

    logger.info(`[analyzePlanExecution] Analysis complete`, {
      successRate,
      durationAccuracy,
      withinEstimatedTime: analysis.insights.withinEstimatedTime
    })

    return analysis
  }

  /**
   * Find estimated duration for a specific target from the plan
   */
  private findEstimatedDurationForTarget(plan: TaskExecutionPlan, target: TaskTarget): number | undefined {
    // Check parallel groups
    for (const group of plan.parallelGroups) {
      if (group.targets.some((t) => t.id === target.id)) {
        return group.estimatedDuration
      }
    }

    // Check sequential steps
    for (const step of plan.steps) {
      if (step.target.id === target.id) {
        return step.estimatedDuration
      }
    }

    return undefined
  }

  /**
   * Execute a function with retry logic for transient failures
   */
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    config: RetryConfig = DEFAULT_RETRY_CONFIG,
    operationName: string = 'operation'
  ): Promise<T> {
    let lastError: Error | undefined
    let delay = config.initialDelay

    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      try {
        logger.info(`[executeWithRetry] ${operationName} - Attempt ${attempt}/${config.maxAttempts}`)
        return await fn()
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        const isTransient = this.isTransientError(lastError)

        logger.warn(`[executeWithRetry] ${operationName} - Attempt ${attempt} failed`, {
          error: lastError.message,
          isTransient,
          willRetry: attempt < config.maxAttempts && isTransient
        })

        // Don't retry if this is the last attempt or error is not transient
        if (attempt >= config.maxAttempts || !isTransient) {
          break
        }

        // Wait before retry with exponential backoff
        logger.info(`[executeWithRetry] ${operationName} - Retrying in ${delay}ms...`)
        await this.sleep(delay)
        delay = Math.min(delay * config.backoffMultiplier, config.maxDelay)
      }
    }

    throw lastError || new Error(`${operationName} failed after ${config.maxAttempts} attempts`)
  }

  /**
   * Check if an error is transient (retryable) or permanent
   */
  private isTransientError(error: Error): boolean {
    const transientPatterns = [
      /timeout/i,
      /network/i,
      /connection/i,
      /ECONNRESET/i,
      /ETIMEDOUT/i,
      /ENOTFOUND/i,
      /socket/i,
      /fetch/i,
      /temporarily/i,
      /unavailable/i
    ]

    return transientPatterns.some((pattern) => pattern.test(error.message))
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
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
