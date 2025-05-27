import { isVisionModel } from '@renderer/config/models'
import { MCPTool, MCPToolResponse, ToolCallResponse } from '@renderer/types'
import {
  mcpToolCallResponseToOpenAICompatibleMessage,
  openAIToolsToMcpTool,
  parseAndCallTools
} from '@renderer/utils/mcp-tools'
import { ChatCompletionMessageParam, ChatCompletionMessageToolCall } from 'openai/resources'

import { CompletionsOpenAIResult, CompletionsParams } from '../../AiProvider'
import { AiProviderMiddlewareCompletionsContext, CompletionsMiddleware } from '../middlewareTypes'

const MIDDLEWARE_NAME = 'McpToolChunkMiddleware'
const MAX_TOOL_RECURSION_DEPTH = 20 // 防止无限递归

/**
 * MCP工具处理中间件
 * 负责检测、执行和处理工具调用的递归逻辑
 */
export const McpToolChunkMiddleware: CompletionsMiddleware = () => (next) => async (context, params) => {
  console.log(`🔧 [${MIDDLEWARE_NAME}] Starting tool handling`)

  const mcpTools = context.mcpTools || []

  // 如果没有工具，直接调用下一个中间件
  if (!mcpTools || mcpTools.length === 0) {
    console.log(`🔧 [${MIDDLEWARE_NAME}] No MCP tools available, skipping`)
    return next(context, params)
  }

  // 递归处理工具调用的核心函数
  const executeWithToolHandling = async (
    currentParams: CompletionsParams,
    depth = 0
  ): Promise<CompletionsOpenAIResult> => {
    console.log(`🔧 [${MIDDLEWARE_NAME}] Executing at depth ${depth}`)

    // 防止无限递归
    if (depth >= MAX_TOOL_RECURSION_DEPTH) {
      console.error(`🔧 [${MIDDLEWARE_NAME}] Maximum recursion depth ${MAX_TOOL_RECURSION_DEPTH} exceeded`)
      throw new Error(`Maximum tool recursion depth ${MAX_TOOL_RECURSION_DEPTH} exceeded`)
    }

    // 如果是第一次调用（depth=0），使用正常的中间件链
    // 如果是递归调用（depth>0），使用保存的 enhancedDispatch
    let result: CompletionsOpenAIResult

    if (depth === 0) {
      // 第一次调用，保持 isRecursiveCall = false（或不设置）
      console.log(`🔧 [${MIDDLEWARE_NAME}] Initial call (depth=0), keeping isRecursiveCall = false`)

      // 第一次调用，使用正常的中间件链
      result = await next(context, currentParams)
    } else {
      // 递归调用，使用保存的 enhancedDispatch 来重新执行整个中间件链
      const enhancedDispatch = context._internal?.enhancedDispatch
      if (!enhancedDispatch) {
        throw new Error('Enhanced dispatch function not found in context._internal')
      }

      console.log(`🔧 [${MIDDLEWARE_NAME}] Using enhanced dispatch for recursive call at depth ${depth}`)
      console.log(`🔧 [${MIDDLEWARE_NAME}] Current context state:`, {
        isRecursive: context._internal?.isRecursiveCall,
        depth: context._internal?.recursionDepth
      })

      // 创建新的上下文对象用于递归调用
      context._internal!.isRecursiveCall = true
      context._internal!.recursionDepth = depth

      result = await enhancedDispatch(context, currentParams)
    }

    if (!result.stream) {
      console.log(`🔧 [${MIDDLEWARE_NAME}] No stream in result, returning as-is`)
      return result
    }

    // 使用 TransformStream 来处理工具调用
    const toolHandledStream = (result.stream as ReadableStream<any>).pipeThrough(
      createToolHandlingTransform(context, currentParams, mcpTools, depth, executeWithToolHandling)
    )

    return { ...result, stream: toolHandledStream }
  }

  // 开始执行（深度为0）
  return executeWithToolHandling(params, 0)
}

/**
 * 创建工具处理的 TransformStream
 */
