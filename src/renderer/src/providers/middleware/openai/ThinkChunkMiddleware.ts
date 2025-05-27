import { Model } from '@renderer/types'
import { Chunk, ChunkType, ThinkingCompleteChunk, ThinkingDeltaChunk } from '@renderer/types/chunk'
import { isEmpty } from 'lodash'
import OpenAI from 'openai'

import type { CompletionsOpenAIResult, CompletionsParams } from '../../AiProvider'
import { AiProviderMiddlewareCompletionsContext, CompletionsMiddleware } from '../middlewareTypes'

const MIDDLEWARE_NAME = 'ThinkChunkMiddleware'

// 不同模型的思考标签配置（参照 OpenAIProvider 中的定义）
const reasoningTags = [
  { openingTag: '<think>', closingTag: '</think>', separator: '\n' },
  { openingTag: '###Thinking', closingTag: '###Response', separator: '\n' }
]

const getAppropriateTag = (model?: Model) => {
  if (model?.id?.includes('qwen3')) return reasoningTags[0]
  // 可以在这里添加更多模型特定的标签配置
  return reasoningTags[0] // 默认使用 <think> 标签
}

/**
 * 处理思考内容的中间件
 * 参照 extractReasoningMiddleware 的逻辑，处理两种 thinking 内容来源：
 * 1. reasoning_content/reasoning 字段中的思考内容
 * 2. 文本流中的思考标签内容（支持不同模型的标签格式）
 *
 * 职责：
 * 1. 识别并提取 reasoning 字段内容，生成 THINKING_DELTA chunks
 * 2. 识别文本流中的思考标签，提取其中内容为 thinking
 * 3. 在适当时机生成 THINKING_COMPLETE chunk
 * 4. 清理处理过的内容，确保下游中间件收到干净的数据
 */

