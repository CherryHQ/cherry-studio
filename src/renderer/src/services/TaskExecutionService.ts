/**
 * Task Execution Service (Renderer)
 * Handles actual AI assistant/agent calls for periodic tasks
 */

import { loggerService } from '@logger'
import ModernAiProvider from '@renderer/aiCore/index_new'
import store from '@renderer/store/index'
import type { StreamTextParams } from '@renderer/types/aiCoreTypes'
import type { PeriodicTask, TaskExecution, TaskTarget } from '@types'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('TaskExecutionService')

export interface TaskExecutionRequest {
  taskId: string
  taskName: string
  target: {
    type: 'assistant' | 'agent' | 'agent_session'
    id: string
    name: string
  }
  message: string
  continueConversation?: boolean
  maxExecutionTime?: number
}

export interface TaskExecutionResult {
  success: boolean
  output?: string
  error?: string
  duration?: number
  metadata?: Record<string, unknown>
}

/**
 * Execute a task by calling the appropriate AI assistant/agent
 */
export async function executeTask(request: TaskExecutionRequest): Promise<TaskExecutionResult> {
  const startTime = Date.now()

  try {
    logger.info(`正在执行任务：${request.taskName}，目标：${request.target.type}/${request.target.id}`)

    let output: string

    if (request.target.type === 'assistant') {
      output = await executeWithAssistant(request.target.id, request.message)
    } else if (request.target.type === 'agent') {
      output = await executeWithAgent(request.target.id, request.message)
    } else if (request.target.type === 'agent_session') {
      output = await executeWithAgentSession(request.target.id, request.message)
    } else {
      throw new Error(`不支持的目标类型：${request.target.type}`)
    }

    const duration = Date.now() - startTime
    logger.info(`任务执行完成，耗时：${duration}ms`)

    return {
      success: true,
      output,
      duration
    }
  } catch (error) {
    const duration = Date.now() - startTime
    logger.error(`任务执行失败，耗时：${duration}ms`, error as Error)

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration
    }
  }
}

/**
 * Execute a PeriodicTask and return a TaskExecution record
 * This is the main entry point for task execution
 */
export async function executeTaskDirect(task: PeriodicTask): Promise<TaskExecution> {
  const executionId = `exec-${uuidv4()}`
  const startTime = Date.now()

  const execution: TaskExecution = {
    id: executionId,
    taskId: task.id,
    status: 'running',
    startedAt: new Date().toISOString()
  }

  logger.info(`开始任务执行：${executionId}，任务：${task.id}`)

  try {
    // Execute based on number of targets
    let result: TaskExecutionResult

    if (task.targets.length === 0) {
      throw new Error('任务没有可执行的目标')
    } else if (task.targets.length === 1) {
      // Single target - execute directly
      result = await executeSingleTarget(task)
    } else {
      // Multiple targets - execute all and aggregate results
      result = await executeMultipleTargets(task)
    }

    const duration = Date.now() - startTime

    execution.completedAt = new Date().toISOString()
    execution.status = result.success ? 'completed' : 'failed'
    execution.result = result

    logger.info(`任务执行完成：${executionId}，耗时：${duration}ms`)
  } catch (error) {
    const duration = Date.now() - startTime
    execution.completedAt = new Date().toISOString()
    execution.status = 'failed'
    execution.result = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration
    }

    logger.error(`任务执行失败：${executionId}`, error as Error)
  }

  return execution
}

/**
 * Execute task with a single target
 */
