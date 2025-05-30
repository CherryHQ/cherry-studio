import { isVisionModel } from '@renderer/config/models'
import { MCPTool, MCPToolResponse, ToolCallResponse } from '@renderer/types'
import { ChunkType, MCPToolInProgressChunk } from '@renderer/types/chunk'
import {
  mcpToolCallResponseToOpenAICompatibleMessage,
  openAIToolsToMcpTool,
  parseAndCallTools
} from '@renderer/utils/mcp-tools'
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

  // 初始化递归状态（仅在顶层调用时）
  const params = ctx.originalParams
  const internalData = (params as any)._internal
  const isRecursiveCall = internalData?.isRecursiveCall || false
  const recursionDepth = internalData?.recursionDepth || 0

  if (!isRecursiveCall) {
    console.log(`🔧 [${MIDDLEWARE_NAME}] Top-level call, initializing recursion state`)
    // 保存增强后的completions函数用于递归调用
    if (!ctx._internal.customState) {
      ctx._internal.customState = {}
    }
    // 增强后的completions方法已经在composer中保存到context
    console.log(
      `🔧 [${MIDDLEWARE_NAME}] Enhanced completions method available:`,
      !!ctx._internal.customState?.enhancedCompletions
    )
  }

  console.log(`🔧 [${MIDDLEWARE_NAME}] Processing at depth ${recursionDepth}, isRecursive: ${isRecursiveCall}`)

  // 调用下游中间件
  await next()

  // 响应后处理：处理MCP工具调用
  if (ctx._internal.apiCall && ctx._internal.apiCall.genericChunkStream) {
    const resultFromUpstream = ctx._internal.apiCall.genericChunkStream

    console.log(`🔧 [${MIDDLEWARE_NAME}] Processing result from upstream, has stream: ${!!resultFromUpstream}`)

    if (resultFromUpstream && resultFromUpstream instanceof ReadableStream) {
      // 防止无限递归
      if (recursionDepth >= MAX_TOOL_RECURSION_DEPTH) {
        console.error(`🔧 [${MIDDLEWARE_NAME}] Maximum recursion depth ${MAX_TOOL_RECURSION_DEPTH} exceeded`)
        throw new Error(`Maximum tool recursion depth ${MAX_TOOL_RECURSION_DEPTH} exceeded`)
      }

      const enhancedToolStream = resultFromUpstream.pipeThrough(
        createToolHandlingTransform(ctx, mcpTools, recursionDepth)
      )

      // 更新响应结果
      ctx._internal.apiCall.genericChunkStream = enhancedToolStream
    } else {
      console.log(`🔧 [${MIDDLEWARE_NAME}] No stream to process or not a ReadableStream`)
    }
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
  const toolCalls: ChatCompletionMessageToolCall[] = []
  const toolResponses: MCPToolResponse[] = []
  let assistantContent = ''
  let hasToolCalls = false
  let streamEnded = false

  const params = ctx.originalParams

  return new TransformStream({
    async transform(chunk, controller) {
      try {
        // 处理MCP工具进展chunk
        if (chunk.type === ChunkType.MCP_TOOL_IN_PROGRESS) {
          const inProgressChunk = chunk as MCPToolInProgressChunk
          for (const response of inProgressChunk.responses) {
            if (response.id && response.tool && response.arguments) {
              // 转换为 ChatCompletionMessageToolCall 格式
              const toolCall: ChatCompletionMessageToolCall = {
                id: response.id,
                type: 'function',
                function: {
                  name: response.tool.name,
                  arguments:
                    typeof response.arguments === 'string' ? response.arguments : JSON.stringify(response.arguments)
                }
              }
              toolCalls.push(toolCall)
              hasToolCalls = true
              console.log(`🔧 [${MIDDLEWARE_NAME}] ✅ Detected tool call from MCP chunk:`, response.tool.name)
            }
          }
          // 不转发MCP工具进展chunks，避免重复处理
          console.log(`🔧 [${MIDDLEWARE_NAME}] Intercepting MCP tool progress chunk to prevent duplicate processing`)
          return
        }

        // 收集助手的文本内容
        if (chunk.type === ChunkType.TEXT_DELTA) {
          assistantContent += chunk.text || ''
        }

        // 处理流结束信号
        if (chunk.type === ChunkType.LLM_RESPONSE_COMPLETE) {
          const shouldProcessTools = (hasToolCalls && toolCalls.length > 0) || assistantContent.length > 0

          console.log(`🔧 [${MIDDLEWARE_NAME}] Stream end detected:`, {
            shouldProcessTools,
            hasToolCalls,
            toolCallsLength: toolCalls.length,
            contentLength: assistantContent.length,
            depth,
            streamEnded
          })

          if (!streamEnded && shouldProcessTools) {
            streamEnded = true
            console.log(
              `🔧 [${MIDDLEWARE_NAME}] ⚡ Processing tools. ToolCalls: ${toolCalls.length}, Content length: ${assistantContent.length}`
            )

            // 1. 执行工具调用
            let toolResults: ChatCompletionMessageParam[] = []

            // Function Call 方式
            if (toolCalls.length > 0) {
              const functionCallResults = await executeToolCalls(
                toolCalls,
                mcpTools,
                toolResponses,
                params.onChunk,
                params.assistant.model!
              )
              toolResults = toolResults.concat(functionCallResults)
            }

            // Prompt 方式
            if (assistantContent.length > 0) {
              const promptToolResults = await executeToolUses(
                assistantContent,
                mcpTools,
                toolResponses,
                params.onChunk,
                params.assistant.model!
              )
              toolResults = toolResults.concat(promptToolResults)
            }

            // 2. 递归处理工具结果
            if (toolResults.length > 0) {
              console.log(`🔧 [${MIDDLEWARE_NAME}] Found ${toolResults.length} tool results, starting recursion`)

              // 构建新的参数
              const newParams = buildParamsWithToolResults(params, toolResults, assistantContent, toolCalls)

              // 获取增强后的completions函数
              const enhancedCompletions = ctx._internal.customState?.enhancedCompletions
              if (!enhancedCompletions) {
                console.error(`🔧 [${MIDDLEWARE_NAME}] Enhanced completions method not found`)
                throw new Error('Enhanced completions method not found for recursive tool call')
              }

              // 递归调用
              console.log(`🔧 [${MIDDLEWARE_NAME}] Recursively calling at depth ${depth + 1}`)

              try {
                const recursiveResult = await enhancedCompletions(newParams)

                // 如果递归调用有流结果，将其内容转发到当前流
                if (recursiveResult?.stream && recursiveResult.stream instanceof ReadableStream) {
                  const reader = recursiveResult.stream.getReader()

                  try {
                    while (true) {
                      const { done, value } = await reader.read()
                      if (done) break

                      // 转发递归调用的chunks
                      controller.enqueue(value)
                    }
                  } finally {
                    reader.releaseLock()
                  }
                }
              } catch (error) {
                console.error(`🔧 [${MIDDLEWARE_NAME}] Recursive call failed:`, error)
                // 发送错误chunk
                controller.enqueue({
                  type: ChunkType.ERROR,
                  error: {
                    message: error instanceof Error ? error.message : 'Unknown error in recursive tool processing',
                    code: 'TOOL_RECURSION_ERROR'
                  }
                } as GenericChunk)
              }
            }
          }
        }

        // 转发其他chunks
        controller.enqueue(chunk)
      } catch (error) {
        console.error(`🔧 [${MIDDLEWARE_NAME}] Error processing chunk:`, error)
        controller.error(error)
      }
    },

    flush() {
      console.log(`🔧 [${MIDDLEWARE_NAME}] Transform stream flushed at depth ${depth}`)
    }
  })
}

