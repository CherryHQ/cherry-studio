import { Usage } from '@renderer/types'
import type { Chunk } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'

import { GenericChunk } from '../schemas'
import { CompletionsMiddleware, ProcessingState } from '../type'

const MIDDLEWARE_NAME = 'FinalChunkConsumerAndNotifierMiddleware'

/**
 * 最终Chunk消费和通知中间件 - Koa洋葱圈风格
 *
 * 职责：
 * 1. 消费所有GenericChunk流中的chunks并转发给onChunk回调
 * 2. 累加usage/metrics数据（从原始SDK chunks或GenericChunk中提取）
 * 3. 在检测到LLM_RESPONSE_COMPLETE时发送包含累计数据的BLOCK_COMPLETE
 * 4. 处理MCP工具调用的多轮请求中的数据累加
 */
const FinalChunkConsumerMiddleware: CompletionsMiddleware = async (ctx, next) => {
  const params = ctx.originalParams
  const internal = ctx._internal
  const isRecursiveCall = internal?.toolProcessingState?.isRecursiveCall || false
  const recursionDepth = internal?.toolProcessingState?.recursionDepth || 0

  console.log(`[${MIDDLEWARE_NAME}] Starting middleware. isRecursive: ${isRecursiveCall}, depth: ${recursionDepth}`)

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
    console.log(`[${MIDDLEWARE_NAME}] Initialized accumulation data for top-level call`)
  } else {
    console.log(`[${MIDDLEWARE_NAME}] Recursive call, will use existing accumulation data`)
  }

  // 调用下游中间件
  await next()

  // 响应后处理：处理GenericChunk流式响应
  if (ctx._internal?.apiCall?.genericChunkStream) {
    const resultFromUpstream = ctx._internal.apiCall.genericChunkStream

    console.log(
      `[${MIDDLEWARE_NAME}] Received GenericChunk stream from upstream. isRecursive: ${isRecursiveCall}, depth: ${recursionDepth}`
    )

    if (resultFromUpstream && resultFromUpstream instanceof ReadableStream) {
      const reader = resultFromUpstream.getReader()

      try {
        while (true) {
          const { done, value: chunk } = await reader.read()

          if (done) {
            console.log(`[${MIDDLEWARE_NAME}] Input stream finished.`)
            break
          }

          if (chunk) {
            // 处理GenericChunk
            if ('type' in chunk && typeof chunk.type === 'string') {
              const genericChunk = chunk as GenericChunk

              // 转发chunk给onChunk回调
              if (params.onChunk) {
                params.onChunk(genericChunk as Chunk)
              }

              // 检查是否是LLM_RESPONSE_COMPLETE，用于发送最终的BLOCK_COMPLETE
              if (genericChunk.type === ChunkType.LLM_RESPONSE_COMPLETE) {
                // 从LLM_RESPONSE_COMPLETE chunk中提取usage/metrics数据
                extractAndAccumulateUsageMetrics(genericChunk, ctx._internal.observer)

                // 只在顶层调用时发送最终的累计数据
                if (params.onChunk && !isRecursiveCall) {
                  console.log(
                    `[${MIDDLEWARE_NAME}] Sending final BLOCK_COMPLETE with accumulated data (top-level call)`
                  )

                  // 发送包含累计数据的 BLOCK_COMPLETE
                  params.onChunk({
                    type: ChunkType.BLOCK_COMPLETE,
                    response: {
                      usage: ctx._internal.observer?.usage ? { ...ctx._internal.observer.usage } : undefined,
                      metrics: ctx._internal.observer?.metrics ? { ...ctx._internal.observer.metrics } : undefined
                    }
                  } as Chunk)

                  console.log(`[${MIDDLEWARE_NAME}] Final accumulated data:`, {
                    usage: ctx._internal.customState?.accumulatedUsage,
                    metrics: ctx._internal.customState?.accumulatedMetrics
                  })
                } else if (isRecursiveCall) {
                  console.log(`[${MIDDLEWARE_NAME}] Skipping final BLOCK_COMPLETE (recursive call detected)`)
                }
              }
            } else {
              console.warn(`[${MIDDLEWARE_NAME}] Received chunk with no type property:`, chunk)
            }
          } else {
            console.warn(`[${MIDDLEWARE_NAME}] Received undefined chunk before stream was done.`)
          }
        }
      } catch (error) {
        console.error(`[${MIDDLEWARE_NAME}] Error consuming stream:`, error)
        throw error
      } finally {
        console.log(`[${MIDDLEWARE_NAME}] Stream consumption completed`)
      }

      // 更新响应结果：创建一个空的已关闭流
      ctx._internal.apiCall.genericChunkStream = new ReadableStream<GenericChunk>({
        start(controller) {
          controller.close()
        }
      })
    } else {
      console.log(`[${MIDDLEWARE_NAME}] No GenericChunk stream to process.`)
    }
  }
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
