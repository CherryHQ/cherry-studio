import { loggerService } from '@logger'
import { ChunkType, ThinkingCompleteChunk, ThinkingDeltaChunk } from '@renderer/types/chunk'

import { CompletionsParams, CompletionsResult, GenericChunk } from '../schemas'
import { CompletionsContext, CompletionsMiddleware } from '../types'

export const MIDDLEWARE_NAME = 'ThinkChunkMiddleware'

const logger = loggerService.withContext('ThinkChunkMiddleware')

/**
 * 处理思考内容的中间件
 *
 * 注意：从 v2 版本开始，流结束语义的判断已移至 ApiClient 层处理
 * 此中间件现在主要负责：
 * 1. 处理原始SDK chunk中的reasoning字段
 * 2. 计算准确的思考时间
 * 3. 在思考内容结束时生成THINKING_COMPLETE事件
 *
 * 职责：
 * 1. 累积思考内容（THINKING_DELTA）
 * 2. 监听流结束信号，生成THINKING_COMPLETE事件
 * 3. 计算准确的思考时间
 *
 */
export const ThinkChunkMiddleware: CompletionsMiddleware =
  () =>
  (next) =>
  async (ctx: CompletionsContext, params: CompletionsParams): Promise<CompletionsResult> => {
    // 调用下游中间件
    const result = await next(ctx, params)

    // 响应后处理：处理思考内容
    if (result.stream) {
      const resultFromUpstream = result.stream as ReadableStream<GenericChunk>

      // 检查是否有流需要处理
      if (resultFromUpstream && resultFromUpstream instanceof ReadableStream) {
        // thinking 处理状态
        let accumulatedThinkingContent = ''
        let hasThinkingContent = false
        let thinkingStartTime = 0

        const processedStream = resultFromUpstream.pipeThrough(
          new TransformStream<GenericChunk, GenericChunk>({
            transform(chunk: GenericChunk, controller) {
              if (chunk.type === ChunkType.THINKING_DELTA) {
                const thinkingChunk = chunk as ThinkingDeltaChunk

                // 第一次接收到思考内容时记录开始时间
                if (!hasThinkingContent) {
                  hasThinkingContent = true
                  thinkingStartTime = Date.now()
                }

                accumulatedThinkingContent += thinkingChunk.text

                // 更新思考时间并传递
                const enhancedChunk: ThinkingDeltaChunk = {
                  ...thinkingChunk,
                  text: accumulatedThinkingContent,
                  thinking_millsec: thinkingStartTime > 0 ? Date.now() - thinkingStartTime : 0
                }
                controller.enqueue(enhancedChunk)
              } else if (hasThinkingContent && thinkingStartTime > 0 && chunk.type !== ChunkType.THINKING_START) {
                // 收到任何非THINKING_DELTA的chunk时，如果有累积的思考内容，生成THINKING_COMPLETE
                const thinkingCompleteChunk: ThinkingCompleteChunk = {
                  type: ChunkType.THINKING_COMPLETE,
                  text: accumulatedThinkingContent,
                  thinking_millsec: thinkingStartTime > 0 ? Date.now() - thinkingStartTime : 0
                }
                controller.enqueue(thinkingCompleteChunk)
                hasThinkingContent = false
                accumulatedThinkingContent = ''
                thinkingStartTime = 0

                // 继续传递当前chunk
                controller.enqueue(chunk)
              } else {
                // 其他情况直接传递
                controller.enqueue(chunk)
              }
            }
          })
        )

        // 更新响应结果
        return {
          ...result,
          stream: processedStream
        }
      } else {
        logger.warn(`No generic chunk stream to process or not a ReadableStream.`)
      }
    }

    return result
  }