function createToolHandlingTransform(
  context: AiProviderMiddlewareCompletionsContext, // 添加 context 参数
  currentParams: CompletionsParams,
  mcpTools: MCPTool[],
  depth: number,
  executeWithToolHandling: (params: CompletionsParams, depth: number) => Promise<CompletionsOpenAIResult>
): TransformStream<any, any> {
  const toolCalls: ChatCompletionMessageToolCall[] = []
  const toolResponses: MCPToolResponse[] = []
  let assistantContent = ''
  let hasToolCalls = false
  let streamEnded = false

  return new TransformStream({
    async transform(chunk, controller) {
      try {
        if (!context._internal.isRecursiveCall) context._internal.isRecursiveCall = true // 即将进行递归
        context._internal.recursionDepth = depth
        // 检测工具调用相关的chunks
        if (isToolCallChunk(chunk)) {
          const extractedToolCalls = extractToolCallsFromChunk(chunk)
          if (extractedToolCalls.length > 0) {
            toolCalls.push(...extractedToolCalls)
            hasToolCalls = true
            console.log(
              `🔧 [${MIDDLEWARE_NAME}] ✅ Detected ${extractedToolCalls.length} tool calls:`,
              extractedToolCalls.map((tc) => tc.function.name)
            )
          }
          // 不转发原始工具调用chunks，避免重复处理
          console.log(`🔧 [${MIDDLEWARE_NAME}] Intercepting tool call chunk to prevent duplicate processing`)
          return
        }
        // 收集助手的文本内容（从原始 OpenAI chunk 格式中提取）
        if (chunk.choices && chunk.choices[0]?.delta?.content) {
          assistantContent += chunk.choices[0].delta.content
        }

        // 转发非工具调用的chunks给下游
        // console.log(`🔧 [${MIDDLEWARE_NAME}] Forwarding non-tool chunk:`, chunk)
        controller.enqueue(chunk)
      } catch (error) {
        console.error(`🔧 [${MIDDLEWARE_NAME}] Error processing chunk:`, error)
        controller.error(error)
      }
    },

    async flush(controller) {
      try {
        // 按照旧逻辑：只有在有工具调用或内容时才处理
        const shouldProcessTools = (hasToolCalls && toolCalls.length > 0) || assistantContent.length > 0

        console.log(`🔧 [${MIDDLEWARE_NAME}] Stream flush check:`, {
          streamEnded,
          shouldProcessTools,
          hasToolCalls,
          toolCallsLength: toolCalls.length,
          contentLength: assistantContent.length,
          depth
        })

        if (!streamEnded && shouldProcessTools) {
          streamEnded = true
          console.log(
            `🔧 [${MIDDLEWARE_NAME}] ⚡ Stream ended, processing tools. ToolCalls: ${toolCalls.length}, Content length: ${assistantContent.length}`
          )

          // 1. 执行工具调用（完全按照旧逻辑的顺序）
          let toolResults: ChatCompletionMessageParam[] = []
          // Function Call 方式（对应旧逻辑的 processToolCalls）
          if (toolCalls.length > 0) {
            const functionCallResults = await executeToolCalls(
              toolCalls,
              mcpTools,
              toolResponses,
              currentParams.onChunk,
              currentParams.assistant.model!
            )
            toolResults = toolResults.concat(functionCallResults)
          }

          // Prompt 方式（对应旧逻辑的 processToolUses）
          if (assistantContent.length > 0) {
            const promptToolResults = await executeToolUses(
              assistantContent,
              mcpTools,
              toolResponses,
              currentParams.onChunk,
              currentParams.assistant.model!
            )
            toolResults = toolResults.concat(promptToolResults)
          }

          // 2. 只有在有工具结果时才递归（对应旧逻辑的 processToolResults）
          if (toolResults.length > 0) {
            console.log(`🔧 [${MIDDLEWARE_NAME}] Found ${toolResults.length} tool results, starting recursion`)

            // 注意：递归标记已经在transform阶段设置了，这里不需要重复设置
            console.log(`🔧 [${MIDDLEWARE_NAME}] Flush阶段 - Context state:`, context._internal)
            console.log(`🔧 [${MIDDLEWARE_NAME}] 递归标记应该已在transform阶段设置`)

            // 构建包含工具结果的新参数
            const newParams = buildParamsWithToolResults(currentParams, toolResults, assistantContent, toolCalls)

            // 递归调用处理工具结果
            // console.log(`🔧 [${MIDDLEWARE_NAME}] Recursively calling at depth ${depth + 1}`)
            await executeWithToolHandling(newParams, depth + 1)
            // const reader = (result.stream as ReadableStream<any>).getReader()
            // while (true) {
            //   const { value, done } = await reader.read()
            //   if (done) break
            //   controller.enqueue(value) // 推送新流的数据
            // }
            // console.log(`🔧 [${MIDDLEWARE_NAME}] Recursive call completed, result has stream: ${!!nextResult.stream}`)
          } else {
            console.log(`🔧 [${MIDDLEWARE_NAME}] ❌ No tool results found, ending processing`)
          }
        }

        console.log(`🔧 [${MIDDLEWARE_NAME}] Completed processing at depth ${depth}`)

        // 在最外层处理完成时重置递归标记
        console.log(`🔧 [${MIDDLEWARE_NAME}] 🔄 重置递归标记 - 顶层处理完成`)
        context._internal.isRecursiveCall = false
        context._internal.recursionDepth = 0
        console.log(`🔧 [${MIDDLEWARE_NAME}] 递归标记已重置:`, context._internal)
      } catch (error) {
        console.error(`🔧 [${MIDDLEWARE_NAME}] Error in flush at depth ${depth}:`, error)

        // 发送错误chunk
        controller.enqueue({
          type: 'ERROR' as any,
          error: {
            message: error instanceof Error ? error.message : 'Unknown error in tool processing',
            code: 'TOOL_PROCESSING_ERROR'
          }
        })

        controller.error(error)
      }
    }
  })
}

