import Logger from '@renderer/config/logger'
import { Usage } from '@renderer/types'
import type { Chunk } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'

import { CompletionsParams, CompletionsResult, GenericChunk } from '../schemas'
import { CompletionsContext, CompletionsMiddleware, ProcessingState } from '../types'

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
    const recursionDepth =
      params._internal?.toolProcessingState?.recursionDepth || ctx._internal?.toolProcessingState?.recursionDepth || 0

    Logger.debug(`[${MIDDLEWARE_NAME}] Starting middleware. isRecursive: ${isRecursiveCall}, depth: ${recursionDepth}`)

    // 初始化累计数据（只在顶层调用时初始化）
    if (!isRecursiveCall) {
      if (!ctx._internal.customState) {
        ctx._internal.customState = {}
      }
      ctx._internal.customState.accumulatedUsage = {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        thoughts_tokens: 0
      }
      ctx._internal.customState.accumulatedMetrics = {
        completion_tokens: 0,
        time_completion_millsec: 0,
        time_first_token_millsec: 0,
        time_thinking_millsec: 0
      }
      Logger.debug(`[${MIDDLEWARE_NAME}] Initialized accumulation data for top-level call`)
    } else {
      Logger.debug(`[${MIDDLEWARE_NAME}] Recursive call, will use existing accumulation data`)
    }

    // 调用下游中间件
    const result = await next(ctx, params)

    // 响应后处理：处理GenericChunk流式响应
    if (result.stream) {
      const resultFromUpstream = result.stream

      Logger.debug(
        `[${MIDDLEWARE_NAME}] Received GenericChunk stream from upstream. isRecursive: ${isRecursiveCall}, depth: ${recursionDepth}`
      )

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
              extractAndAccumulateUsageMetrics(genericChunk, ctx._internal.observer)

              const shouldSkipChunk =
                isRecursiveCall &&
                (genericChunk.type === ChunkType.BLOCK_COMPLETE ||
                  genericChunk.type === ChunkType.LLM_RESPONSE_COMPLETE)

              if (shouldSkipChunk) {
                Logger.debug(
                  `[${MIDDLEWARE_NAME}] Skipping completion chunk in recursive call - Type: ${genericChunk.type}`
                )
              } else params.onChunk?.(genericChunk)
            } else {
              Logger.warn(`[${MIDDLEWARE_NAME}] Received undefined chunk before stream was done.`)
            }
          }
        } catch (error) {
          Logger.error(`[${MIDDLEWARE_NAME}] Error consuming stream:`, error)
          throw error
        } finally {
          Logger.debug(`[${MIDDLEWARE_NAME}] Stream consumption completed`)
          const finalIsRecursiveCall = ctx._internal?.toolProcessingState?.isRecursiveCall || false
          const finalRecursionDepth = ctx._internal?.toolProcessingState?.recursionDepth || 0

          Logger.debug(
            `[${MIDDLEWARE_NAME}] Initial recursive call state: isRecursiveCall: ${isRecursiveCall}, recursionDepth: ${recursionDepth}`
          )

          Logger.debug(
            `[${MIDDLEWARE_NAME}] Final recursive call state: isRecursiveCall: ${finalIsRecursiveCall}, recursionDepth: ${finalRecursionDepth}`
          )

          if (finalIsRecursiveCall) {
            Logger.debug(`[${MIDDLEWARE_NAME}] Skipping final BLOCK_COMPLETE (recursive call detected)`)
          } else {
            Logger.info(`[${MIDDLEWARE_NAME}] Skipping final BLOCK_COMPLETE (onChunk not provided)`)
          }
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

        return {
          ...result,
          stream: new ReadableStream<GenericChunk>({
            start(controller) {
              controller.close()
            }
          })
        }
      } else {
        Logger.debug(`[${MIDDLEWARE_NAME}] No GenericChunk stream to process.`)
      }
    }

    return result
  }

/**
 * 从GenericChunk或原始SDK chunks中提取usage/metrics数据并累加
 */
function extractAndAccumulateUsageMetrics(chunk: GenericChunk, observer: ProcessingState['observer']): void {
  if (!observer?.usage || !observer?.metrics) {
    return
  }

  try {
    // 从LLM_RESPONSE_COMPLETE chunk中提取usage数据
    if (chunk.type === ChunkType.LLM_RESPONSE_COMPLETE && chunk.response?.usage) {
      accumulateUsage(observer.usage, chunk.response.usage)
      console.log(`[${MIDDLEWARE_NAME}] Extracted usage from LLM_RESPONSE_COMPLETE:`, observer.usage)
    }

    // 也可以从其他chunk类型中提取metrics数据
    if (chunk.type === ChunkType.THINKING_COMPLETE && chunk.thinking_millsec && observer.metrics) {
      observer.metrics.time_thinking_millsec = Math.max(
        observer.metrics.time_thinking_millsec || 0,
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
