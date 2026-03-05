/**
 * Task Execution Service (Renderer)
 * Handles actual AI assistant/agent calls for periodic tasks
 */

import { loggerService } from '@logger'
import ModernAiProvider from '@renderer/aiCore/index_new'
import { buildStreamTextParams } from '@renderer/aiCore/prepareParams/parameterBuilder'
import { fetchMcpTools, getMcpServersForAssistant } from '@renderer/services/ApiService'
import store from '@renderer/store/index'
import { addAbortController } from '@renderer/utils/abortController'
import { isPromptToolUse, isSupportedToolUse } from '@renderer/utils/mcp-tools'
import { replacePromptVariables } from '@renderer/utils/prompt'
import type { MCPTool, PeriodicTask, TaskExecution, TaskTarget } from '@types'
import type { ModelMessage } from 'ai'
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
  targetExecutionId?: string // Unique identifier for this specific execution instance
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
  errorType?: 'transient' | 'permanent' | 'timeout' | 'aborted' | 'configuration'
}

/**
 * Categorize error type for better user feedback
 */
export function categorizeError(error: Error): TaskExecutionResult['errorType'] {
  const message = error.message.toLowerCase()

  // Check for timeout errors
  if (message.includes('timeout') || message.includes('超时')) {
    return 'timeout'
  }

  // Check for abort errors
  if (message.includes('aborted') || message.includes('中止')) {
    return 'aborted'
  }

  // Check for transient (network-related) errors
  const transientPatterns = [
    'network',
    'connection',
    'econnreset',
    'etimedout',
    'enotfound',
    'socket',
    'fetch',
    'temporarily',
    'unavailable'
  ]

  if (transientPatterns.some((pattern) => message.includes(pattern))) {
    return 'transient'
  }

  // Check for configuration errors
  if (
    message.includes('not found') ||
    message.includes('未找到') ||
    message.includes('disabled') ||
    message.includes('no model') ||
    message.includes('没有配置') ||
    message.includes('不支持')
  ) {
    return 'configuration'
  }

  // Default to permanent error
  return 'permanent'
}

/**
 * Get user-friendly error message based on error type and original error
 */
export function getUserFriendlyErrorMessage(error: Error, errorType: TaskExecutionResult['errorType']): string {
  switch (errorType) {
    case 'timeout':
      return '任务执行超时，请检查网络连接或增加最大执行时间'
    case 'aborted':
      return '任务已被中止'
    case 'transient':
      return `网络错误，已自动重试: ${error.message}`
    case 'configuration':
      return `配置错误: ${error.message}`
    case 'permanent':
    default:
      return error.message || '任务执行失败'
  }
}

/**
 * Execute a task by calling the appropriate AI assistant/agent
 * @param request - Task execution request
 * @param signal - Optional abort signal for cancellation
 */
