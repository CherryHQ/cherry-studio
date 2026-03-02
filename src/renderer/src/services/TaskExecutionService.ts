/**
 * Task Execution Service (Renderer)
 * Handles actual AI assistant/agent calls for periodic tasks
 */

import { loggerService } from '@logger'
import ModernAiProvider from '@renderer/aiCore/index_new'
import store from '@renderer/store/index'
import type { StreamTextParams } from '@renderer/types/aiCoreTypes'
import { addAbortController } from '@renderer/utils/abortController'
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
 * @param task - The task to execute
 * @param executionId - Optional execution ID to use (for updating existing execution)
 */
export async function executeTaskDirect(task: PeriodicTask, executionId?: string): Promise<TaskExecution> {
  const startTime = Date.now()

  const execution: TaskExecution = {
    id: executionId || `exec-${uuidv4()}`,
    taskId: task.id,
    status: 'running',
    startedAt: new Date().toISOString()
  }

  console.log('[TASKS] 开始任务执行:', execution.id, '任务:', task.id, '目标数量:', task.targets.length)
  logger.info(`开始任务执行：${execution.id}，任务：${task.id}，目标数量：${task.targets.length}`)

  // Create AbortController and register globally for this execution
  const abortController = new AbortController()

  // Register the abort controller for this execution ID
  addAbortController(execution.id, () => {
    abortController.abort()
    logger.info(`Task execution aborted: ${execution.id}`)
  })

  // Find previous topicId if continueConversation is enabled
  let previousTopicId: string | undefined
  if (task.execution.continueConversation && task.executions.length > 0) {
    // Find the last completed execution with a topicId
    const lastExecution = task.executions.find((e) => e.topicId && e.status === 'completed')
    if (lastExecution?.topicId) {
      previousTopicId = lastExecution.topicId
      console.log('[TASKS] 继续对话，使用 topicId:', previousTopicId)
      logger.info(`继续对话，使用 topicId: ${previousTopicId}`)
    }
  }

  try {
    // Execute based on number of targets
    let result: TaskExecutionResult

    if (task.targets.length === 0) {
      throw new Error('任务没有可执行的目标')
    } else if (task.targets.length === 1) {
      // Single target - execute directly with timeout
      // maxExecutionTime is in seconds, convert to milliseconds
      const timeoutMs = (task.execution.maxExecutionTime || 300) * 1000
      console.log('[TASKS] 执行单个目标，超时时间:', timeoutMs, 'ms (', task.execution.maxExecutionTime, '秒)')
      logger.info(`执行单个目标，超时时间：${timeoutMs}ms (${task.execution.maxExecutionTime}秒)`)
      result = await Promise.race([
        executeSingleTarget(task, abortController.signal, previousTopicId),
        createTimeoutPromise(timeoutMs)
      ])
      console.log('[TASKS] 单个目标执行完成，成功:', result.success)
      logger.info(`单个目标执行完成，成功：${result.success}`)

      // Save topicId from result metadata
      if (result.metadata?.topicId && typeof result.metadata.topicId === 'string') {
        execution.topicId = result.metadata.topicId
      }
    } else {
      // Multiple targets - execute all and aggregate results with timeout
      // maxExecutionTime is in seconds, convert to milliseconds
      const timeoutMs = (task.execution.maxExecutionTime || 300) * 1000
      console.log('[TASKS] 执行多个目标，超时时间:', timeoutMs, 'ms (', task.execution.maxExecutionTime, '秒)')
      logger.info(`执行多个目标，超时时间：${timeoutMs}ms (${task.execution.maxExecutionTime}秒)`)
      result = await Promise.race([
        executeMultipleTargets(task, abortController.signal),
        createTimeoutPromise(timeoutMs)
      ])
      console.log('[TASKS] 多个目标执行完成，成功:', result.success)
      logger.info(`多个目标执行完成，成功：${result.success}`)
    }

    const duration = Date.now() - startTime

    execution.completedAt = new Date().toISOString()
    execution.status = result.success ? 'completed' : 'failed'
    execution.result = result

    console.log('[TASKS] 任务执行完成:', executionId, '状态:', execution.status, '耗时:', duration + 'ms')
    logger.info(`任务执行完成：${executionId}，状态：${execution.status}，耗时：${duration}ms`)
  } catch (error) {
    const duration = Date.now() - startTime
    execution.completedAt = new Date().toISOString()

    // Check if aborted
    if (abortController.signal.aborted) {
      execution.status = 'terminated'
    } else {
      execution.status = 'failed'
    }

    execution.result = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration
    }

    console.error('[TASKS] 任务执行失败:', executionId, '错误:', execution.result.error)
    logger.error(`任务执行失败：${executionId}，错误：${execution.result.error}`, error as Error)
  }

  // Clean up AbortController after task completion
  // Just remove from map without calling abort functions
  const abortMap = (await import('@renderer/utils/abortController')).abortMap
  abortMap.delete(execution.id)

  console.log('[TASKS] 返回执行记录:', executionId, '状态:', execution.status)
  logger.info(`返回执行记录：${executionId}，状态：${execution.status}`)
  return execution
}

