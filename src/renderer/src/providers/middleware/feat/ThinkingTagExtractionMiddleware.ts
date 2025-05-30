import { Model } from '@renderer/types'
import { ChunkType, TextDeltaChunk, ThinkingCompleteChunk, ThinkingDeltaChunk } from '@renderer/types/chunk'
import { getPotentialStartIndex } from '@renderer/utils/getPotentialIndex'

import { GenericChunk } from '../schemas'
import { CompletionsMiddleware } from '../type'

const MIDDLEWARE_NAME = 'ThinkingTagExtractionMiddleware'

// 不同模型的思考标签配置
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
 * 处理文本流中思考标签提取的中间件
 *
 * 该中间件专门处理文本流中的思考标签内容（如 <think>...</think>）
 * 主要用于 OpenAI 等支持思考标签的 provider
 *
 * 职责：
 * 1. 从文本流中提取思考标签内容
 * 2. 将标签内的内容转换为 THINKING_DELTA chunk
 * 3. 将标签外的内容作为正常文本输出
 * 4. 处理不同模型的思考标签格式
 * 5. 在思考内容结束时生成 THINKING_COMPLETE 事件
 */
export const ThinkingTagExtractionMiddleware: CompletionsMiddleware = async (ctx, next) => {
  // 调用下游中间件
  await next()

  // 响应后处理：处理思考标签提取
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

    // 检查是否是支持思考标签的provider
    const provider = ctx.apiClientInstance?.provider

    if (!provider || provider.type !== 'openai') {
      console.log(
        `[${MIDDLEWARE_NAME}] Provider ${provider} not supported for tag extraction, passing through unchanged.`
      )
      return
    }

    // 检查是否有流需要处理
    if (resultFromUpstream && resultFromUpstream instanceof ReadableStream) {
      // 获取当前模型的思考标签配置
      const model = params.assistant?.model
      const reasoningTag = getAppropriateTag(model)
      const { openingTag, closingTag, separator } = reasoningTag

      console.log(`[${MIDDLEWARE_NAME}] Using reasoning tags: ${openingTag} ... ${closingTag} for model: ${model?.id}`)

      // thinking 处理状态
      let accumulatedThinkingContent = ''
      let hasThinkingContent = false
      let thinkingStartTime = 0

      // 标签提取状态
      let textBuffer = ''
      let isReasoning = false
      let isFirstReasoning = true
      let isFirstText = true
      let afterSwitch = false

      const processedStream = resultFromUpstream.pipeThrough(
        new TransformStream<GenericChunk, GenericChunk>({
          transform(chunk: GenericChunk, controller) {
            if (chunk.type === ChunkType.TEXT_DELTA) {
              const textChunk = chunk as TextDeltaChunk

              // 处理文本流中的思考标签提取
              textBuffer += textChunk.text

              function publishContent(text: string, isThinking: boolean) {
                if (text.length > 0) {
                  const prefix = afterSwitch && (isThinking ? !isFirstReasoning : !isFirstText) ? separator : ''
                  const content = prefix + text

                  if (isThinking) {
                    // 第一次接收到思考内容时记录开始时间
                    if (!hasThinkingContent) {
                      hasThinkingContent = true
                      thinkingStartTime = Date.now()
                    }

                    accumulatedThinkingContent += content

                    const thinkingDeltaChunk: ThinkingDeltaChunk = {
                      type: ChunkType.THINKING_DELTA,
                      text: content,
                      thinking_millsec: thinkingStartTime > 0 ? Date.now() - thinkingStartTime : 0
                    }
                    controller.enqueue(thinkingDeltaChunk)
                    isFirstReasoning = false
                  } else {
                    // 在思考内容结束时生成 THINKING_COMPLETE 事件
                    if (hasThinkingContent && accumulatedThinkingContent) {
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

                    // 发送清理后的文本内容
                    const cleanTextChunk: TextDeltaChunk = {
                      ...textChunk,
                      text: content
                    }
                    controller.enqueue(cleanTextChunk)
                    isFirstText = false
                  }
                  afterSwitch = false
                }
              }

              // 处理标签提取逻辑
              while (true) {
                const nextTag = isReasoning ? closingTag : openingTag
                const startIndex = getPotentialStartIndex(textBuffer, nextTag)

                if (startIndex == null) {
                  publishContent(textBuffer, isReasoning)
                  textBuffer = ''
                  break
                }

                publishContent(textBuffer.slice(0, startIndex), isReasoning)
                const foundFullMatch = startIndex + nextTag.length <= textBuffer.length

                if (foundFullMatch) {
                  textBuffer = textBuffer.slice(startIndex + nextTag.length)
                  isReasoning = !isReasoning
                  afterSwitch = true
                } else {
                  textBuffer = textBuffer.slice(startIndex)
                  break
                }
              }
            } else {
              // 其他类型的chunk直接传递（包括 THINKING_DELTA, THINKING_COMPLETE 等）
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