export async function executeTask(request: TaskExecutionRequest, signal?: AbortSignal): Promise<TaskExecutionResult> {
  const startTime = Date.now()

  logger.info(`[executeTask] Starting execution for: ${request.taskName}`)
  logger.info(`[executeTask] Target: ${request.target.type}/${request.target.id}`)

  // Create local abort controller if no signal provided
  const localAbortController = signal ? undefined : new AbortController()
  const effectiveSignal = signal || localAbortController?.signal

  // Set timeout if maxExecutionTime is provided and no external signal
  if (localAbortController && request.maxExecutionTime) {
    setTimeout(() => {
      localAbortController.abort()
    }, request.maxExecutionTime * 1000)
  }

  try {
    logger.info(`[executeTask] Starting target execution...`)

    // Check if aborted before starting
    if (effectiveSignal?.aborted) {
      throw new Error('Task execution aborted')
    }

    let output: string

    if (request.target.type === 'assistant') {
      logger.info(`[executeTask] Executing assistant: ${request.target.id}`)
      output = await executeWithAssistant(
        request.target.id,
        request.message,
        effectiveSignal,
        request.continueConversation ? undefined : undefined // previousTopicId would need to be fetched from task
      )
    } else if (request.target.type === 'agent') {
      logger.info(`[executeTask] Executing agent: ${request.target.id}`)
      output = await executeWithAgent(request.target.id, request.message, effectiveSignal)
    } else if (request.target.type === 'agent_session') {
      logger.info(`[executeTask] Executing agent session: ${request.target.id}`)
      output = await executeWithAgentSession(request.target.id, request.message, effectiveSignal)
    } else {
      throw new Error(`不支持的目标类型：${request.target.type}`)
    }

    const duration = Date.now() - startTime
    logger.info(`[executeTask] Task execution completed successfully in ${duration}ms`)

    return {
      success: true,
      output,
      duration
    }
  } catch (error) {
    const duration = Date.now() - startTime
    const errorObj = error instanceof Error ? error : new Error(String(error))
    const errorType = categorizeError(errorObj)
    const userMessage = getUserFriendlyErrorMessage(errorObj, errorType)

    logger.error(`[executeTask] Task execution failed after ${duration}ms`, {
      error: errorObj.message,
      errorType,
      userMessage
    })

    return {
      success: false,
      error: userMessage,
      duration,
      errorType
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
      output = await executeWithAgent(target.id, task.execution.message, signal)
    } else if (target.type === 'agent_session') {
      output = await executeWithAgentSession(target.id, task.execution.message, signal)
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
          output = await executeWithAgent(target.id, task.execution.message, signal)
        } else if (target.type === 'agent_session') {
          output = await executeWithAgentSession(target.id, task.execution.message, signal)
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
 * Uses buildStreamTextParams to properly handle system prompt, MCP tools, and knowledge bases
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
    // Get the provider for this assistant's model
    const providers = store.getState().llm.providers
    const provider = providers.find((p) => p.id === assistant.model?.provider)

    if (!provider) {
      throw new Error(`未找到模型对应的 Provider：${assistant.model?.provider}`)
    }

    console.log('[TASKS] 使用 Provider:', provider.id)
    logger.info(`使用 Provider: ${provider.id}`)

    // Replace prompt variables
    console.log('[TASKS] 替换 prompt 变量')
    logger.info(`替换 prompt 变量`)
    assistant.prompt = await replacePromptVariables(assistant.prompt, assistant.model.name)

    // Build initial messages array
    const messages: ModelMessage[] = [
      {
        role: 'user',
        content: message
      }
    ]

    // Fetch MCP tools if assistant supports tool use
    let mcpTools: MCPTool[] = []
    if (isPromptToolUse(assistant) || isSupportedToolUse(assistant)) {
      console.log('[TASKS] 获取 MCP 工具')
      logger.info(`获取 MCP 工具`)
      mcpTools = await fetchMcpTools(assistant)
      console.log('[TASKS] 获取到 MCP 工具数量:', mcpTools.length)
      logger.info(`获取到 MCP 工具数量：${mcpTools.length}`)
    }

    // Inject knowledge base search if configured
    if (assistant.knowledge_bases?.length && assistant.knowledge_bases.length > 0) {
      console.log('[TASKS] 检测到知识库配置，开始知识库搜索')
      logger.info(`检测到知识库配置，开始知识库搜索`)

      // Import getKnowledgeReferences for knowledge base search
      const { getKnowledgeReferences } = await import('@renderer/services/KnowledgeService')

      const knowledgeReferences = await getKnowledgeReferences({
        assistant,
        lastUserMessage: messages[messages.length - 1] as any,
        topicId: previousTopicId
      })

      if (knowledgeReferences.length > 0) {
        console.log('[TASKS] 找到知识库引用数量:', knowledgeReferences.length)
        logger.info(`找到知识库引用数量：${knowledgeReferences.length}`)

        // Inject knowledge references into the user message
        const references = JSON.stringify(knowledgeReferences, null, 2)
        const REFERENCE_PROMPT = `请根据以下参考信息回答问题：\n\n参考信息：\n{references}\n\n问题：{question}`
        const knowledgeSearchPrompt = REFERENCE_PROMPT.replace('{question}', message).replace(
          '{references}',
          references
        )

        messages[messages.length - 1] = {
          role: 'user',
          content: knowledgeSearchPrompt
        }

        console.log('[TASKS] 知识库引用已注入到用户消息')
        logger.info(`知识库引用已注入到用户消息`)
      } else {
        console.log('[TASKS] 未找到相关知识库引用')
        logger.info(`未找到相关知识库引用`)
      }
    }

    // Use buildStreamTextParams to properly handle system prompt and other settings
    console.log('[TASKS] 使用 buildStreamTextParams 构建参数')
    logger.info(`使用 buildStreamTextParams 构建参数`)

    const { params } = await buildStreamTextParams(messages, assistant, provider, {
      mcpTools: mcpTools,
      webSearchProviderId: assistant.webSearchProviderId,
      requestOptions: {
        signal
      }
    })

    console.log(
      '[TASKS] 参数构建完成, system prompt 长度:',
      typeof params.system === 'string' ? params.system.length : 0
    )
    logger.info(`参数构建完成，system prompt 长度：${typeof params.system === 'string' ? params.system.length : 0}`)

    // Determine tool use settings
    const isPromptToolUseValue = isPromptToolUse(assistant)
    const isSupportedToolUseValue = isSupportedToolUse(assistant)

    console.log('[TASKS] 工具使用配置:', {
      isPromptToolUse: isPromptToolUseValue,
      isSupportedToolUse: isSupportedToolUseValue
    })
    logger.info(
      `工具使用配置：${JSON.stringify({ isPromptToolUse: isPromptToolUseValue, isSupportedToolUse: isSupportedToolUseValue })}`
    )

    // Create AI provider instance
    console.log('[TASKS] 创建 AI provider 实例')
    const aiProvider = new ModernAiProvider(assistant.model)

    // Use the same topicId if continuing conversation, otherwise generate new one
    const topicId = previousTopicId || `task-${uuidv4()}`
    console.log('[TASKS] 使用 topicId:', topicId)
    logger.info(`使用 topicId: ${topicId}`)

    console.log('[TASKS] 开始调用 AI completions')
    logger.info(`开始调用 AI completions`)

    // Wrap the AI call in a Promise that can be aborted
    const result = await new Promise<Awaited<ReturnType<typeof aiProvider.completions>>>(async (resolve, reject) => {
      const abortHandler = () => {
        reject(new Error('Task execution aborted'))
      }

      if (signal) {
        signal.addEventListener('abort', abortHandler, { once: true })
      }

      try {
        if (!assistant.model) {
          throw new Error(`助手 ${assistant.name} 没有配置模型`)
        }
        const aiResult = await aiProvider.completions(assistant.model.id, params, {
          assistant,
          streamOutput: false,
          enableReasoning: false,
          isPromptToolUse: isPromptToolUseValue,
          isSupportedToolUse: isSupportedToolUseValue,
          isImageGenerationEndpoint: false,
          enableWebSearch: false,
          enableGenerateImage: false,
          enableUrlContext: false,
          callType: 'task_execution',
          topicId,
          mcpTools,
          mcpMode: getMcpServersForAssistant(assistant).length > 0 ? 'manual' : 'disabled'
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

    const errorObj = error instanceof Error ? error : new Error(String(error))
    const errorType = categorizeError(errorObj)

    console.error('[TASKS] 助手执行失败:', error)
    logger.error(`助手执行失败：${errorObj.message}`, errorObj)

    // Re-throw with user-friendly message
    throw new Error(getUserFriendlyErrorMessage(errorObj, errorType))
  }
}

/**
 * Execute task with an agent
 * Creates a new session and sends a message to the agent
 */
async function executeWithAgent(agentId: string, message: string, signal?: AbortSignal): Promise<string> {
  console.log('[TASKS] executeWithAgent 开始, agentId:', agentId)
  logger.info(`executeWithAgent 开始，agentId: ${agentId}`)

  // Check if aborted before starting
  if (signal?.aborted) {
    throw new Error('Task execution aborted')
  }

  // Get API server configuration
  const { apiServer } = store.getState().settings
  if (!apiServer.enabled) {
    throw new Error('Agent API server is disabled')
  }

  // Import AgentApiClient
  const { AgentApiClient } = await import('@renderer/api/agent')

  // Build base URL
  const hasProtocol = apiServer.host.startsWith('http://') || apiServer.host.startsWith('https://')
  const baseHost = hasProtocol ? apiServer.host : `http://${apiServer.host}`
  const portSegment = apiServer.port ? `:${apiServer.port}` : ''
  const baseURL = `${baseHost}${portSegment}`

  const client = new AgentApiClient({
    baseURL,
    headers: {
      Authorization: `Bearer ${apiServer.apiKey}`
    }
  })

  try {
    // Get agent info first
    console.log('[TASKS] 获取代理信息:', agentId)
    logger.info(`获取代理信息：${agentId}`)
    const agent = await client.getAgent(agentId)
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    // Create a new session for this task execution
    console.log('[TASKS] 创建新会话')
    logger.info(`创建新会话`)
    const session = await client.createSession(agentId, {
      name: `Task Execution - ${new Date().toISOString()}`,
      accessible_paths: ['/'], // Default accessible path
      model: agent.model // Use the agent's default model
    })

    if (!session) {
      throw new Error('Failed to create agent session')
    }

    console.log('[TASKS] 会话创建成功:', session.id)
    logger.info(`会话创建成功：${session.id}`)

    // Send message to the session via fetch API (streaming)
    const url = `${baseURL}/v1/agents/${agentId}/sessions/${session.id}/messages`

    console.log('[TASKS] 发送消息到代理:', url)
    logger.info(`发送消息到代理：${url}`)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiServer.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify({ content: message }),
      signal
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(errorText || `Failed to stream agent message: ${response.status}`)
    }

    if (!response.body) {
      throw new Error('Agent message stream has no body')
    }

    // Collect the full response from the stream
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let fullResponse = ''
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim()
          if (data === '[DONE]') break

          try {
            const event = JSON.parse(data)
            if (event.type === 'text-delta' && event.text) {
              fullResponse += event.text
            }
          } catch {
            // Ignore parse errors for non-JSON lines
          }
        }
      }
    }

    console.log('[TASKS] 代理执行完成, 响应长度:', fullResponse.length)
    logger.info(`代理执行完成，响应长度：${fullResponse.length}`)

    return fullResponse || 'Agent execution completed'
  } catch (error) {
    // Check if it's an abort error
    if (error instanceof Error && error.name === 'AbortError') {
      console.log('[TASKS] 代理执行被中止')
      logger.info('代理执行被中止')
      throw new Error('Task execution aborted')
    }

    const errorObj = error instanceof Error ? error : new Error(String(error))
    const errorType = categorizeError(errorObj)

    console.error('[TASKS] 代理执行失败:', error)
    logger.error(`代理执行失败：${errorObj.message}`, errorObj)

    // Re-throw with user-friendly message
    throw new Error(getUserFriendlyErrorMessage(errorObj, errorType))
  }
}

/**
 * Execute task with an existing agent session
 * NOTE: This function requires the session ID to be in format "agent-session:<sessionId>"
 * We need to find the agent ID by listing all agents and their sessions
 */
async function executeWithAgentSession(sessionId: string, message: string, signal?: AbortSignal): Promise<string> {
  console.log('[TASKS] executeWithAgentSession 开始, sessionId:', sessionId)
  logger.info(`executeWithAgentSession 开始，sessionId: ${sessionId}`)

  // Check if aborted before starting
  if (signal?.aborted) {
    throw new Error('Task execution aborted')
  }

  // Get API server configuration
  const { apiServer } = store.getState().settings
  if (!apiServer.enabled) {
    throw new Error('Agent API server is disabled')
  }

  // Import AgentApiClient dynamically
  const { AgentApiClient } = await import('@renderer/api/agent')

  // Build base URL
  const hasProtocol = apiServer.host.startsWith('http://') || apiServer.host.startsWith('https://')
  const baseHost = hasProtocol ? apiServer.host : `http://${apiServer.host}`
  const portSegment = apiServer.port ? `:${apiServer.port}` : ''
  const baseURL = `${baseHost}${portSegment}`

  const client = new AgentApiClient({
    baseURL,
    headers: {
      Authorization: `Bearer ${apiServer.apiKey}`
    }
  })

  try {
    // Find the agent ID by listing all agents and their sessions
    console.log('[TASKS] 查找代理 ID')
    logger.info(`查找代理 ID`)

    const agentsResponse = await client.listAgents({ limit: 100 })
    let agentId: string | undefined
    let foundSession: { id: string } | undefined

    for (const agent of agentsResponse.data) {
      const sessions = await client.listSessions(agent.id)
      foundSession = sessions.data.find((s) => s.id === sessionId)
      if (foundSession) {
        agentId = agent.id
        break
      }
    }

    if (!agentId) {
      throw new Error(`Agent session not found: ${sessionId}`)
    }

    // Send message to the session via fetch API (streaming)
    const url = `${baseURL}/v1/agents/${agentId}/sessions/${sessionId}/messages`

    console.log('[TASKS] 发送消息到代理会话:', url)
    logger.info(`发送消息到代理会话：${url}`)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiServer.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify({ content: message }),
      signal
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(errorText || `Failed to stream agent session message: ${response.status}`)
    }

    if (!response.body) {
      throw new Error('Agent session message stream has no body')
    }

    // Collect the full response from the stream
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let fullResponse = ''
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim()
          if (data === '[DONE]') break

          try {
            const event = JSON.parse(data)
            if (event.type === 'text-delta' && event.text) {
              fullResponse += event.text
            }
          } catch {
            // Ignore parse errors for non-JSON lines
          }
        }
      }
    }

    console.log('[TASKS] 代理会话执行完成, 响应长度:', fullResponse.length)
    logger.info(`代理会话执行完成，响应长度：${fullResponse.length}`)

    return fullResponse || 'Agent session execution completed'
  } catch (error) {
    // Check if it's an abort error
    if (error instanceof Error && error.name === 'AbortError') {
      console.log('[TASKS] 代理会话执行被中止')
      logger.info('代理会话执行被中止')
      throw new Error('Task execution aborted')
    }

    const errorObj = error instanceof Error ? error : new Error(String(error))
    const errorType = categorizeError(errorObj)

    console.error('[TASKS] 代理会话执行失败:', error)
    logger.error(`代理会话执行失败：${errorObj.message}`, errorObj)

    // Re-throw with user-friendly message
    throw new Error(getUserFriendlyErrorMessage(errorObj, errorType))
  }
}

