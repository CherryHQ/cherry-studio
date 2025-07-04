import Logger from '@renderer/config/logger'
import { MCPTool, MCPToolResponse, Model, ToolCallResponse } from '@renderer/types'
import { ChunkType, MCPToolCreatedChunk } from '@renderer/types/chunk'
import { SdkMessageParam, SdkRawOutput, SdkToolCall } from '@renderer/types/sdk'
import { parseAndCallTools } from '@renderer/utils/mcp-tools'

import { CompletionsParams, CompletionsResult, GenericChunk } from '../schemas'
import { CompletionsContext, CompletionsMiddleware } from '../types'

export const MIDDLEWARE_NAME = 'McpToolChunkMiddleware'
const MAX_TOOL_RECURSION_DEPTH = 20 // 防止无限递归

/**
 * MCP工具处理中间件
 *
 * 职责：
 * 1. 检测并拦截MCP工具进展chunk（Function Call方式和Tool Use方式）
 * 2. 执行工具调用
 * 3. 递归处理工具结果
 * 4. 管理工具调用状态和递归深度
 */
export const McpToolChunkMiddleware: CompletionsMiddleware =
  () =>
  (next) =>
  async (ctx: CompletionsContext, params: CompletionsParams): Promise<CompletionsResult> => {
    const mcpTools = params.mcpTools || []

    // 如果没有工具，直接调用下一个中间件
    if (!mcpTools || mcpTools.length === 0) {
      return next(ctx, params)
    }

    const executeWithToolHandling = async (currentParams: CompletionsParams, depth = 0): Promise<CompletionsResult> => {
      if (depth >= MAX_TOOL_RECURSION_DEPTH) {
        Logger.error(`🔧 [${MIDDLEWARE_NAME}] Maximum recursion depth ${MAX_TOOL_RECURSION_DEPTH} exceeded`)
        throw new Error(`Maximum tool recursion depth ${MAX_TOOL_RECURSION_DEPTH} exceeded`)
      }

      let result: CompletionsResult

      if (depth === 0) {
        result = await next(ctx, currentParams)
      } else {
        const enhancedCompletions = ctx._internal.enhancedDispatch
        if (!enhancedCompletions) {
          Logger.error(`🔧 [${MIDDLEWARE_NAME}] Enhanced completions method not found, cannot perform recursive call`)
          throw new Error('Enhanced completions method not found')
        }

        ctx._internal.toolProcessingState!.isRecursiveCall = true
        ctx._internal.toolProcessingState!.recursionDepth = depth

        result = await enhancedCompletions(ctx, currentParams)
      }

      if (!result.stream) {
        Logger.error(`🔧 [${MIDDLEWARE_NAME}] No stream returned from enhanced completions`)
        throw new Error('No stream returned from enhanced completions')
      }

      const resultFromUpstream = result.stream as ReadableStream<GenericChunk>
      const toolHandlingStream = resultFromUpstream.pipeThrough(
        createToolHandlingTransform(ctx, currentParams, mcpTools, depth, executeWithToolHandling)
      )

      return {
        ...result,
        stream: toolHandlingStream
      }
    }

    return executeWithToolHandling(params, 0)
  }

/**
 * 创建工具处理的 TransformStream
 */
