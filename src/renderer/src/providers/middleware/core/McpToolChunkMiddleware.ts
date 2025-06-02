import Logger from '@renderer/config/logger'
import { MCPTool, MCPToolResponse, Model, ToolCallResponse } from '@renderer/types'
import { ChunkType, MCPToolCreatedChunk } from '@renderer/types/chunk'
import { SdkMessage, SdkToolCall } from '@renderer/types/sdk'
import { parseAndCallTools } from '@renderer/utils/mcp-tools'
import { ChatCompletionMessageParam } from 'openai/resources'

import { CompletionsParams, CompletionsResult, GenericChunk } from '../schemas'
import { CompletionsContext, CompletionsMiddleware } from '../type'

const MIDDLEWARE_NAME = 'McpToolChunkMiddleware'
const MAX_TOOL_RECURSION_DEPTH = 20 // 防止无限递归

/**
 * MCP工具处理中间件
 *
 * 职责：
 * 1. 检测并拦截MCP工具进展chunk
 * 2. 执行工具调用（Function Call和Prompt方式）
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
        const enhancedCompletions = ctx._internal.customState?.enhancedCompletions
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
  const toolResponses: MCPToolResponse[] = []
  let assistantContent = ''
  let hasToolCalls = false
  let streamEnded = false

  return new TransformStream({
    async transform(chunk: GenericChunk, controller) {
      try {
        // 处理MCP工具进展chunk
        if (chunk.type === ChunkType.MCP_TOOL_CREATED) {
          const createdChunk = chunk as MCPToolCreatedChunk
          toolCalls.push(...createdChunk.tool_calls)
          hasToolCalls = true
          console.log(
            `🔧 [${MIDDLEWARE_NAME}][DEBUG] Intercepted ${createdChunk.tool_calls.length} tool calls, total: ${toolCalls.length}`
          )
          // 不转发MCP工具进展chunks，避免重复处理
          console.log(`🔧 [${MIDDLEWARE_NAME}] Intercepting MCP tool progress chunk to prevent duplicate processing`)
          return
        }

        // 收集助手的文本内容
        if (chunk.type === ChunkType.TEXT_DELTA) {
          assistantContent += chunk.text || ''
        }
        controller.enqueue(chunk)
      } catch (error) {
        console.error(`🔧 [${MIDDLEWARE_NAME}] Error processing chunk:`, error)
        controller.error(error)
      }
    },

    async flush(controller) {
      console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Transform stream flushing at depth ${depth}`)
      console.log(
        `🔧 [${MIDDLEWARE_NAME}][DEBUG] hasToolCalls: ${hasToolCalls}, toolCalls.length: ${toolCalls.length}, assistantContent.length: ${assistantContent.length}`
      )

      const shouldProcessTools = (hasToolCalls && toolCalls.length > 0) || assistantContent.length > 0

      if (!streamEnded && shouldProcessTools) {
        streamEnded = true
        console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Starting tool processing at depth ${depth}`)

        try {
          let toolResult: Array<SdkMessage> = []

          if (toolCalls.length > 0) {
            console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Executing ${toolCalls.length} function calls`)
            toolResult = await executeToolCalls(
              ctx,
              toolCalls,
              mcpTools,
              toolResponses,
              currentParams.onChunk,
              currentParams.model
            )
            console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Function calls completed, got ${toolResult.length} results`)
          } else if (assistantContent.length > 0) {
            console.log(
              `🔧 [${MIDDLEWARE_NAME}][DEBUG] Executing tool uses from ${assistantContent.length} chars of content`
            )
            toolResult = await executeToolUses(
              ctx,
              assistantContent,
              mcpTools,
              toolResponses,
              currentParams.onChunk,
              currentParams.model
            )
            console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Tool uses completed, got ${toolResult.length} results`)
          }

          if (toolResult.length > 0) {
            console.log(
              `🔧 [${MIDDLEWARE_NAME}][DEBUG] Building params for recursive call with ${toolResult.length} tool results`
            )
            const newParams = buildParamsWithToolResults(ctx, currentParams, toolResult, assistantContent, toolCalls)
            console.log(
              `🔧 [${MIDDLEWARE_NAME}][DEBUG] Starting recursive tool call from depth ${depth} to ${depth + 1}`
            )
            await executeWithToolHandling(newParams, depth + 1)
          } else {
            console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] No tool results to process, skipping recursion`)
          }
        } catch (error) {
          console.error(`🔧 [${MIDDLEWARE_NAME}] Error in tool processing:`, error)
          controller.error(error)
        }
      } else {
        console.log(
          `🔧 [${MIDDLEWARE_NAME}][DEBUG] Skipping tool processing - streamEnded: ${streamEnded}, shouldProcessTools: ${shouldProcessTools}`
        )
      }

      console.log(`🔧 [${MIDDLEWARE_NAME}] Transform stream flushed at depth ${depth}`)
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
): Promise<SdkMessage[]> {
  console.log(`🔧 [${MIDDLEWARE_NAME}] Executing ${toolCalls.length} tools`)
  console.log(
    `🔧 [${MIDDLEWARE_NAME}][DEBUG] Tool calls:`,
    toolCalls.map((tc) => `${tc.function.name}(${tc.id})`).join(', ')
  )

  // 转换为MCPToolResponse格式
  const mcpToolResponses: ToolCallResponse[] = toolCalls
    .map((toolCall) => {
      console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Converting tool call: ${toolCall.function.name}`)
      const mcpTool = ctx.apiClientInstance.convertSdkToolCallToMcp(toolCall, mcpTools)
      if (!mcpTool) {
        console.warn(`🔧 [${MIDDLEWARE_NAME}] MCP tool not found for: ${toolCall.function.name}`)
        return undefined
      }

      let parsedArgs: any
      try {
        parsedArgs = JSON.parse(toolCall.function.arguments)
        console.log(
          `🔧 [${MIDDLEWARE_NAME}][DEBUG] Parsed arguments for ${toolCall.function.name}:`,
          Object.keys(parsedArgs)
        )
      } catch {
        parsedArgs = toolCall.function.arguments
        console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Using raw arguments for ${toolCall.function.name}`)
      }

      return {
        id: toolCall.id,
        toolCallId: toolCall.id,
        tool: mcpTool,
        arguments: parsedArgs,
        status: 'pending'
      } as ToolCallResponse
    })
    .filter((t): t is ToolCallResponse => typeof t !== 'undefined')

  console.log(
    `🔧 [${MIDDLEWARE_NAME}][DEBUG] Successfully converted ${mcpToolResponses.length}/${toolCalls.length} tool calls`
  )

  if (mcpToolResponses.length === 0) {
    console.warn(`🔧 [${MIDDLEWARE_NAME}] No valid MCP tool responses to execute`)
    return []
  }

  // 使用现有的parseAndCallTools函数执行工具
  console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Calling parseAndCallTools with ${mcpToolResponses.length} responses`)
  const toolResults = await parseAndCallTools(
    mcpToolResponses,
    allToolResponses,
    onChunk,
    (mcpToolResponse, resp, model) => {
      console.log(
        `🔧 [${MIDDLEWARE_NAME}][DEBUG] Converting MCP response to SDK message for tool: ${mcpToolResponse.tool?.name}`
      )
      return ctx.apiClientInstance.convertMcpToolResponseToSdkMessage(mcpToolResponse, resp, model)
    },
    model,
    mcpTools
  )

  console.log(`🔧 [${MIDDLEWARE_NAME}] Tool execution completed, ${toolResults.length} results`)
  console.log(
    `🔧 [${MIDDLEWARE_NAME}][DEBUG] Tool results types:`,
    toolResults.map((r: any) => r.role || r.type || 'unknown').join(', ')
  )
  return toolResults
}

/**
 * 执行工具调用（Prompt 方式）
 */
