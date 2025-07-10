import Logger from '@renderer/config/logger'
import { ChunkType, TextDeltaChunk } from '@renderer/types/chunk'

import { CompletionsParams, CompletionsResult, GenericChunk } from '../schemas'
import { CompletionsContext, CompletionsMiddleware } from '../types'

export const MIDDLEWARE_NAME = 'TextChunkMiddleware'

/**
 * 文本块处理中间件
 *
 * 职责：
 * 1. 累积文本内容（TEXT_DELTA）
 * 2. 对文本内容进行智能链接转换
 * 3. 生成TEXT_COMPLETE事件
 * 4. 暂存Web搜索结果，用于最终链接完善
 * 5. 处理 onResponse 回调，实时发送文本更新和最终完整文本
 */
export const TextChunkMiddleware: CompletionsMiddleware =
  () =>
  (next) =>
  async (ctx: CompletionsContext, params: CompletionsParams): Promise<CompletionsResult> => {
    // 调用下游中间件
    const result = await next(ctx, params)

    // 响应后处理：转换流式响应中的文本内容
    if (result.stream) {
      const resultFromUpstream = result.stream as ReadableStream<GenericChunk>

      if (resultFromUpstream && resultFromUpstream instanceof ReadableStream) {
        const assistant = params.assistant
        const model = params.assistant?.model

        if (!assistant || !model) {
          Logger.warn(`[${MIDDLEWARE_NAME}] Missing assistant or model information, skipping text processing`)
          return result
        }

        // 用于跨chunk的状态管理
        let accumulatedTextContent = ''
        const enhancedTextStream = resultFromUpstream.pipeThrough(
          new TransformStream<GenericChunk, GenericChunk>({
            transform(chunk: GenericChunk, controller) {
              if (chunk.type === ChunkType.TEXT_DELTA) {
                const textChunk = chunk as TextDeltaChunk
                accumulatedTextContent += textChunk.text

                // 处理 onResponse 回调 - 发送增量文本更新
                if (params.onResponse) {
                  params.onResponse(accumulatedTextContent, false)
                }

                // 创建新的chunk，包含处理后的文本
                controller.enqueue(chunk)
              } else if (accumulatedTextContent && chunk.type !== ChunkType.TEXT_START) {
                if (chunk.type === ChunkType.LLM_RESPONSE_COMPLETE) {
                  const finalText = accumulatedTextContent
                  ctx._internal.customState!.accumulatedText = finalText
                  if (ctx._internal.toolProcessingState && !ctx._internal.toolProcessingState?.output) {
                    ctx._internal.toolProcessingState.output = finalText
                  }

                  // 处理 onResponse 回调 - 发送最终完整文本
                  if (params.onResponse) {
                    params.onResponse(finalText, true)
                  }

                  controller.enqueue({
                    type: ChunkType.TEXT_COMPLETE,
                    text: finalText
                  })
                  controller.enqueue(chunk)
                } else {
                  controller.enqueue({
                    type: ChunkType.TEXT_COMPLETE,
                    text: accumulatedTextContent
                  })
                  controller.enqueue(chunk)
                }
                accumulatedTextContent = ''
              } else {
                // 其他类型的chunk直接传递
                controller.enqueue(chunk)
              }
            }
          })
        )

        // 更新响应结果
        return {
          ...result,
          stream: enhancedTextStream
        }
      } else {
        Logger.warn(`[${MIDDLEWARE_NAME}] No stream to process or not a ReadableStream. Returning original result.`)
      }
    }

    return result
  }
