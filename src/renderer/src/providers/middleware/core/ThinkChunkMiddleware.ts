import { ChunkType, ThinkingCompleteChunk, ThinkingDeltaChunk } from '@renderer/types/chunk'

import { GenericChunk } from '../schemas'
import { CompletionsMiddleware } from '../type'

const MIDDLEWARE_NAME = 'ThinkChunkMiddleware'

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
export const ThinkChunkMiddleware: CompletionsMiddleware = async (ctx, next) => {
  // 调用下游中间件
  await next()

  // 响应后处理：处理思考内容
  if (ctx._internal.apiCall?.genericChunkStream) {
    const resultFromUpstream = ctx._internal.apiCall.genericChunkStream

    console.log(
      `[${MIDDLEWARE_NAME}] Received generic chunk stream from upstream. Stream is: ${resultFromUpstream ? 'present' : 'absent'}`
    )

    // 检查是否启用reasoning
    const params = ctx.originalParams
    const enableReasoning = params.enableReasoning || false
    if (!enableReasoning) {
      console.log(`[${MIDDLEWARE_NAME}] Reasoning not enabled, passing through unchanged.`)
      return
    }

    // 检查是否有流需要处理
    if (resultFromUpstream && resultFromUpstream instanceof ReadableStream) {
      console.log(`[${MIDDLEWARE_NAME}] Processing reasoning chunks from SDK.`)

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
                thinking_millsec: thinkingStartTime > 0 ? Date.now() - thinkingStartTime : 0
              }
              controller.enqueue(enhancedChunk)
            } else if (chunk.type === ChunkType.TEXT_DELTA) {
              // 如果有累积的思考内容，在第一个文本块到达时生成THINKING_COMPLETE
              if (hasThinkingContent && thinkingStartTime > 0) {
                const thinkingCompleteChunk: ThinkingCompleteChunk = {
                  type: ChunkType.THINKING_COMPLETE,
                  text: accumulatedThinkingContent,
                  thinking_millsec: thinkingStartTime > 0 ? Date.now() - thinkingStartTime : 0
                }
                controller.enqueue(thinkingCompleteChunk)
                hasThinkingContent = false
                accumulatedThinkingContent = ''
                thinkingStartTime = 0
              }

              // 直接传递文本块
              controller.enqueue(chunk)
            } else {
              // 其他类型的chunk直接传递
              controller.enqueue(chunk)
            }
          }
        })
      )

      // 更新响应结果
      ctx._internal.apiCall.genericChunkStream = processedStream
    } else {
      console.log(`[${MIDDLEWARE_NAME}] No generic chunk stream to process or not a ReadableStream.`)
    }
  }
}