async function executeSingleTarget(task: PeriodicTask): Promise<TaskExecutionResult> {
  const target = task.targets[0]
  const startTime = Date.now()

  logger.info(`正在执行任务 ${task.id}，目标：${target.type}/${target.id}`)

  try {
    let output: string

    if (target.type === 'assistant') {
      output = await executeWithAssistant(target.id, task.execution.message)
    } else if (target.type === 'agent') {
      output = await executeWithAgent(target.id, task.execution.message)
    } else if (target.type === 'agent_session') {
      output = await executeWithAgentSession(target.id, task.execution.message)
    } else {
      throw new Error(`不支持的目标类型：${target.type}`)
    }

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
 * Execute task with multiple targets and aggregate results
 */
async function executeMultipleTargets(task: PeriodicTask): Promise<TaskExecutionResult> {
  const startTime = Date.now()

  logger.info(`正在执行任务 ${task.id}，共 ${task.targets.length} 个目标`)

  try {
    const results: Array<{
      target: TaskTarget
      result: string
      success: boolean
      error?: string
    }> = []

    // Execute all targets in sequence (can be optimized for parallel execution later)
    for (const target of task.targets) {
      try {
        let output: string

        if (target.type === 'assistant') {
          output = await executeWithAssistant(target.id, task.execution.message)
        } else if (target.type === 'agent') {
          output = await executeWithAgent(target.id, task.execution.message)
        } else if (target.type === 'agent_session') {
          output = await executeWithAgentSession(target.id, task.execution.message)
        } else {
          throw new Error(`不支持的目标类型：${target.type}`)
        }

        results.push({
          target,
          result: output,
          success: true
        })
      } catch (error) {
        results.push({
          target,
          result: '',
          success: false,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    // Aggregate results
    const aggregatedOutput = aggregateResults(task, results)

    const allSuccess = results.every((r) => r.success)

    return {
      success: allSuccess,
      output: aggregatedOutput,
      duration: Date.now() - startTime,
      metadata: {
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
 * Aggregate results from multiple targets
 */
function aggregateResults(
  task: PeriodicTask,
  results: Array<{
    target: TaskTarget
    result: string
    success: boolean
    error?: string
  }>
): string {
  const lines: string[] = []
  lines.push(`# 任务执行摘要：${task.name}`)
  lines.push('')
  lines.push(`**总计目标：** ${results.length}`)
  lines.push(`**成功：** ${results.filter((r) => r.success).length}`)
  lines.push(`**失败：** ${results.filter((r) => !r.success).length}`)
  lines.push('')

  for (const { target, result, success, error } of results) {
    lines.push(`## ${target.name} (${target.type})`)
    lines.push(`**状态：** ${success ? '✅ 成功' : '❌ 失败'}`)
    if (result) {
      lines.push(`**输出：**`)
      lines.push(result)
    }
    if (error) {
      lines.push(`**错误：** ${error}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Execute task with an assistant
 * Uses ModernAiProvider to call AI directly
 */
async function executeWithAssistant(assistantId: string, message: string): Promise<string> {
  // Get the assistant
  const assistants = store.getState().assistants.assistants
  const assistant = assistants.find((a) => a.id === assistantId)

  if (!assistant) {
    throw new Error(`未找到助手：${assistantId}`)
  }

  if (!assistant.model) {
    throw new Error(`助手 ${assistant.name} 没有配置模型`)
  }

  logger.info(`正在执行助手任务：${assistant.name}，模型：${assistant.model.name}`)

  try {
    // Create AI provider instance
    const aiProvider = new ModernAiProvider(assistant.model)

    // Prepare parameters for completions
    const params: StreamTextParams = {
      messages: [
        {
          role: 'user',
          content: message
        }
      ]
    }

    // Call AI completions with proper config
    const result = await aiProvider.completions(assistant.model.id, params, {
      assistant,
      streamOutput: false,
      enableReasoning: false,
      isPromptToolUse: false,
      isSupportedToolUse: false,
      isImageGenerationEndpoint: false,
      enableWebSearch: false,
      enableGenerateImage: false,
      enableUrlContext: false,
      callType: 'task_execution',
      topicId: `task-${uuidv4()}`
    })

    // Extract text from result using getText() method
    return result.getText() || '未收到响应'
  } catch (error) {
    logger.error(`助手执行失败：`, error as Error)
    throw new Error(`助手 ${assistant.name} 执行失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Execute task with an agent
 * TODO: Implement actual agent execution
 * Currently returns placeholder response
 */
async function executeWithAgent(agentId: string, message: string): Promise<string> {
  logger.info(`正在执行代理任务：${agentId}`)

  // TODO: 实现实际的代理执行
  // 需要：
  // 1. 获取代理配置
  // 2. 创建或重用会话
  // 3. 向代理发送消息
  // 4. 等待响应
  // 5. 返回响应内容
  //
  // 目前返回占位符响应
  await new Promise((resolve) => setTimeout(resolve, 1000))

  return `[代理执行（占位符）]\n\n代理ID：${agentId}\n消息：${message}\n\n（注：完整的代理执行功能正在开发中 - 需要集成代理服务器API）`
}

/**
 * Execute task with an existing agent session
 * TODO: Implement actual agent session execution
 * Currently returns placeholder response
 */
async function executeWithAgentSession(sessionId: string, message: string): Promise<string> {
  logger.info(`正在执行代理会话任务：${sessionId}`)

  // TODO: 实现实际的代理会话执行
  // 需要：
  // 1. 获取会话信息
  // 2. 向会话发送消息
  // 3. 等待响应
  // 4. 返回响应内容
  //
  // 目前返回占位符响应
  await new Promise((resolve) => setTimeout(resolve, 1000))

  return `[代理会话执行（占位符）]\n\n会话ID：${sessionId}\n消息：${message}\n\n（注：完整的代理会话执行功能正在开发中 - 需要集成代理服务器API）`
}

/**
 * Set up IPC listener for task execution requests from main process
 * This is used when the task scheduler triggers a scheduled task
 */
export function setupTaskExecutionListener(): () => void {
  const handler = async (event: Event) => {
    // Cast to CustomEvent to access detail property
    const customEvent = event as CustomEvent<TaskExecutionRequest>
    const request = customEvent.detail

    logger.info(`Received task execution request from main process: ${request.taskName}`)

    try {
      // Get the task from the store
      const task = store.getState().tasks.tasks.find((t) => t.id === request.taskId)
      if (!task) {
        throw new Error(`Task not found: ${request.taskId}`)
      }

      // Execute the task directly
      const execution = await executeTaskDirect(task)

      // Save execution to storage
      await window.api.task.saveExecution(request.taskId, execution)

      // Send notification if configured
      if (execution.status === 'completed' && execution.result?.success) {
        window.toast.success(`任务 "${request.taskName}" 执行完成`)
      } else if (execution.status === 'failed') {
        window.toast.error(`任务 "${request.taskName}" 执行失败`)
      }

      // Notify main process that execution is complete
      if (execution.status === 'completed') {
        // @ts-ignore - custom event
        window.electron?.ipcRenderer?.send('task-execution-completed', {
          taskId: request.taskId,
          execution
        })
      } else {
        // @ts-ignore - custom event
        window.electron?.ipcRenderer?.send('task-execution-failed', {
          taskId: request.taskId,
          execution
        })
      }
    } catch (error) {
      logger.error('Task execution error:', error as Error)
      window.toast.error(
        `任务 "${request.taskName}" 执行出错: ${error instanceof Error ? error.message : String(error)}`
      )

      // Notify main process of failure
      // @ts-ignore - custom event
      window.electron?.ipcRenderer?.send('task-execution-failed', {
        taskId: request.taskId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  // Listen for the custom event from main process
  window.addEventListener('task-execute-target', handler)

  logger.info('Task execution listener registered')

  // Return cleanup function
  return () => {
    window.removeEventListener('task-execute-target', handler)
  }
}
