import { isHunyuanSearchModel, isZhipuModel } from '@renderer/config/models'
import { Chunk, ChunkType, TextCompleteChunk, TextDeltaChunk } from '@renderer/types/chunk'
import {
  convertLinks,
  convertLinksToHunyuan,
  convertLinksToOpenRouter,
  convertLinksToZhipu
} from '@renderer/utils/linkConverter'
import { isEmpty } from 'lodash'
import OpenAI from 'openai'

import type { CompletionsOpenAIResult, CompletionsParams } from '../../AiProvider'
import { AiProviderMiddlewareCompletionsContext, CompletionsMiddleware } from '../middlewareTypes'

const MIDDLEWARE_NAME = 'TextChunkMiddleware'

export const TextChunkMiddleware: CompletionsMiddleware =
  () => (next) => async (context: AiProviderMiddlewareCompletionsContext, params: CompletionsParams) => {
    const resultFromUpstream = await next(context, params)

    console.log(
      `[${MIDDLEWARE_NAME}] Received result from upstream. Stream is: ${resultFromUpstream.stream ? 'present' : 'absent'}`
    )

    // We expect resultFromUpstream.stream to be either:
    // - ReadableStream<OpenAI.Chat.Completions.ChatCompletionChunk> (from StreamAdapterMiddleware)
    // - ReadableStream<Chunk | OpenAI.Chat.Completions.ChatCompletionChunk> (from ThinkChunkMiddleware)
    if (resultFromUpstream.stream && resultFromUpstream.stream instanceof ReadableStream) {
      // Cast to the mixed stream type to handle both cases
      const mixedStream = resultFromUpstream.stream as ReadableStream<
        Chunk | OpenAI.Chat.Completions.ChatCompletionChunk
      >

      const assistant = context.assistant!
      const model = context.model!

      // 使用TransformStream进行流式处理，专注于文本内容
      let accumulatedText = ''
      let isFirstChunk = true // 用于链接转换器的重置

      const standardChunkStream = mixedStream.pipeThrough(
        new TransformStream<Chunk | OpenAI.Chat.Completions.ChatCompletionChunk, Chunk>({
          transform(item, controller) {
            // Check if this is already a Chunk (from ThinkChunkMiddleware)
            if ('type' in item && typeof item.type === 'string') {
              const chunk = item as Chunk

              // 如果是 TEXT_DELTA chunk，需要处理链接转换
              if (chunk.type === ChunkType.TEXT_DELTA && assistant.enableWebSearch) {
                let textDelta = chunk.text

                // 根据模型进行链接转换
                if (model.provider === 'openrouter') {
                  textDelta = convertLinksToOpenRouter(textDelta, isFirstChunk)
                } else if (isZhipuModel(model)) {
                  textDelta = convertLinksToZhipu(textDelta, isFirstChunk)
                } else if (isHunyuanSearchModel(model)) {
                  // Hunyuan需要从原始chunk中获取搜索结果，这里使用默认转换
                  textDelta = convertLinksToHunyuan(textDelta, [], isFirstChunk)
                }

                isFirstChunk = false

                // 生成处理后的 TEXT_DELTA chunk
                const processedTextChunk: TextDeltaChunk = {
                  ...chunk,
                  text: textDelta
                }
                controller.enqueue(processedTextChunk)
              } else {
                // 其他类型的chunk直接传递
                controller.enqueue(chunk)
              }
              return
            }

            // This is a ChatCompletionChunk, convert it to standard Chunk format
            const sdkChunk = item as OpenAI.Chat.Completions.ChatCompletionChunk
            const choice = sdkChunk.choices?.[0]
            if (!choice) return

            const delta = choice.delta

            // 只处理文本内容，工具调用由 McpToolChunkMiddleware 处理
            if (delta?.content) {
              let textDelta = delta.content

              // 处理Web搜索的链接转换
              if (assistant.enableWebSearch) {
                // 根据模型进行链接转换
                if (model.provider === 'openrouter') {
                  textDelta = convertLinksToOpenRouter(textDelta, isFirstChunk)
                } else if (isZhipuModel(model)) {
                  textDelta = convertLinksToZhipu(textDelta, isFirstChunk)
                } else if (isHunyuanSearchModel(model)) {
                  // 对于Hunyuan，我们需要从原始chunk中获取搜索结果
                  const searchResults = (sdkChunk as any)?.search_info?.search_results || []
                  textDelta = convertLinksToHunyuan(textDelta, searchResults, isFirstChunk)
                }

                // 处理OpenAI annotations（需要从delta中获取）
                if ((delta as any).annotations) {
                  textDelta = convertLinks(textDelta, isFirstChunk)
                }

                isFirstChunk = false
              }

              accumulatedText += textDelta
              controller.enqueue({ type: ChunkType.TEXT_DELTA, text: textDelta })
            }

            // 在流结束时发送完整文本
            if (!isEmpty(choice.finish_reason)) {
              if (accumulatedText) {
                const textCompleteChunk: TextCompleteChunk = {
                  type: ChunkType.TEXT_COMPLETE,
                  text: accumulatedText
                }
                controller.enqueue(textCompleteChunk)
              }
            }
          }
        })
      )

      const adaptedResult: CompletionsOpenAIResult = {
        ...resultFromUpstream,
        stream: standardChunkStream
      }
      // console.log(
      //   `[${MIDDLEWARE_NAME}] Converted mixed stream to standard Chunks using TransformStream.`,
      //   adaptedResult
      // )
      return adaptedResult
    } else {
      console.log(`[${MIDDLEWARE_NAME}] No stream to process or not a ReadableStream. Returning original result.`)
      return resultFromUpstream
    }
  }