async function executeToolUses(
  ctx: CompletionsContext,
  content: string,
  mcpTools: MCPTool[],
  allToolResponses: MCPToolResponse[],
  onChunk: CompletionsParams['onChunk'],
  model: Model
): Promise<SdkMessage[]> {
  console.log(`🔧 [${MIDDLEWARE_NAME}] Executing tool uses from content:`, content.substring(0, 200) + '...')
  console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Available tools:`, mcpTools.map((t) => t.name).join(', '))

  // 使用现有的parseAndCallTools函数处理prompt中的工具使用
  console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Calling parseAndCallTools with content-based tool parsing`)
  const toolResults = await parseAndCallTools(
    content,
    allToolResponses,
    onChunk,
    (mcpToolResponse, resp, model) => {
      console.log(
        `🔧 [${MIDDLEWARE_NAME}][DEBUG] Converting MCP response to SDK message for tool: ${mcpToolResponse.tool?.name}`
      )
      return ctx.apiClientInstance.convertMcpToolResponseToSdkMessage(mcpToolResponse, resp, model)
    },
    model,
    mcpTools
  )

  console.log(`🔧 [${MIDDLEWARE_NAME}] Tool uses execution completed, ${toolResults.length} results`)
  console.log(
    `🔧 [${MIDDLEWARE_NAME}][DEBUG] Tool results types:`,
    toolResults.map((r: any) => r.role || r.type || 'unknown').join(', ')
  )
  return toolResults as ChatCompletionMessageParam[]
}

/**
 * 构建包含工具结果的新参数
 */
function buildParamsWithToolResults(
  ctx: CompletionsContext,
  currentParams: CompletionsParams,
  toolResults: SdkMessage[],
  assistantContent: string,
  toolCalls: SdkToolCall[]
): CompletionsParams {
  // 获取当前已经转换好的reqMessages，如果没有则使用原始messages
  const currentReqMessages = ctx._internal.sdkPayload?.messages || []
  console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Current messages count: ${currentReqMessages.length}`)

  const apiClient = ctx.apiClientInstance

  const newReqMessages = apiClient.buildSdkMessages(currentReqMessages, assistantContent, toolCalls, toolResults)

  console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] New messages array length: ${newReqMessages.length}`)
  console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Message roles:`, newReqMessages.map((m) => m.role).join(' -> '))

  // 更新递归状态
  if (!ctx._internal.toolProcessingState) {
    ctx._internal.toolProcessingState = {}
  }
  ctx._internal.toolProcessingState.isRecursiveCall = true
  ctx._internal.toolProcessingState.recursionDepth = (ctx._internal.toolProcessingState?.recursionDepth || 0) + 1

  console.log(
    `🔧 [${MIDDLEWARE_NAME}][DEBUG] Updated recursion state - depth: ${ctx._internal.toolProcessingState.recursionDepth}`
  )

  return {
    ...currentParams,
    _internal: {
      ...ctx._internal,
      sdkPayload: {
        ...ctx._internal.sdkPayload!,
        messages: newReqMessages
      }
    }
  }
}

export default McpToolChunkMiddleware
