import { ChunkType, LLMWebSearchCompleteChunk } from '@renderer/types/chunk'

import { GenericChunk } from '../schemas'
import { CompletionsMiddleware } from '../type'

const MIDDLEWARE_NAME = 'WebSearchMiddleware'

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
export const WebSearchMiddleware: CompletionsMiddleware = async (ctx, next) => {
  // 调用下游中间件
  await next()

  // 响应后处理：记录Web搜索事件
  if (ctx._internal?.apiCall?.genericChunkStream) {
    const resultFromUpstream = ctx._internal.apiCall.genericChunkStream

    console.log(
      `[${MIDDLEWARE_NAME}] Received result from upstream. Stream is: ${resultFromUpstream ? 'present' : 'absent'}`
    )

    if (resultFromUpstream && resultFromUpstream instanceof ReadableStream) {
      const params = ctx.originalParams
      const assistant = params.assistant

      // Web搜索状态跟踪
      let webSearchResultsCount = 0
      let hasWebSearchResults = false

      const enhancedStream = resultFromUpstream.pipeThrough(
        new TransformStream<GenericChunk, GenericChunk>({
          transform(chunk: GenericChunk, controller) {
            if (chunk.type === ChunkType.LLM_WEB_SEARCH_COMPLETE) {
              const webSearchChunk = chunk as LLMWebSearchCompleteChunk
              hasWebSearchResults = true
              webSearchResultsCount++

              console.log(`[${MIDDLEWARE_NAME}] Web search results received (#${webSearchResultsCount}):`, {
                source: webSearchChunk.llm_web_search?.source,
                resultsCount: Array.isArray(webSearchChunk.llm_web_search?.results)
                  ? webSearchChunk.llm_web_search.results.length
                  : 1
              })

              // 可以在这里添加Web搜索结果的后处理逻辑
              // 例如：过滤、排序、格式化等

              controller.enqueue(chunk)
            } else if (chunk.type === ChunkType.LLM_RESPONSE_COMPLETE) {
              // 流结束时的Web搜索状态汇总
              if (assistant?.enableWebSearch) {
                console.log(`[${MIDDLEWARE_NAME}] Stream completed. Web search summary:`, {
                  enabled: true,
                  resultsReceived: hasWebSearchResults,
                  totalResults: webSearchResultsCount
                })
              }

              // 继续传递LLM_RESPONSE_COMPLETE事件
              controller.enqueue(chunk)

              // 重置状态
              webSearchResultsCount = 0
              hasWebSearchResults = false
            } else {
              // 其他类型的chunk直接传递
              controller.enqueue(chunk)
            }
          }
        })
      )

      // 更新响应结果
      ctx._internal.apiCall.genericChunkStream = enhancedStream
    } else {
      console.log(`[${MIDDLEWARE_NAME}] No stream to process or not a ReadableStream.`)
    }
  }
}
