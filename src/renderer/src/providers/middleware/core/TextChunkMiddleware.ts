import { ChunkType, LLMWebSearchCompleteChunk, TextCompleteChunk, TextDeltaChunk } from '@renderer/types/chunk'
import { completeLinks, smartLinkConverter } from '@renderer/utils/linkConverter'

import { GenericChunk } from '../schemas'
import { CompletionsMiddleware } from '../type'

const MIDDLEWARE_NAME = 'TextChunkMiddleware'

/**
 * 文本块处理中间件
 *
 * 职责：
 * 1. 累积文本内容（TEXT_DELTA）
 * 2. 对文本内容进行智能链接转换
 * 3. 监听流结束信号（LLM_RESPONSE_COMPLETE），生成TEXT_COMPLETE事件
 * 4. 暂存Web搜索结果，用于最终链接完善
 */
export const TextChunkMiddleware: CompletionsMiddleware = async (ctx, next) => {
  // 调用下游中间件
  await next()

  // 响应后处理：转换流式响应中的文本内容
  if (ctx._internal.apiCall && ctx._internal.apiCall.genericChunkStream) {
    const resultFromUpstream = ctx._internal.apiCall.genericChunkStream

    console.log(
      `[${MIDDLEWARE_NAME}] Received result from upstream. Stream is: ${resultFromUpstream ? 'present' : 'absent'}`
    )

    if (resultFromUpstream && resultFromUpstream instanceof ReadableStream) {
      const params = ctx.originalParams
      const assistant = params.assistant
      const model = params.assistant?.model

      if (!assistant || !model) {
        console.warn(`[${MIDDLEWARE_NAME}] Missing assistant or model information, skipping text processing`)
        return
      }

      // 用于跨chunk的状态管理
      let accumulatedTextContent = ''
      let isFirstChunk = true
      let pendingWebSearchResults: any[] = [] // 暂存Web搜索结果，用于最终链接完善

      const enhancedTextStream = resultFromUpstream.pipeThrough(
        new TransformStream<GenericChunk, GenericChunk>({
          transform(chunk: GenericChunk, controller) {
            if (chunk.type === ChunkType.TEXT_DELTA) {
              const textChunk = chunk as TextDeltaChunk
              accumulatedTextContent += textChunk.text

              // 根据provider和模型进行智能链接转换
              let processedText = textChunk.text

              if (assistant.enableWebSearch && pendingWebSearchResults.length > 0) {
                const providerType = model.provider || 'openai'
                // 使用当前可用的Web搜索结果进行链接转换
                processedText = smartLinkConverter(processedText, pendingWebSearchResults, providerType, isFirstChunk)
                isFirstChunk = false
              }

              // 创建新的chunk，包含处理后的文本
              controller.enqueue({
                ...textChunk,
                text: processedText
              })
            } else if (chunk.type === ChunkType.LLM_WEB_SEARCH_COMPLETE) {
              // 暂存Web搜索结果用于链接完善
              const webSearchChunk = chunk as LLMWebSearchCompleteChunk
              if (webSearchChunk.llm_web_search?.results) {
                const results = Array.isArray(webSearchChunk.llm_web_search.results)
                  ? webSearchChunk.llm_web_search.results
                  : [webSearchChunk.llm_web_search.results]

                results.forEach((result: any, index: number) => {
                  if (result.url_citation || result.url || result.link) {
                    pendingWebSearchResults.push({
                      id: index + 1,
                      url: result.url_citation?.url || result.url || result.link,
                      title: result.url_citation?.title || result.title,
                      link: result.url_citation?.url || result.url || result.link
                    })
                  }
                })
              }

              // 将Web搜索完成事件继续传递下去
              controller.enqueue(chunk)
            } else if (chunk.type === ChunkType.LLM_RESPONSE_COMPLETE) {
              // 流结束信号，生成TEXT_COMPLETE事件
              let finalText = accumulatedTextContent

              // 如果有待处理的Web搜索结果，尝试完善链接
              if (assistant.enableWebSearch && pendingWebSearchResults.length > 0) {
                finalText = completeLinks(finalText, pendingWebSearchResults)
              }

              const textCompleteChunk: TextCompleteChunk = {
                type: ChunkType.TEXT_COMPLETE,
                text: finalText
              }
              controller.enqueue(textCompleteChunk)

              console.log(`[${MIDDLEWARE_NAME}] Generated TEXT_COMPLETE with ${finalText.length} characters`)

              // 继续传递LLM_RESPONSE_COMPLETE事件
              controller.enqueue(chunk)

              // 重置状态
              accumulatedTextContent = ''
              isFirstChunk = true
              pendingWebSearchResults = []
            } else {
              // 其他类型的chunk直接传递
              controller.enqueue(chunk)
            }
          }
        })
      )

      // 更新响应结果
      ctx._internal.apiCall.genericChunkStream = enhancedTextStream
    } else {
      console.log(`[${MIDDLEWARE_NAME}] No stream to process or not a ReadableStream. Returning original result.`)
    }
  }
}
