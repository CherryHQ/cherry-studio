import Logger from '@renderer/config/logger'
import { MCPTool, MCPToolResponse, Model, ToolCallResponse } from '@renderer/types'
import { ChunkType, MCPToolCreatedChunk } from '@renderer/types/chunk'
import { SdkMessageParam, SdkToolCall } from '@renderer/types/sdk'
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
      Logger.info(`🔧 [${MIDDLEWARE_NAME}] No MCP tools available, skipping`)
      return next(ctx, params)
    }

    Logger.debug(`🔧 [${MIDDLEWARE_NAME}] Starting tool handling with ${mcpTools.length} tools`)

    const executeWithToolHandling = async (currentParams: CompletionsParams, depth = 0): Promise<CompletionsResult> => {
      Logger.debug(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Current recursion depth: ${depth}`)
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
  let assistantMessage: SdkMessageParam | null = null
  let assistantMessageContent: string | null = null
  let hasToolCalls = false
  let hasToolUseResponses = false
  let streamEnded = false

  return new TransformStream({
    async transform(chunk: GenericChunk, controller) {
      try {
        // 处理MCP工具进展chunk
        if (chunk.type === ChunkType.MCP_TOOL_CREATED) {
          const createdChunk = chunk as MCPToolCreatedChunk

          // 1. 处理Function Call方式的工具调用
          if (createdChunk.tool_calls && createdChunk.tool_calls.length > 0) {
            toolCalls.push(...createdChunk.tool_calls)
            hasToolCalls = true
            Logger.debug(
              `🔧 [${MIDDLEWARE_NAME}][DEBUG] Intercepted ${createdChunk.tool_calls.length} tool calls, total: ${toolCalls.length}`
            )
          }

          // 2. 处理Tool Use方式的工具调用
          if (createdChunk.tool_use_responses && createdChunk.tool_use_responses.length > 0) {
            toolUseResponses.push(...createdChunk.tool_use_responses)
            hasToolUseResponses = true
            Logger.debug(
              `🔧 [${MIDDLEWARE_NAME}][DEBUG] Intercepted ${createdChunk.tool_use_responses.length} tool use responses, total: ${toolUseResponses.length}`
            )
          }

          // 不转发MCP工具进展chunks，避免重复处理
          Logger.debug(`🔧 [${MIDDLEWARE_NAME}] Intercepting MCP tool progress chunk to prevent duplicate processing`)
          return
        }
        // 处理 OpenAI 的 assistantMessageContent
        if (chunk.type === ChunkType.TEXT_DELTA) {
          assistantMessageContent += chunk.text
        }

        // 转发其他所有chunk
        controller.enqueue(chunk)
      } catch (error) {
        console.error(`🔧 [${MIDDLEWARE_NAME}] Error processing chunk:`, error)
        controller.error(error)
      }
    },

    async flush(controller) {
      Logger.debug(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Transform stream flushing at depth ${depth}`)
      Logger.debug(
        `🔧 [${MIDDLEWARE_NAME}][DEBUG] hasToolCalls: ${hasToolCalls}, toolCalls.length: ${toolCalls.length}`
      )
      Logger.debug(
        `🔧 [${MIDDLEWARE_NAME}][DEBUG] hasToolUseResponses: ${hasToolUseResponses}, toolUseResponses.length: ${toolUseResponses.length}`
      )

      const shouldExecuteToolCalls = hasToolCalls && toolCalls.length > 0
      const shouldExecuteToolUseResponses = hasToolUseResponses && toolUseResponses.length > 0

      if (!streamEnded && (shouldExecuteToolCalls || shouldExecuteToolUseResponses)) {
        streamEnded = true
        Logger.debug(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Starting tool processing at depth ${depth}`)

        try {
          let toolResult: SdkMessageParam[] = []

          if (shouldExecuteToolCalls) {
            Logger.debug(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Executing ${toolCalls.length} function calls`)
            toolResult = await executeToolCalls(
              ctx,
              toolCalls,
              mcpTools,
              allToolResponses,
              currentParams.onChunk,
              currentParams.model
            )
            Logger.debug(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Function calls completed, got ${toolResult.length} results`)
          } else if (shouldExecuteToolUseResponses) {
            Logger.debug(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Executing ${toolUseResponses.length} tool use responses`)
            toolResult = await executeToolUseResponses(
              ctx,
              toolUseResponses,
              mcpTools,
              allToolResponses,
              currentParams.onChunk,
              currentParams.model
            )
            Logger.debug(
              `🔧 [${MIDDLEWARE_NAME}][DEBUG] Tool use responses completed, got ${toolResult.length} results`
            )
          }

          if (toolResult.length > 0) {
            Logger.debug(
              `🔧 [${MIDDLEWARE_NAME}][DEBUG] Building params for recursive call with ${toolResult.length} tool results`
            )
            console.log('assistantMessageContent', assistantMessageContent)
            console.log(
              'ctx._internal.toolProcessingState?.assistantMessage',
              ctx._internal.toolProcessingState?.assistantMessage
            )
            // anthropic 的 assistantMessage 在 RawStreamListenerMiddleware 中设置
            if (ctx._internal.toolProcessingState?.assistantMessage) {
              assistantMessage = ctx._internal.toolProcessingState.assistantMessage
            } else if (assistantMessageContent) {
              assistantMessage = {
                role: 'assistant',
                content: assistantMessageContent
              } as SdkMessageParam
            }

            const newParams = buildParamsWithToolResults(ctx, currentParams, toolResult, assistantMessage!, toolCalls)
            Logger.debug(
              `🔧 [${MIDDLEWARE_NAME}][DEBUG] Starting recursive tool call from depth ${depth} to ${depth + 1}`
            )
            await executeWithToolHandling(newParams, depth + 1)
          } else {
            Logger.debug(`🔧 [${MIDDLEWARE_NAME}][DEBUG] No tool results to process, skipping recursion`)
          }
        } catch (error) {
          console.error(`🔧 [${MIDDLEWARE_NAME}] Error in tool processing:`, error)
          controller.error(error)
        } finally {
          assistantMessage = null
          hasToolCalls = false
          hasToolUseResponses = false
        }
      } else {
        Logger.debug(
          `🔧 [${MIDDLEWARE_NAME}][DEBUG] Skipping tool processing - streamEnded: ${streamEnded}, shouldExecuteToolCalls: ${shouldExecuteToolCalls}, shouldExecuteToolUseResponses: ${shouldExecuteToolUseResponses}`
        )
      }

      Logger.debug(`🔧 [${MIDDLEWARE_NAME}] Transform stream flushed at depth ${depth}`)
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
): Promise<SdkMessageParam[]> {
  Logger.debug(`🔧 [${MIDDLEWARE_NAME}] Executing ${toolCalls.length} tools`)

  // 转换为MCPToolResponse格式
  const mcpToolResponses: ToolCallResponse[] = toolCalls
    .map((toolCall) => {
      const mcpTool = ctx.apiClientInstance.convertSdkToolCallToMcp(toolCall, mcpTools)
      if (!mcpTool) {
        return undefined
      }
      return ctx.apiClientInstance.convertSdkToolCallToMcpToolResponse(toolCall, mcpTool)
    })
    .filter((t): t is ToolCallResponse => typeof t !== 'undefined')

  Logger.debug(
    `🔧 [${MIDDLEWARE_NAME}][DEBUG] Successfully converted ${mcpToolResponses.length}/${toolCalls.length} tool calls`
  )

  if (mcpToolResponses.length === 0) {
    console.warn(`🔧 [${MIDDLEWARE_NAME}] No valid MCP tool responses to execute`)
    return []
  }

  // 使用现有的parseAndCallTools函数执行工具
  Logger.debug(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Calling parseAndCallTools with ${mcpToolResponses.length} responses`)
  const toolResults = await parseAndCallTools(
    mcpToolResponses,
    allToolResponses,
    onChunk,
    (mcpToolResponse, resp, model) => {
      Logger.debug(
        `🔧 [${MIDDLEWARE_NAME}][DEBUG] Converting MCP response to SDK message for tool: ${mcpToolResponse.tool?.name}`
      )
      return ctx.apiClientInstance.convertMcpToolResponseToSdkMessageParam(mcpToolResponse, resp, model)
    },
    model,
    mcpTools
  )

  Logger.debug(`🔧 [${MIDDLEWARE_NAME}] Tool execution completed, ${toolResults.length} results`)
  Logger.debug(
    `🔧 [${MIDDLEWARE_NAME}][DEBUG] Tool results types:`,
    toolResults.map((r: any) => r.role || r.type || 'unknown').join(', ')
  )
  return toolResults
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
): Promise<SdkMessageParam[]> {
  Logger.debug(`🔧 [${MIDDLEWARE_NAME}] Executing ${toolUseResponses.length} tool use responses`)
  Logger.debug(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Available tools:`, mcpTools.map((t) => t.name).join(', '))

  // 直接使用parseAndCallTools函数处理已经解析好的ToolUseResponse
  Logger.debug(
    `🔧 [${MIDDLEWARE_NAME}][DEBUG] Calling parseAndCallTools with ${toolUseResponses.length} tool use responses`
  )
  const toolResults = await parseAndCallTools(
    toolUseResponses,
    allToolResponses,
    onChunk,
    (mcpToolResponse, resp, model) => {
      Logger.debug(
        `🔧 [${MIDDLEWARE_NAME}][DEBUG] Converting MCP response to SDK message for tool: ${mcpToolResponse.tool?.name}`
      )
      return ctx.apiClientInstance.convertMcpToolResponseToSdkMessageParam(mcpToolResponse, resp, model)
    },
    model,
    mcpTools
  )

  Logger.debug(`🔧 [${MIDDLEWARE_NAME}] Tool use responses execution completed, ${toolResults.length} results`)
  Logger.debug(
    `🔧 [${MIDDLEWARE_NAME}][DEBUG] Tool results types:`,
    toolResults.map((r: any) => r.role || r.type || 'unknown').join(', ')
  )
  return toolResults
}