/**
 * 检测chunk是否包含工具调用信息
 * 注意：这里接收的是原始 OpenAI API 返回的 chunk 格式
 */
function isToolCallChunk(chunk: any): boolean {
  // 检查原始 OpenAI chunk 格式中的工具调用
  return !!(chunk.choices && chunk.choices?.[0]?.delta?.tool_calls)
}

/**
 * 从chunk中提取工具调用信息
 * 注意：这里处理的是原始 OpenAI API 返回的 chunk 格式
 */
function extractToolCallsFromChunk(chunk: any): ChatCompletionMessageToolCall[] {
  const toolCalls: ChatCompletionMessageToolCall[] = []

  try {
    // 处理原始 OpenAI API 格式
    if (chunk.choices && chunk.choices?.[0]?.delta?.tool_calls) {
      for (const toolCall of chunk.choices[0].delta.tool_calls) {
        if (toolCall.id && toolCall.function) {
          toolCalls.push({
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.function.name || '',
              arguments: toolCall.function.arguments || ''
            }
          })
        }
      }
    }
  } catch (error) {
    console.error(`🔧 [${MIDDLEWARE_NAME}] Error extracting tool calls:`, error)
  }

  return toolCalls
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
      // 使用现有的转换函数
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
  console.log(
    `🔧 [${MIDDLEWARE_NAME}] Available MCP tools:`,
    mcpTools.map((t) => t.name)
  )

  // 使用现有的parseAndCallTools函数处理prompt中的工具使用
  const toolResults = await parseAndCallTools(
    content,
    allToolResponses,
    onChunk,
    (mcpToolResponse, resp, model) => {
      console.log(`🔧 [${MIDDLEWARE_NAME}] Converting tool response:`, mcpToolResponse.tool.name)
      // 使用现有的转换函数
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
  const currentReqMessages = originalParams._internal?.sdkParams?.reqMessages || []

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
      ...originalParams!._internal,
      sdkParams: {
        ...originalParams!._internal!.sdkParams!,
        reqMessages: newReqMessages
      }
    }
  }
}

export default McpToolChunkMiddleware