function createToolHandlingTransform(
  ctx: CompletionsContext,
  currentParams: CompletionsParams,
  mcpTools: MCPTool[],
  depth: number,
  executeWithToolHandling: (params: CompletionsParams, depth: number) => Promise<CompletionsResult>
): TransformStream<GenericChunk, GenericChunk> {
  const toolCalls: SdkToolCall[] = []
  const toolUseResponses: MCPToolResponse[] = []
  const allToolResponses: MCPToolResponse[] = [] // 统一的工具响应状态管理数组
  let hasToolCalls = false
  let hasToolUseResponses = false
  let streamEnded = false

  // 存储已执行的工具结果
  const executedToolResults: SdkMessageParam[] = []
  const executedToolCalls: SdkToolCall[] = []
  const executionPromises: Promise<void>[] = []

  return new TransformStream({
    async transform(chunk: GenericChunk, controller) {
      try {
        // 处理MCP工具进展chunk
        if (chunk.type === ChunkType.MCP_TOOL_CREATED) {
          const createdChunk = chunk as MCPToolCreatedChunk

          // 1. 处理Function Call方式的工具调用
          if (createdChunk.tool_calls && createdChunk.tool_calls.length > 0) {
            hasToolCalls = true

            for (const toolCall of createdChunk.tool_calls) {
              toolCalls.push(toolCall)

              const executionPromise = (async () => {
                try {
                  const result = await executeToolCalls(
                    ctx,
                    [toolCall],
                    mcpTools,
                    allToolResponses,
                    currentParams.onChunk,
                    currentParams.assistant.model!
                  )

                  // 缓存执行结果
                  executedToolResults.push(...result.toolResults)
                  executedToolCalls.push(...result.confirmedToolCalls)
                } catch (error) {
                  console.error(`🔧 [${MIDDLEWARE_NAME}] Error executing tool call asynchronously:`, error)
                }
              })()

              executionPromises.push(executionPromise)
            }
          }

          // 2. 处理Tool Use方式的工具调用
          if (createdChunk.tool_use_responses && createdChunk.tool_use_responses.length > 0) {
            hasToolUseResponses = true
            for (const toolUseResponse of createdChunk.tool_use_responses) {
              toolUseResponses.push(toolUseResponse)
              const executionPromise = (async () => {
                try {
                  const result = await executeToolUseResponses(
                    ctx,
                    [toolUseResponse], // 单个执行
                    mcpTools,
                    allToolResponses,
                    currentParams.onChunk,
                    currentParams.assistant.model!
                  )

                  // 缓存执行结果
                  executedToolResults.push(...result.toolResults)
                } catch (error) {
                  console.error(`🔧 [${MIDDLEWARE_NAME}] Error executing tool use response asynchronously:`, error)
                  // 错误时不影响其他工具的执行
                }
              })()

              executionPromises.push(executionPromise)
            }
          }
        } else {
          controller.enqueue(chunk)
        }
      } catch (error) {
        console.error(`🔧 [${MIDDLEWARE_NAME}] Error processing chunk:`, error)
        controller.error(error)
      }
    },

    async flush(controller) {
      // 在流结束时等待所有异步工具执行完成，然后进行递归调用
      if (!streamEnded && (hasToolCalls || hasToolUseResponses)) {
        streamEnded = true

        try {
          await Promise.all(executionPromises)
          if (executedToolResults.length > 0) {
            const output = ctx._internal.toolProcessingState?.output
            const newParams = buildParamsWithToolResults(
              ctx,
              currentParams,
              output,
              executedToolResults,
              executedToolCalls
            )

            // 在递归调用前通知UI开始新的LLM响应处理
            if (currentParams.onChunk) {
              currentParams.onChunk({
                type: ChunkType.LLM_RESPONSE_CREATED
              })
            }

            await executeWithToolHandling(newParams, depth + 1)
          }
        } catch (error) {
          Logger.error(`🔧 [${MIDDLEWARE_NAME}] Error in tool processing:`, error)
          controller.error(error)
        } finally {
          hasToolCalls = false
          hasToolUseResponses = false
        }
      }
    }
  })
}

/**
 * 执行工具调用（Function Call 方式）
 */
async function executeToolCalls(
  ctx: CompletionsContext,
  toolCalls: SdkToolCall[],
  mcpTools: MCPTool[],
  allToolResponses: MCPToolResponse[],
  onChunk: CompletionsParams['onChunk'],
  model: Model
): Promise<{ toolResults: SdkMessageParam[]; confirmedToolCalls: SdkToolCall[] }> {
  const mcpToolResponses: ToolCallResponse[] = toolCalls
    .map((toolCall) => {
      const mcpTool = ctx.apiClientInstance.convertSdkToolCallToMcp(toolCall, mcpTools)
      if (!mcpTool) {
        return undefined
      }
      return ctx.apiClientInstance.convertSdkToolCallToMcpToolResponse(toolCall, mcpTool)
    })
    .filter((t): t is ToolCallResponse => typeof t !== 'undefined')

  if (mcpToolResponses.length === 0) {
    console.warn(`🔧 [${MIDDLEWARE_NAME}] No valid MCP tool responses to execute`)
    return { toolResults: [], confirmedToolCalls: [] }
  }

  // 使用现有的parseAndCallTools函数执行工具
  const { toolResults, confirmedToolResponses } = await parseAndCallTools(
    mcpToolResponses,
    allToolResponses,
    onChunk,
    (mcpToolResponse, resp, model) => {
      return ctx.apiClientInstance.convertMcpToolResponseToSdkMessageParam(mcpToolResponse, resp, model)
    },
    model,
    mcpTools,
    ctx._internal?.flowControl?.abortSignal
  )

  // 找出已确认工具对应的原始toolCalls
  const confirmedToolCalls = toolCalls.filter((toolCall) => {
    return confirmedToolResponses.find((confirmed) => {
      // 根据不同的ID字段匹配原始toolCall
      return (
        ('name' in toolCall &&
          (toolCall.name?.includes(confirmed.tool.name) || toolCall.name?.includes(confirmed.tool.id))) ||
        confirmed.tool.name === toolCall.id ||
        confirmed.tool.id === toolCall.id
      )
    })
  })

  return { toolResults, confirmedToolCalls }
}