/**
 * 构建包含工具结果的新参数
 */
function buildParamsWithToolResults(
  ctx: CompletionsContext,
  currentParams: CompletionsParams,
  toolResults: SdkMessageParam[],
  assistantMessage: SdkMessageParam,
  toolCalls: SdkToolCall[]
): CompletionsParams {
  // 获取当前已经转换好的reqMessages，如果没有则使用原始messages
  const currentReqMessages = ctx._internal.sdkPayload?.messages || []
  Logger.debug(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Current messages count: ${currentReqMessages.length}`)

  const apiClient = ctx.apiClientInstance

  // 从回复中构建助手消息
  const newReqMessages = apiClient.buildSdkMessages(currentReqMessages, toolResults, assistantMessage, toolCalls)

  Logger.debug(`🔧 [${MIDDLEWARE_NAME}][DEBUG] New messages array length: ${newReqMessages.length}`)
  Logger.debug(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Message roles:`, newReqMessages.map((m) => m.role).join(' -> '))

  // 更新递归状态
  if (!ctx._internal.toolProcessingState) {
    ctx._internal.toolProcessingState = {}
  }
  ctx._internal.toolProcessingState.isRecursiveCall = true
  ctx._internal.toolProcessingState.recursionDepth = (ctx._internal.toolProcessingState?.recursionDepth || 0) + 1

  Logger.debug(
    `🔧 [${MIDDLEWARE_NAME}][DEBUG] Updated recursion state - depth: ${ctx._internal.toolProcessingState.recursionDepth}`
  )

  return {
    ...currentParams,
    _internal: {
      ...ctx._internal,
      sdkPayload: ctx._internal.sdkPayload,
      newReqMessages: newReqMessages
    }
  }
}

export default McpToolChunkMiddleware