/**
 * Set up IPC listener for task execution requests from main process
 * This is used when the task scheduler triggers a scheduled task
 * or when executing individual targets from the main process
 */
export function setupTaskExecutionListener(): () => void {
  const handler = async (_event: Electron.IpcRendererEvent, request: TaskExecutionRequest) => {
    logger.info(`[task-execute-target] Received task execution request from main process: ${request.taskName}`, {
      target: request.target,
      hasTarget: !!request.target,
      targetExecutionId: request.targetExecutionId,
      message: request.message?.substring(0, 50)
    })

    try {
      // Execute the specific target from the request
      logger.info(`[task-execute-target] Calling executeTask...`)
      const result = await executeTask(request)
      logger.info(`[task-execute-target] executeTask completed`, { success: result.success })

      // Notify main process that execution is complete via IPC
      // Include targetExecutionId in the response to match with the correct execution
      // @ts-ignore - custom IPC API exposed through preload
      window.api.ipcRenderer?.send('task-execution-completed', {
        taskId: request.taskId,
        targetExecutionId: request.targetExecutionId, // Echo back the execution ID
        execution: {
          result: {
            success: result.success,
            output: result.output
          }
        }
      })

      logger.info(`[task-execute-target] Sent task-execution-completed event`, {
        targetExecutionId: request.targetExecutionId
      })
    } catch (error) {
      logger.error('[task-execute-target] Task execution error:', error as Error)

      // Notify main process of failure via IPC
      // Include targetExecutionId in the error response
      // @ts-ignore - custom IPC API exposed through preload
      window.api.ipcRenderer?.send('task-execution-failed', {
        taskId: request.taskId,
        targetExecutionId: request.targetExecutionId, // Echo back the execution ID
        error: error instanceof Error ? error.message : String(error)
      })

      logger.info(`[task-execute-target] Sent task-execution-failed event`)
    }
  }

  // Listen for IPC messages from main process (not DOM events)
  // @ts-ignore - custom IPC API exposed through preload
  window.api.ipcRenderer?.on('task-execute-target', handler)

  logger.info('[task-execute-target] Task execution IPC listener registered')

  // Return cleanup function
  return () => {
    // @ts-ignore - custom IPC API exposed through preload
    window.api.ipcRenderer?.removeListener('task-execute-target', handler)
  }
}