/**
 * Create a timeout promise that rejects after the specified time
 */
function createTimeoutPromise(timeoutMs: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`任务执行超时（超过 ${timeoutMs / 1000} 秒）`))
    }, timeoutMs)
  })
}

/**
 * Execute task with a single target
 */
async function executeSingleTarget(
  task: PeriodicTask,
  signal?: AbortSignal,
  previousTopicId?: string
): Promise<TaskExecutionResult> {
  const target = task.targets[0]
  const startTime = Date.now()

  logger.info(`正在执行任务 ${task.id}，目标：${target.type}/${target.id}`)

  try {
    let output: string

    if (target.type === 'assistant') {
      output = await executeWithAssistant(target.id, task.execution.message, signal, previousTopicId)
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
        },
        topicId: previousTopicId // Include topicId in metadata
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
async function executeMultipleTargets(task: PeriodicTask, signal?: AbortSignal): Promise<TaskExecutionResult> {
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
      // Check if aborted
      if (signal?.aborted) {
        throw new Error('Task execution aborted')
      }

      try {
        let output: string

        if (target.type === 'assistant') {
          output = await executeWithAssistant(target.id, task.execution.message, signal)
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
async function executeWithAssistant(
  assistantId: string,
  message: string,
  signal?: AbortSignal,
  previousTopicId?: string
): Promise<string> {
  console.log('[TASKS] executeWithAssistant 开始, assistantId:', assistantId)
  logger.info(`executeWithAssistant 开始，assistantId: ${assistantId}`)

  // Check if aborted before starting
  if (signal?.aborted) {
    throw new Error('Task execution aborted')
  }

  // Get the assistant
  const assistants = store.getState().assistants.assistants
  const assistant = assistants.find((a) => a.id === assistantId)

  if (!assistant) {
    throw new Error(`未找到助手：${assistantId}`)
  }

  if (!assistant.model) {
    throw new Error(`助手 ${assistant.name} 没有配置模型`)
  }

  console.log('[TASKS] 正在执行助手任务:', assistant.name, '模型:', assistant.model.name)
  logger.info(`正在执行助手任务：${assistant.name}，模型：${assistant.model.name}`)

  try {
    // Create AI provider instance
    console.log('[TASKS] 创建 AI provider 实例')
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

    console.log('[TASKS] 开始调用 AI completions, 消息长度:', message.length)
    logger.info(`开始调用 AI completions，消息长度：${message.length}`)

    // Call AI completions with proper config
    console.log('[TASKS] 准备调用 aiProvider.completions')
    logger.info(`准备调用 aiProvider.completions`)

    // Use the same topicId if continuing conversation, otherwise generate new one
    const topicId = previousTopicId || `task-${uuidv4()}`
    console.log('[TASKS] 使用 topicId:', topicId)
    logger.info(`使用 topicId: ${topicId}`)

    // Wrap the AI call in a Promise that can be aborted
    const result = await new Promise<Awaited<ReturnType<typeof aiProvider.completions>>>(async (resolve, reject) => {
      const abortHandler = () => {
        reject(new Error('Task execution aborted'))
      }

      if (signal) {
        signal.addEventListener('abort', abortHandler, { once: true })
      }

      try {
        const aiResult = await aiProvider.completions(assistant.model.id, params, {
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
          topicId
        })
        resolve(aiResult)
      } catch (error) {
        reject(error)
      } finally {
        if (signal) {
          signal.removeEventListener('abort', abortHandler)
        }
      }
    })

    console.log('[TASKS] aiProvider.completions 调用完成')
    logger.info(`aiProvider.completions 调用完成`)

    console.log('[TASKS] AI completions 调用完成')
    logger.info(`AI completions 调用完成`)

    // Extract text from result using getText() method
    const text = result.getText() || '未收到响应'
    console.log('[TASKS] 提取响应文本成功, 长度:', text.length)
    logger.info(`提取响应文本成功，长度：${text.length}`)

    return text
  } catch (error) {
    // Check if it's an abort error
    if (error instanceof Error && error.message === 'Task execution aborted') {
      console.log('[TASKS] 任务执行被中止')
      logger.info('任务执行被中止')
      throw new Error('Task execution aborted')
    }

    console.error('[TASKS] 助手执行失败:', error)
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