export const ThinkChunkMiddleware: CompletionsMiddleware =
  () => (next) => async (context: AiProviderMiddlewareCompletionsContext, params: CompletionsParams) => {
    const resultFromUpstream = await next(context, params)

    console.log(
      `[${MIDDLEWARE_NAME}] Received result from upstream. Stream is: ${resultFromUpstream.stream ? 'present' : 'absent'}`
    )

    // 检查是否启用reasoning
    const enableReasoning = params._internal?.enableReasoning || false
    if (!enableReasoning) {
      console.log(`[${MIDDLEWARE_NAME}] Reasoning not enabled, passing through unchanged.`)
      return resultFromUpstream
    }

    // 检查是否有流需要处理
    if (resultFromUpstream.stream && resultFromUpstream.stream instanceof ReadableStream) {
      const inputStream = resultFromUpstream.stream as ReadableStream<
        Chunk | OpenAI.Chat.Completions.ChatCompletionChunk
      >

      // 获取当前模型的思考标签配置
      const reasoningTag = getAppropriateTag(context.model)
      const { openingTag, closingTag } = reasoningTag

      console.log(
        `[${MIDDLEWARE_NAME}] Using reasoning tags: ${openingTag} ... ${closingTag} for model: ${context.model?.id}`
      )

      // thinking 处理状态
      let thinkingContent = ''
      let timeFirstTokenMillsec = 0
      let isFirstNonThinkingChunk = true

      // 标签处理状态（参照 extractReasoningMiddleware）
      // const isInThinkTag = false
      // const textBuffer = ''

      const processedStream = inputStream.pipeThrough(
        new TransformStream<Chunk | OpenAI.Chat.Completions.ChatCompletionChunk, Chunk>({
          transform(item, controller) {
            // 处理已转换的 Chunk
            // 理论上用不到这部分逻辑,因为上流的中间件没有对text和think做处理的
            // if ('type' in item && typeof item.type === 'string') {
            //   const chunk = item as Chunk

            //   // 如果是 TEXT_DELTA chunk，需要检查是否包含思考标签
            //   if (chunk.type === ChunkType.TEXT_DELTA) {
            //     const textDelta = chunk.text
            //     textBuffer += textDelta

            //     // 处理标签内容（优化后的逻辑，参照 extractReasoningMiddleware）
            //     const publishText = (text: string, isThinking: boolean) => {
            //       if (text.length > 0) {
            //         if (isThinking) {
            //           // 生成 THINKING_DELTA chunk
            //           if (timeFirstTokenMillsec === 0) {
            //             timeFirstTokenMillsec = Date.now()
            //           }
            //           thinkingContent += text

            //           const thinkingDeltaChunk: ThinkingDeltaChunk = {
            //             type: ChunkType.THINKING_DELTA,
            //             text: text,
            //             thinking_millsec: Date.now() - timeFirstTokenMillsec
            //           }
            //           controller.enqueue(thinkingDeltaChunk)
            //         } else {
            //           // 处理第一个非thinking内容
            //           if (isFirstNonThinkingChunk && thinkingContent) {
            //             isFirstNonThinkingChunk = false
            //             const thinkingCompleteChunk: ThinkingCompleteChunk = {
            //               type: ChunkType.THINKING_COMPLETE,
            //               text: thinkingContent,
            //               thinking_millsec: Date.now() - timeFirstTokenMillsec
            //             }
            //             controller.enqueue(thinkingCompleteChunk)
            //           }

            //           // 生成 TEXT_DELTA chunk
            //           controller.enqueue({
            //             ...chunk,
            //             text: text
            //           })
            //         }
            //       }
            //     }

            //     // 使用改进的标签处理逻辑
            //     while (true) {
            //       const nextTag = isInThinkTag ? closingTag : openingTag
            //       const startIndex = getPotentialStartIndex(textBuffer, nextTag)

            //       if (startIndex == null) {
            //         // 没有找到标签，发布所有内容
            //         publishText(textBuffer, isInThinkTag)
            //         textBuffer = ''
            //         break
            //       }

            //       // 发布标签前的内容
            //       publishText(textBuffer.slice(0, startIndex), isInThinkTag)

            //       // 检查是否找到完整的标签
            //       const foundFullMatch = startIndex + nextTag.length <= textBuffer.length
            //       if (foundFullMatch) {
            //         // 找到完整标签，切换状态
            //         textBuffer = textBuffer.slice(startIndex + nextTag.length)
            //         isInThinkTag = !isInThinkTag
            //       } else {
            //         // 只找到部分标签，保留剩余内容等待下一个chunk
            //         textBuffer = textBuffer.slice(startIndex)
            //         break
            //       }
            //     }
            //   } else {
            //     // 其他类型的 chunk 直接传递
            //     // 但需要检查是否是工具调用相关的 chunk，也要触发 THINKING_COMPLETE
            //     if (
            //       (chunk.type === ChunkType.MCP_TOOL_IN_PROGRESS ||
            //         chunk.type === ChunkType.EXTERNEL_TOOL_IN_PROGRESS) &&
            //       isFirstNonThinkingChunk &&
            //       thinkingContent
            //     ) {
            //       isFirstNonThinkingChunk = false
            //       const thinkingCompleteChunk: ThinkingCompleteChunk = {
            //         type: ChunkType.THINKING_COMPLETE,
            //         text: thinkingContent,
            //         thinking_millsec: Date.now() - timeFirstTokenMillsec
            //       }
            //       controller.enqueue(thinkingCompleteChunk)
            //     }

            //     controller.enqueue(chunk)
            //   }
            //   return
            // }

            // 处理 SDK chunk
            const sdkChunk = item as OpenAI.Chat.Completions.ChatCompletionChunk
            const delta = sdkChunk.choices?.[0]?.delta

            if (!delta) {
              controller.enqueue(sdkChunk as any)
              return
            }

            // 处理 reasoning 字段中的思考内容
            const reasoningText = (delta as any)?.reasoning_content || (delta as any)?.reasoning
            if (reasoningText) {
              if (timeFirstTokenMillsec === 0) {
                timeFirstTokenMillsec = Date.now()
              }
              thinkingContent += reasoningText

              // 生成 THINKING_DELTA chunk
              const thinkingDeltaChunk: ThinkingDeltaChunk = {
                type: ChunkType.THINKING_DELTA,
                text: reasoningText,
                thinking_millsec: Date.now() - timeFirstTokenMillsec
              }
              controller.enqueue(thinkingDeltaChunk)
              return // reasoning chunks 不传递原始 SDK chunk
            }

            // 处理第一个非thinking内容
            if (delta.content && isFirstNonThinkingChunk && thinkingContent) {
              isFirstNonThinkingChunk = false
              const thinkingCompleteChunk: ThinkingCompleteChunk = {
                type: ChunkType.THINKING_COMPLETE,
                text: thinkingContent,
                thinking_millsec: Date.now() - timeFirstTokenMillsec
              }
              controller.enqueue(thinkingCompleteChunk)
            }

            // 处理 tool_calls 时也需要触发 THINKING_COMPLETE
            if (delta.tool_calls && isFirstNonThinkingChunk && thinkingContent) {
              isFirstNonThinkingChunk = false
              const thinkingCompleteChunk: ThinkingCompleteChunk = {
                type: ChunkType.THINKING_COMPLETE,
                text: thinkingContent,
                thinking_millsec: Date.now() - timeFirstTokenMillsec
              }
              controller.enqueue(thinkingCompleteChunk)
            }

            // 处理结束标记
            const finishReason = sdkChunk.choices?.[0]?.finish_reason
            if (!isEmpty(finishReason) && thinkingContent && isFirstNonThinkingChunk) {
              const thinkingCompleteChunk: ThinkingCompleteChunk = {
                type: ChunkType.THINKING_COMPLETE,
                text: thinkingContent,
                thinking_millsec: Date.now() - timeFirstTokenMillsec
              }
              controller.enqueue(thinkingCompleteChunk)
            }

            // 清理 reasoning 字段后传递给下游
            // const cleanedChunk: OpenAI.Chat.Completions.ChatCompletionChunk = {
            //   ...sdkChunk,
            //   choices:
            //     sdkChunk.choices?.map((choice) => ({
            //       ...choice,
            //       delta: choice.delta
            //         ? {
            //             ...choice.delta,
            //             reasoning_content: undefined,
            //             reasoning: undefined
            //           }
            //         : choice.delta
            //     })) || []
            // }
            controller.enqueue(sdkChunk)
          }
        })
      )

      const adaptedResult: CompletionsOpenAIResult = {
        ...resultFromUpstream,
        stream: processedStream
      }

      console.log(
        `[${MIDDLEWARE_NAME}] Set up thinking content processing with tag support for model: ${context.model?.id}`
      )
      return adaptedResult
    } else {
      console.log(`[${MIDDLEWARE_NAME}] No stream to process or not a ReadableStream. Returning original result.`)
      return resultFromUpstream
    }
  }
