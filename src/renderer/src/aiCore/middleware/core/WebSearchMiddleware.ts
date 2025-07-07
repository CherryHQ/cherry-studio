import { ChunkType } from '@renderer/types/chunk'
import { flushLinkConverterBuffer, smartLinkConverter } from '@renderer/utils/linkConverter'

import { CompletionsParams, CompletionsResult, GenericChunk } from '../schemas'
import { CompletionsContext, CompletionsMiddleware } from '../types'

export const MIDDLEWARE_NAME = 'WebSearchMiddleware'

/**
 * Web搜索处理中间件 - 基于GenericChunk流处理
 *
 * 职责：
 * 1. 监听和记录Web搜索事件
 * 2. 可以在此处添加Web搜索结果的后处理逻辑
 * 3. 维护Web搜索相关的状态
 *
 * 注意：Web搜索结果的识别和生成已在ApiClient的响应转换器中处理
 */
export const WebSearchMiddleware: CompletionsMiddleware =
  () =>
  (next) =>
  async (ctx: CompletionsContext, params: CompletionsParams): Promise<CompletionsResult> => {
    ctx._internal.webSearchState = {
      results: undefined
    }
    // 调用下游中间件
    const result = await next(ctx, params)

    const model = params.assistant?.model!
    let isFirstChunk = true

    // 响应后处理：记录Web搜索事件
    if (result.stream) {
      const resultFromUpstream = result.stream

      if (resultFromUpstream && resultFromUpstream instanceof ReadableStream) {
        // Web搜索状态跟踪
        const enhancedStream = (resultFromUpstream as ReadableStream<GenericChunk>).pipeThrough(
          new TransformStream<GenericChunk, GenericChunk>({
            transform(chunk: GenericChunk, controller) {
              if (chunk.type === ChunkType.TEXT_DELTA) {
                const providerType = model.provider || 'openai'
                // 使用当前可用的Web搜索结果进行链接转换
                const text = chunk.text
                const result = smartLinkConverter(
                  text,
                  providerType,
                  isFirstChunk,
                  ctx._internal.webSearchState!.results
                )
                if (isFirstChunk) {
                  isFirstChunk = false
                }

                // - 如果有内容被缓冲，说明convertLinks正在等待后续chunk，不使用原文本避免重复
                // - 如果没有内容被缓冲且结果为空，可能是其他处理问题，使用原文本作为安全回退
                let finalText: string
                if (result.hasBufferedContent) {
                  // 有内容被缓冲，使用处理后的结果（可能为空，等待后续chunk）
                  finalText = result.text
                } else {
                  // 没有内容被缓冲，可以安全使用回退逻辑
                  finalText = result.text || text
                }

                // 只有当finalText不为空时才发送chunk
                if (finalText) {
                  controller.enqueue({
                    ...chunk,
                    text: finalText
                  })
                }
              } else if (chunk.type === ChunkType.LLM_WEB_SEARCH_COMPLETE) {
                // 暂存Web搜索结果用于链接完善
                ctx._internal.webSearchState!.results = chunk.llm_web_search

                // 将Web搜索完成事件继续传递下去
                controller.enqueue(chunk)
              } else if (chunk.type === ChunkType.LLM_RESPONSE_COMPLETE) {
                // 流结束时，清空链接转换器的buffer并处理剩余内容
                const remainingText = flushLinkConverterBuffer()
                if (remainingText) {
                  controller.enqueue({
                    type: ChunkType.TEXT_DELTA,
                    text: remainingText
                  })
                }
                // 继续传递LLM_RESPONSE_COMPLETE事件
                controller.enqueue(chunk)
              } else {
                controller.enqueue(chunk)
              }
            }
          })
        )

        return {
          ...result,
          stream: enhancedStream
        }
      } else {
        console.log(`[${MIDDLEWARE_NAME}] No stream to process or not a ReadableStream.`)
      }
    }

    return result
  }
