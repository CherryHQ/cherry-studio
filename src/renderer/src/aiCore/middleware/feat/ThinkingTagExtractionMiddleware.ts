import { loggerService } from '@logger'
import { Model } from '@renderer/types'
import {
  ChunkType,
  TextDeltaChunk,
  ThinkingCompleteChunk,
  ThinkingDeltaChunk,
  ThinkingStartChunk
} from '@renderer/types/chunk'
import { TagConfig, TagExtractor } from '@renderer/utils/tagExtraction'

import { CompletionsParams, CompletionsResult, GenericChunk } from '../schemas'
import { CompletionsContext, CompletionsMiddleware } from '../types'

const logger = loggerService.withContext('ThinkingTagExtractionMiddleware')

export const MIDDLEWARE_NAME = 'ThinkingTagExtractionMiddleware'

// 不同模型的思考标签配置
const reasoningTags: TagConfig[] = [
  { openingTag: '<think>', closingTag: '</think>', separator: '\n' },
  { openingTag: '<thought>', closingTag: '</thought>', separator: '\n' },
  { openingTag: '###Thinking', closingTag: '###Response', separator: '\n' },
  { openingTag: '◁think▷', closingTag: '◁/think▷', separator: '\n' },
  { openingTag: '<thinking>', closingTag: '</thinking>', separator: '\n' }
]

const getAppropriateTag = (model?: Model): TagConfig => {
  if (model?.id?.includes('qwen3')) return reasoningTags[0]
  if (model?.id?.includes('gemini-2.5')) return reasoningTags[1]
  if (model?.id?.includes('kimi-vl-a3b-thinking')) return reasoningTags[3]
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
export const ThinkingTagExtractionMiddleware: CompletionsMiddleware =
  () =>
  (next) =>
  async (context: CompletionsContext, params: CompletionsParams): Promise<CompletionsResult> => {
    // 调用下游中间件
    const result = await next(context, params)

    // 响应后处理：处理思考标签提取
    if (result.stream) {
      const resultFromUpstream = result.stream as ReadableStream<GenericChunk>

      // 检查是否有流需要处理
      if (resultFromUpstream && resultFromUpstream instanceof ReadableStream) {
        // 获取当前模型的思考标签配置
        const model = params.assistant?.model
        const reasoningTag = getAppropriateTag(model)

        // 创建标签提取器
        const tagExtractor = new TagExtractor(reasoningTag)

        // thinking 处理状态
        let hasThinkingContent = false
        let thinkingStartTime = 0

        let isFirstTextChunk = true
        let accumulatedThinkingContent = ''
        const processedStream = resultFromUpstream.pipeThrough(
          new TransformStream<GenericChunk, GenericChunk>({
            transform(chunk: GenericChunk, controller) {
              logger.silly('chunk', chunk)
              if (chunk.type === ChunkType.TEXT_DELTA) {
                const textChunk = chunk as TextDeltaChunk

                // 使用 TagExtractor 处理文本
                const extractionResults = tagExtractor.processText(textChunk.text)

                for (const extractionResult of extractionResults) {
                  if (extractionResult.complete && extractionResult.tagContentExtracted?.trim()) {
                    // 生成 THINKING_COMPLETE 事件
                    const thinkingCompleteChunk: ThinkingCompleteChunk = {
                      type: ChunkType.THINKING_COMPLETE,
                      text: extractionResult.tagContentExtracted.trim(),
                      thinking_millsec: thinkingStartTime > 0 ? Date.now() - thinkingStartTime : 0
                    }
                    controller.enqueue(thinkingCompleteChunk)

                    // 重置思考状态
                    hasThinkingContent = false
                    thinkingStartTime = 0
                  } else if (extractionResult.content.length > 0) {
                    if (extractionResult.isTagContent) {
                      // 第一次接收到思考内容时记录开始时间
                      if (!hasThinkingContent) {
                        hasThinkingContent = true
                        thinkingStartTime = Date.now()
                        controller.enqueue({
                          type: ChunkType.THINKING_START
                        } as ThinkingStartChunk)
                      }

                      if (extractionResult.content?.trim()) {
                        accumulatedThinkingContent += extractionResult.content.trim()
                        const thinkingDeltaChunk: ThinkingDeltaChunk = {
                          type: ChunkType.THINKING_DELTA,
                          text: accumulatedThinkingContent,
                          thinking_millsec: thinkingStartTime > 0 ? Date.now() - thinkingStartTime : 0
                        }
                        controller.enqueue(thinkingDeltaChunk)
                      }
                    } else {
                      if (isFirstTextChunk) {
                        controller.enqueue({
                          type: ChunkType.TEXT_START
                        })
                        isFirstTextChunk = false
                      }
                      // 发送清理后的文本内容
                      const cleanTextChunk: TextDeltaChunk = {
                        ...textChunk,
                        text: extractionResult.content
                      }
                      controller.enqueue(cleanTextChunk)
                    }
                  }
                }
              } else if (chunk.type !== ChunkType.TEXT_START) {
                // 其他类型的chunk直接传递（包括 THINKING_DELTA, THINKING_COMPLETE 等）
                controller.enqueue(chunk)
              }
            },
            flush(controller) {
              // 处理可能剩余的思考内容
              const finalResult = tagExtractor.finalize()
              if (finalResult?.tagContentExtracted) {
                const thinkingCompleteChunk: ThinkingCompleteChunk = {
                  type: ChunkType.THINKING_COMPLETE,
                  text: finalResult.tagContentExtracted,
                  thinking_millsec: thinkingStartTime > 0 ? Date.now() - thinkingStartTime : 0
                }
                controller.enqueue(thinkingCompleteChunk)
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
        logger.warn(`[${MIDDLEWARE_NAME}] No generic chunk stream to process or not a ReadableStream.`)
      }
    }
    return result
  }
