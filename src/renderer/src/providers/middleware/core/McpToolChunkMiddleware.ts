import { MCPTool, MCPToolResponse, Model, ToolCallResponse } from '@renderer/types'
import { ChunkType, MCPToolCreatedChunk } from '@renderer/types/chunk'
import { SdkMessage, SdkToolCall } from '@renderer/types/sdk'
import { parseAndCallTools } from '@renderer/utils/mcp-tools'
import { ChatCompletionMessageParam, ChatCompletionMessageToolCall } from 'openai/resources'

import { CompletionsParams, GenericChunk } from '../schemas'
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
export const McpToolChunkMiddleware: CompletionsMiddleware = async (ctx, next) => {
  const mcpTools = ctx.originalParams.mcpTools || []

  // 如果没有工具，直接调用下一个中间件
  if (!mcpTools || mcpTools.length === 0) {
    console.log(`🔧 [${MIDDLEWARE_NAME}] No MCP tools available, skipping`)
    await next()
    return
  }

  console.log(`🔧 [${MIDDLEWARE_NAME}] Starting tool handling with ${mcpTools.length} tools`)

  // 初始化工具处理状态
  if (!ctx._internal.toolProcessingState) {
    ctx._internal.toolProcessingState = {
      recursionDepth: 0,
      isRecursiveCall: false
    }
    console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Initialized tool processing state`)
  }

  const currentDepth = ctx._internal.toolProcessingState.recursionDepth || 0
  console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Current recursion depth: ${currentDepth}`)

  if (currentDepth >= MAX_TOOL_RECURSION_DEPTH) {
    console.error(`🔧 [${MIDDLEWARE_NAME}] Maximum recursion depth ${MAX_TOOL_RECURSION_DEPTH} exceeded`)
    throw new Error(`Maximum tool recursion depth ${MAX_TOOL_RECURSION_DEPTH} exceeded`)
  }

  // 创建工具处理的 Transform Stream 并应用到流上
  console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Creating tool handling transform stream at depth ${currentDepth}`)
  const toolTransform = createToolHandlingTransform(ctx, mcpTools, currentDepth)

  // 调用下一个中间件获取流
  console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Calling next middleware to get upstream stream`)
  await next()

  // 将工具处理转换应用到现有的流上
  if (ctx._internal.apiCall?.genericChunkStream) {
    console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Applying tool transform to upstream stream`)
    ctx._internal.apiCall.genericChunkStream = ctx._internal.apiCall.genericChunkStream.pipeThrough(toolTransform)
    console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Tool transform pipeline established successfully`)
  } else {
    console.warn(`🔧 [${MIDDLEWARE_NAME}][DEBUG] No upstream stream found to apply transform`)
  }
}

/**
 * 创建工具处理的 TransformStream
 */
function createToolHandlingTransform(
  ctx: CompletionsContext,
  mcpTools: MCPTool[],
  depth: number
): TransformStream<GenericChunk, GenericChunk> {
  const toolCalls: SdkToolCall[] = []
  const toolResponses: MCPToolResponse[] = []
  let assistantContent = ''
  let hasToolCalls = false
  let streamEnded = false

  const originalParams = ctx.originalParams

  console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Transform stream created at depth ${depth}`)

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
              originalParams.onChunk,
              originalParams.model
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
              originalParams.onChunk,
              originalParams.model
            )
            console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Tool uses completed, got ${toolResult.length} results`)
          }

          if (toolResult.length > 0) {
            console.log(
              `🔧 [${MIDDLEWARE_NAME}][DEBUG] Building params for recursive call with ${toolResult.length} tool results`
            )
            const newMessages = buildParamsWithToolResults(ctx, toolResult, assistantContent, toolCalls)
            console.log(
              `🔧 [${MIDDLEWARE_NAME}][DEBUG] Starting recursive tool call from depth ${depth} to ${depth + 1}`
            )
            await handleRecursiveToolCall(ctx, newMessages, depth + 1, controller)
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
 * 处理递归工具调用
 */
async function handleRecursiveToolCall(
  ctx: CompletionsContext,
  newSdkMessages: SdkMessage[],
  newDepth: number,
  controller: TransformStreamDefaultController<GenericChunk>
): Promise<void> {
  console.log(`🔧 [${MIDDLEWARE_NAME}] Starting recursive tool call at depth ${newDepth}`)

  // 检查是否有增强的completions方法可供递归调用
  const enhancedCompletions = ctx._internal.customState?.enhancedCompletions
  if (!enhancedCompletions) {
    console.warn(`🔧 [${MIDDLEWARE_NAME}] Enhanced completions method not found, cannot perform recursive call`)
    return
  }

  console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Enhanced completions method found, proceeding with recursive call`)

  try {
    // 更新递归状态
    if (!ctx._internal.toolProcessingState) {
      ctx._internal.toolProcessingState = {}
    }
    ctx._internal.toolProcessingState.isRecursiveCall = true
    ctx._internal.toolProcessingState.recursionDepth = newDepth

    console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Updated recursion state - depth: ${newDepth}`)

    const recursiveParams = {
      ...ctx.originalParams,
      onChunk: (chunk: GenericChunk) => {
        console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Forwarding recursive chunk: ${chunk.type}`)
        try {
          controller.enqueue(chunk)
        } catch (error) {
          console.error(`🔧 [${MIDDLEWARE_NAME}] Error forwarding recursive chunk:`, error)
        }
      }
    }

    console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Starting recursive call with onChunk forwarding: `, recursiveParams)

    await enhancedCompletions(recursiveParams, {
      sdkPayload: {
        messages: newSdkMessages
      },
      toolProcessingState: ctx._internal.toolProcessingState
    })
    console.log(`🔧 [${MIDDLEWARE_NAME}] Recursive call completed at depth ${newDepth}`)
  } catch (error) {
    console.error(`🔧 [${MIDDLEWARE_NAME}] Recursive tool call failed at depth ${newDepth}:`, error)
    console.error(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Error stack:`, (error as Error)?.stack || 'No stack trace')
    controller.error(error)
  }
}

/**
 * 执行工具调用（Function Call 方式）
 */
async function executeToolCalls(
  ctx: CompletionsContext,
  toolCalls: ChatCompletionMessageToolCall[],
  mcpTools: MCPTool[],
  allToolResponses: MCPToolResponse[],
  onChunk: CompletionsParams['onChunk'],
  model: Model
): Promise<ChatCompletionMessageParam[]> {
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
  return toolResults as ChatCompletionMessageParam[]
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
): Promise<ChatCompletionMessageParam[]> {
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
  toolResults: SdkMessage[],
  assistantContent: string,
  toolCalls: SdkToolCall[]
): SdkMessage[] {
  console.log(`🔧 [${MIDDLEWARE_NAME}] Building new params with ${toolResults.length} tool results`)
  console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Assistant content length: ${assistantContent.length}`)
  console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Tool calls count: ${toolCalls.length}`)

  // 获取当前已经转换好的reqMessages，如果没有则使用原始messages
  const currentReqMessages = ctx._internal.sdkPayload?.messages || []
  console.log(`🔧 [${MIDDLEWARE_NAME}][DEBUG] Current messages count: ${currentReqMessages.length}`)

  // 构建新的reqMessages数组（使用SDK格式）
  const newReqMessages: SdkMessage[] = [
    ...currentReqMessages,
    // 添加助手的回复（包含工具调用）
    {
      role: 'assistant',
      content: assistantContent,
      tool_calls: toolCalls
    },
    // 添加工具执行结果
    ...toolResults
  ]

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

  return newReqMessages
}

export default McpToolChunkMiddleware