/**
 * 执行工具使用响应（Tool Use Response 方式）
 * 处理已经解析好的 ToolUseResponse[]，不需要重新解析字符串
 */
async function executeToolUseResponses(
  ctx: CompletionsContext,
  toolUseResponses: MCPToolResponse[],
  mcpTools: MCPTool[],
  allToolResponses: MCPToolResponse[],
  onChunk: CompletionsParams['onChunk'],
  model: Model
): Promise<{ toolResults: SdkMessageParam[] }> {
  // 直接使用parseAndCallTools函数处理已经解析好的ToolUseResponse
  const { toolResults } = await parseAndCallTools(
    toolUseResponses,
    allToolResponses,
    onChunk,
    (mcpToolResponse, resp, model) => {
      return ctx.apiClientInstance.convertMcpToolResponseToSdkMessageParam(mcpToolResponse, resp, model)
    },
    model,
    mcpTools,
    ctx._internal?.flowControl?.abortSignal
  )

  return { toolResults }
}

/**
 * 构建包含工具结果的新参数
 */
function buildParamsWithToolResults(
  ctx: CompletionsContext,
  currentParams: CompletionsParams,
  output: SdkRawOutput | string | undefined,
  toolResults: SdkMessageParam[],
  confirmedToolCalls: SdkToolCall[]
): CompletionsParams {
  // 获取当前已经转换好的reqMessages，如果没有则使用原始messages
  const currentReqMessages = getCurrentReqMessages(ctx)

  const apiClient = ctx.apiClientInstance

  // 从回复中构建助手消息
  const newReqMessages = apiClient.buildSdkMessages(currentReqMessages, output, toolResults, confirmedToolCalls)

  if (output && ctx._internal.toolProcessingState) {
    ctx._internal.toolProcessingState.output = undefined
  }

  // 估算新增消息的 token 消耗并累加到 usage 中
  if (ctx._internal.observer?.usage && newReqMessages.length > currentReqMessages.length) {
    try {
      const newMessages = newReqMessages.slice(currentReqMessages.length)
      const additionalTokens = newMessages.reduce((acc, message) => {
        return acc + ctx.apiClientInstance.estimateMessageTokens(message)
      }, 0)

      if (additionalTokens > 0) {
        ctx._internal.observer.usage.prompt_tokens += additionalTokens
        ctx._internal.observer.usage.total_tokens += additionalTokens
      }
    } catch (error) {
      Logger.error(`🔧 [${MIDDLEWARE_NAME}] Error estimating token usage for new messages:`, error)
    }
  }

  // 更新递归状态
  if (!ctx._internal.toolProcessingState) {
    ctx._internal.toolProcessingState = {}
  }
  ctx._internal.toolProcessingState.isRecursiveCall = true
  ctx._internal.toolProcessingState.recursionDepth = (ctx._internal.toolProcessingState?.recursionDepth || 0) + 1

  return {
    ...currentParams,
    _internal: {
      ...ctx._internal,
      sdkPayload: ctx._internal.sdkPayload,
      newReqMessages: newReqMessages
    }
  }
}

/**
 * 类型安全地获取当前请求消息
 * 使用API客户端提供的抽象方法，保持中间件的provider无关性
 */
function getCurrentReqMessages(ctx: CompletionsContext): SdkMessageParam[] {
  const sdkPayload = ctx._internal.sdkPayload
  if (!sdkPayload) {
    return []
  }

  // 使用API客户端的抽象方法来提取消息，保持provider无关性
  return ctx.apiClientInstance.extractMessagesFromSdkPayload(sdkPayload)
}

export default McpToolChunkMiddleware
