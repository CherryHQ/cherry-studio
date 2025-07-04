import Logger from '@renderer/config/logger'
import { Usage } from '@renderer/types'
import type { Chunk } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'

import { CompletionsParams, CompletionsResult, GenericChunk } from '../schemas'
import { CompletionsContext, CompletionsMiddleware } from '../types'

export const MIDDLEWARE_NAME = 'FinalChunkConsumerAndNotifierMiddleware'

/**
 * 最终Chunk消费和通知中间件
 *
 * 职责：
 * 1. 消费所有GenericChunk流中的chunks并转发给onChunk回调
 * 2. 累加usage/metrics数据（从原始SDK chunks或GenericChunk中提取）
 * 3. 在检测到LLM_RESPONSE_COMPLETE时发送包含累计数据的BLOCK_COMPLETE
 * 4. 处理MCP工具调用的多轮请求中的数据累加
 */
const FinalChunkConsumerMiddleware: CompletionsMiddleware =
  () =>
  (next) =>
  async (ctx: CompletionsContext, params: CompletionsParams): Promise<CompletionsResult> => {
    const isRecursiveCall =
      params._internal?.toolProcessingState?.isRecursiveCall ||
      ctx._internal?.toolProcessingState?.isRecursiveCall ||
      false

    // 初始化累计数据（只在顶层调用时初始化）
    if (!isRecursiveCall) {
      if (!ctx._internal.customState) {
        ctx._internal.customState = {}
      }
      ctx._internal.observer = {
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        },
        metrics: {
          completion_tokens: 0,
          time_completion_millsec: 0,
          time_first_token_millsec: 0,
          time_thinking_millsec: 0
        }
      }
      // 初始化文本累积器
      ctx._internal.customState.accumulatedText = ''
      ctx._internal.customState.startTimestamp = Date.now()
    }

    // 调用下游中间件
    const result = await next(ctx, params)

    // 响应后处理：处理GenericChunk流式响应
    if (result.stream) {
      const resultFromUpstream = result.stream

      if (resultFromUpstream && resultFromUpstream instanceof ReadableStream) {
        const reader = resultFromUpstream.getReader()

        try {
          while (true) {
            const { done, value: chunk } = await reader.read()
            if (done) {
              Logger.debug(`[${MIDDLEWARE_NAME}] Input stream finished.`)
              break
            }

            if (chunk) {
              const genericChunk = chunk as GenericChunk
              // 提取并累加usage/metrics数据
              extractAndAccumulateUsageMetrics(ctx, genericChunk)

              const shouldSkipChunk =
                isRecursiveCall &&
                (genericChunk.type === ChunkType.BLOCK_COMPLETE ||
                  genericChunk.type === ChunkType.LLM_RESPONSE_COMPLETE)

              if (!shouldSkipChunk) params.onChunk?.(genericChunk)
            } else {
              Logger.warn(`[${MIDDLEWARE_NAME}] Received undefined chunk before stream was done.`)
            }
          }
        } catch (error) {
          Logger.error(`[${MIDDLEWARE_NAME}] Error consuming stream:`, error)
          throw error
        } finally {
          if (params.onChunk && !isRecursiveCall) {
            params.onChunk({
              type: ChunkType.BLOCK_COMPLETE,
              response: {
                usage: ctx._internal.observer?.usage ? { ...ctx._internal.observer.usage } : undefined,
                metrics: ctx._internal.observer?.metrics ? { ...ctx._internal.observer.metrics } : undefined
              }
            } as Chunk)
            if (ctx._internal.toolProcessingState) {
              ctx._internal.toolProcessingState = {}
            }
          }
        }

        // 为流式输出添加getText方法
        const modifiedResult = {
          ...result,
          stream: new ReadableStream<GenericChunk>({
            start(controller) {
              controller.close()
            }
          }),
          getText: () => {
            return ctx._internal.customState?.accumulatedText || ''
          }
        }

        return modifiedResult
      } else {
        Logger.debug(`[${MIDDLEWARE_NAME}] No GenericChunk stream to process.`)
      }
    }

    return result
  }

/**
 * 从GenericChunk或原始SDK chunks中提取usage/metrics数据并累加
 */
function extractAndAccumulateUsageMetrics(ctx: CompletionsContext, chunk: GenericChunk): void {
  if (!ctx._internal.observer?.usage || !ctx._internal.observer?.metrics) {
    return
  }

  try {
    if (ctx._internal.customState && !ctx._internal.customState?.firstTokenTimestamp) {
      ctx._internal.customState.firstTokenTimestamp = Date.now()
      Logger.debug(`[${MIDDLEWARE_NAME}] First token timestamp: ${ctx._internal.customState.firstTokenTimestamp}`)
    }
    if (chunk.type === ChunkType.LLM_RESPONSE_COMPLETE) {
      // 从LLM_RESPONSE_COMPLETE chunk中提取usage数据
      if (chunk.response?.usage) {
        accumulateUsage(ctx._internal.observer.usage, chunk.response.usage)
      }

      if (ctx._internal.customState && ctx._internal.customState?.firstTokenTimestamp) {
        ctx._internal.observer.metrics.time_first_token_millsec =
          ctx._internal.customState.firstTokenTimestamp - ctx._internal.customState.startTimestamp
        ctx._internal.observer.metrics.time_completion_millsec +=
          Date.now() - ctx._internal.customState.firstTokenTimestamp
      }
    }

    // 也可以从其他chunk类型中提取metrics数据
    if (chunk.type === ChunkType.THINKING_COMPLETE && chunk.thinking_millsec && ctx._internal.observer?.metrics) {
      ctx._internal.observer.metrics.time_thinking_millsec = Math.max(
        ctx._internal.observer.metrics.time_thinking_millsec || 0,
        chunk.thinking_millsec
      )
    }
  } catch (error) {
    console.error(`[${MIDDLEWARE_NAME}] Error extracting usage/metrics from chunk:`, error)
  }
}

/**
 * 累加usage数据
 */
function accumulateUsage(accumulated: Usage, newUsage: Usage): void {
  if (newUsage.prompt_tokens !== undefined) {
    accumulated.prompt_tokens += newUsage.prompt_tokens
  }
  if (newUsage.completion_tokens !== undefined) {
    accumulated.completion_tokens += newUsage.completion_tokens
  }
  if (newUsage.total_tokens !== undefined) {
    accumulated.total_tokens += newUsage.total_tokens
  }
  if (newUsage.thoughts_tokens !== undefined) {
    accumulated.thoughts_tokens = (accumulated.thoughts_tokens || 0) + newUsage.thoughts_tokens
  }
}

export default FinalChunkConsumerMiddleware
