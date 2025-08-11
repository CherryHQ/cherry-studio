import { loggerService } from '@logger'
import { MCPCallToolResponse, MCPTool, MCPToolResponse, Model, ToolCallResponse } from '@renderer/types'
import { ChunkType, MCPToolCreatedChunk } from '@renderer/types/chunk'
import { SdkMessageParam, SdkRawOutput, SdkToolCall } from '@renderer/types/sdk'
import {
  callBuiltInTool,
  callMCPTool,
  getMcpServerByTool,
  isToolAutoApproved,
  parseToolUse,
  upsertMCPToolResponse
} from '@renderer/utils/mcp-tools'
import { confirmSameNameTools, requestToolConfirmation, setToolIdToNameMapping } from '@renderer/utils/userConfirmation'

import { CompletionsParams, CompletionsResult, GenericChunk } from '../schemas'
import { CompletionsContext, CompletionsMiddleware } from '../types'

export const MIDDLEWARE_NAME = 'McpToolChunkMiddleware'
const MAX_TOOL_RECURSION_DEPTH = 20 // 防止无限递归

const logger = loggerService.withContext('McpToolChunkMiddleware')

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
        logger.error(`Maximum recursion depth ${MAX_TOOL_RECURSION_DEPTH} exceeded`)
        throw new Error(`Maximum tool recursion depth ${MAX_TOOL_RECURSION_DEPTH} exceeded`)
      }

      let result: CompletionsResult

      if (depth === 0) {
        result = await next(ctx, currentParams)
      } else {
        const enhancedCompletions = ctx._internal.enhancedDispatch
        if (!enhancedCompletions) {
          logger.error(`Enhanced completions method not found, cannot perform recursive call`)
          throw new Error('Enhanced completions method not found')
        }

        ctx._internal.toolProcessingState!.isRecursiveCall = true
        ctx._internal.toolProcessingState!.recursionDepth = depth

        result = await enhancedCompletions(ctx, currentParams)
      }

      if (!result.stream) {
        logger.error(`No stream returned from enhanced completions`)
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
        logger.silly('chunk', chunk)
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
                    currentParams.assistant.model!,
                    currentParams.topicId
                  )

                  // 缓存执行结果
                  executedToolResults.push(...result.toolResults)
                  executedToolCalls.push(...result.confirmedToolCalls)
                } catch (error) {
                  logger.error(`Error executing tool call asynchronously:`, error as Error)
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
                    currentParams.assistant.model!,
                    currentParams.topicId
                  )

                  // 缓存执行结果
                  executedToolResults.push(...result.toolResults)
                } catch (error) {
                  logger.error(`Error executing tool use response asynchronously:`, error as Error)
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
        logger.error(`Error processing chunk:`, error as Error)
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
          logger.error(`Error in tool processing:`, error as Error)
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
  model: Model,
  topicId?: string
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
    logger.warn(`No valid MCP tool responses to execute`)
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
    ctx._internal?.flowControl?.abortSignal,
    topicId
  )

  // 找出已确认工具对应的原始toolCalls
  const confirmedToolCalls = toolCalls.filter((toolCall) => {
    return confirmedToolResponses.find((confirmed) => {
      // 根据不同的ID字段匹配原始toolCall
      return (
        ('name' in toolCall &&
          (toolCall.name?.includes(confirmed.tool.name) || toolCall.name?.includes(confirmed.tool.id))) ||
        confirmed.tool.name === toolCall.id ||
        confirmed.tool.id === toolCall.id ||
        ('toolCallId' in confirmed && confirmed.toolCallId === toolCall.id) ||
        ('function' in toolCall && toolCall.function.name.toLowerCase().includes(confirmed.tool.name.toLowerCase()))
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
  model: Model,
  topicId?: CompletionsParams['topicId']
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
    ctx._internal?.flowControl?.abortSignal,
    topicId
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
      logger.error(`Error estimating token usage for new messages:`, error as Error)
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

export async function parseAndCallTools<R>(
  tools: MCPToolResponse[],
  allToolResponses: MCPToolResponse[],
  onChunk: CompletionsParams['onChunk'],
  convertToMessage: (mcpToolResponse: MCPToolResponse, resp: MCPCallToolResponse, model: Model) => R | undefined,
  model: Model,
  mcpTools?: MCPTool[],
  abortSignal?: AbortSignal,
  topicId?: CompletionsParams['topicId']
): Promise<{ toolResults: R[]; confirmedToolResponses: MCPToolResponse[] }>

export async function parseAndCallTools<R>(
  content: string,
  allToolResponses: MCPToolResponse[],
  onChunk: CompletionsParams['onChunk'],
  convertToMessage: (mcpToolResponse: MCPToolResponse, resp: MCPCallToolResponse, model: Model) => R | undefined,
  model: Model,
  mcpTools?: MCPTool[],
  abortSignal?: AbortSignal,
  topicId?: CompletionsParams['topicId']
): Promise<{ toolResults: R[]; confirmedToolResponses: MCPToolResponse[] }>

export async function parseAndCallTools<R>(
  content: string | MCPToolResponse[],
  allToolResponses: MCPToolResponse[],
  onChunk: CompletionsParams['onChunk'],
  convertToMessage: (mcpToolResponse: MCPToolResponse, resp: MCPCallToolResponse, model: Model) => R | undefined,
  model: Model,
  mcpTools?: MCPTool[],
  abortSignal?: AbortSignal,
  topicId?: CompletionsParams['topicId']
): Promise<{ toolResults: R[]; confirmedToolResponses: MCPToolResponse[] }> {
  const toolResults: R[] = []
  let curToolResponses: MCPToolResponse[] = []
  if (Array.isArray(content)) {
    curToolResponses = content
  } else {
    // process tool use
    curToolResponses = parseToolUse(content, mcpTools || [], 0)
  }
  if (!curToolResponses || curToolResponses.length === 0) {
    return { toolResults, confirmedToolResponses: [] }
  }

  for (const toolResponse of curToolResponses) {
    upsertMCPToolResponse(
      allToolResponses,
      {
        ...toolResponse,
        status: 'pending'
      },
      onChunk!
    )
  }

  // 创建工具确认Promise映射，并立即处理每个确认
  const confirmedTools: MCPToolResponse[] = []
  const pendingPromises: Promise<void>[] = []

  curToolResponses.forEach((toolResponse) => {
    const server = getMcpServerByTool(toolResponse.tool)
    const isAutoApproveEnabled = isToolAutoApproved(toolResponse.tool, server)
    let confirmationPromise: Promise<boolean>
    if (isAutoApproveEnabled) {
      confirmationPromise = Promise.resolve(true)
    } else {
      setToolIdToNameMapping(toolResponse.id, toolResponse.tool.name)

      confirmationPromise = requestToolConfirmation(toolResponse.id, abortSignal).then((confirmed) => {
        if (confirmed && server) {
          // 自动确认其他同名的待确认工具
          confirmSameNameTools(toolResponse.tool.name)
        }
        return confirmed
      })
    }

    const processingPromise = confirmationPromise
      .then(async (confirmed) => {
        if (confirmed) {
          // 立即更新为invoking状态
          upsertMCPToolResponse(
            allToolResponses,
            {
              ...toolResponse,
              status: 'invoking'
            },
            onChunk!
          )

          // 执行工具调用
          try {
            const images: string[] = []
            // 根据工具类型选择不同的调用方式
            const toolCallResponse = toolResponse.tool.isBuiltIn
              ? await callBuiltInTool(toolResponse)
              : await callMCPTool(toolResponse, topicId, model.name)

            // 立即更新为done状态
            upsertMCPToolResponse(
              allToolResponses,
              {
                ...toolResponse,
                status: 'done',
                response: toolCallResponse
              },
              onChunk!
            )

            if (!toolCallResponse) {
              return
            }

            // 处理图片
            for (const content of toolCallResponse.content) {
              if (content.type === 'image' && content.data) {
                images.push(`data:${content.mimeType};base64,${content.data}`)
              }
            }

            if (images.length) {
              onChunk?.({
                type: ChunkType.IMAGE_CREATED
              })
              onChunk?.({
                type: ChunkType.IMAGE_COMPLETE,
                image: {
                  type: 'base64',
                  images: images
                }
              })
            }

            // 转换消息并添加到结果
            const convertedMessage = convertToMessage(toolResponse, toolCallResponse, model)
            if (convertedMessage) {
              confirmedTools.push(toolResponse)
              toolResults.push(convertedMessage)
            }
          } catch (error) {
            logger.error(`Error executing tool ${toolResponse.id}:`, error as Error)
            // 更新为错误状态
            upsertMCPToolResponse(
              allToolResponses,
              {
                ...toolResponse,
                status: 'done',
                response: {
                  isError: true,
                  content: [
                    {
                      type: 'text',
                      text: `Error executing tool: ${error instanceof Error ? error.message : 'Unknown error'}`
                    }
                  ]
                }
              },
              onChunk!
            )
          }
        } else {
          // 立即更新为cancelled状态
          upsertMCPToolResponse(
            allToolResponses,
            {
              ...toolResponse,
              status: 'cancelled',
              response: {
                isError: false,
                content: [
                  {
                    type: 'text',
                    text: 'Tool call cancelled by user.'
                  }
                ]
              }
            },
            onChunk!
          )
        }
      })
      .catch((error) => {
        logger.error(`Error waiting for tool confirmation ${toolResponse.id}:`, error as Error)
        // 立即更新为cancelled状态
        upsertMCPToolResponse(
          allToolResponses,
          {
            ...toolResponse,
            status: 'cancelled',
            response: {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: `Error in confirmation process: ${error instanceof Error ? error.message : 'Unknown error'}`
                }
              ]
            }
          },
          onChunk!
        )
      })

    pendingPromises.push(processingPromise)
  })

  // 等待所有工具处理完成（但每个工具的状态已经实时更新）
  await Promise.all(pendingPromises)

  return { toolResults, confirmedToolResponses: confirmedTools }
}