/**
 * 执行工具调用（Function Call 方式）
 */
async function executeToolCalls(
  toolCalls: ChatCompletionMessageToolCall[],
  mcpTools: MCPTool[],
  allToolResponses: MCPToolResponse[],
  onChunk: CompletionsParams['onChunk'],
  model: any
): Promise<ChatCompletionMessageParam[]> {
  console.log(`🔧 [${MIDDLEWARE_NAME}] Executing ${toolCalls.length} tools`)

  // 转换为MCPToolResponse格式
  const mcpToolResponses: ToolCallResponse[] = toolCalls
    .map((toolCall) => {
      const mcpTool = openAIToolsToMcpTool(mcpTools, toolCall)
      if (!mcpTool) {
        console.warn(`🔧 [${MIDDLEWARE_NAME}] MCP tool not found for: ${toolCall.function.name}`)
        return undefined
      }

      let parsedArgs: any
      try {
        parsedArgs = JSON.parse(toolCall.function.arguments)
      } catch {
        parsedArgs = toolCall.function.arguments
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

  if (mcpToolResponses.length === 0) {
    console.warn(`🔧 [${MIDDLEWARE_NAME}] No valid MCP tool responses to execute`)
    return []
  }

  // 使用现有的parseAndCallTools函数执行工具
  const toolResults = await parseAndCallTools(
    mcpToolResponses,
    allToolResponses,
    onChunk,
    (mcpToolResponse, resp, model) => {
      return mcpToolCallResponseToOpenAICompatibleMessage(mcpToolResponse, resp, isVisionModel(model))
    },
    model,
    mcpTools
  )

  console.log(`🔧 [${MIDDLEWARE_NAME}] Tool execution completed, ${toolResults.length} results`)
  return toolResults as ChatCompletionMessageParam[]
}

/**
 * 执行工具调用（Prompt 方式）
 */
async function executeToolUses(
  content: string,
  mcpTools: MCPTool[],
  allToolResponses: MCPToolResponse[],
  onChunk: CompletionsParams['onChunk'],
  model: any
): Promise<ChatCompletionMessageParam[]> {
  console.log(`🔧 [${MIDDLEWARE_NAME}] Executing tool uses from content:`, content.substring(0, 200) + '...')

  // 使用现有的parseAndCallTools函数处理prompt中的工具使用
  const toolResults = await parseAndCallTools(
    content,
    allToolResponses,
    onChunk,
    (mcpToolResponse, resp, model) => {
      return mcpToolCallResponseToOpenAICompatibleMessage(mcpToolResponse, resp, isVisionModel(model))
    },
    model,
    mcpTools
  )

  console.log(`🔧 [${MIDDLEWARE_NAME}] Tool uses execution completed, ${toolResults.length} results`)
  return toolResults as ChatCompletionMessageParam[]
}

/**
 * 构建包含工具结果的新参数
 */
function buildParamsWithToolResults(
  originalParams: CompletionsParams,
  toolResults: ChatCompletionMessageParam[],
  assistantContent: string,
  toolCalls: ChatCompletionMessageToolCall[]
): CompletionsParams {
  console.log(`🔧 [${MIDDLEWARE_NAME}] Building new params with ${toolResults.length} tool results`)

  // 获取当前已经转换好的reqMessages，如果没有则使用原始messages
  const currentReqMessages = (originalParams as any)._internal?.sdkParams?.reqMessages || []

  // 构建新的reqMessages数组（使用SDK格式）
  const newReqMessages: ChatCompletionMessageParam[] = [
    ...currentReqMessages,
    // 添加助手的回复（包含工具调用）
    {
      role: 'assistant',
      content: assistantContent,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.function.name,
          arguments:
            typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments)
        }
      }))
    },
    // 添加工具执行结果
    ...toolResults
  ]

  return {
    ...originalParams,
    _internal: {
      ...(originalParams as any)._internal,
      isRecursiveCall: true,
      recursionDepth: ((originalParams as any)._internal?.recursionDepth || 0) + 1,
      sdkParams: {
        ...(originalParams as any)._internal?.sdkParams,
        reqMessages: newReqMessages
      }
    }
  } as CompletionsParams
}

export default McpToolChunkMiddleware
