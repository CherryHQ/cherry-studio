import type { LanguageModelV2StreamPart } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'

const isReasoningPart = (chunk: LanguageModelV2StreamPart) =>
  chunk.type === 'reasoning-start' || chunk.type === 'reasoning-delta' || chunk.type === 'reasoning-end'

const isTextPart = (chunk: LanguageModelV2StreamPart) =>
  chunk.type === 'text-start' || chunk.type === 'text-delta' || chunk.type === 'text-end'

export function ollamaReasoningOrderMiddleware(): LanguageModelMiddleware {
  return {
    middlewareVersion: 'v2',
    wrapGenerate: async ({ doGenerate }) => {
      const { content, ...rest } = await doGenerate()
      if (!Array.isArray(content)) {
        return { content, ...rest }
      }
      const reasoningParts = content.filter((part) => part.type === 'reasoning')
      if (reasoningParts.length === 0) {
        return { content, ...rest }
      }
      const otherParts = content.filter((part) => part.type !== 'reasoning')
      return { content: [...reasoningParts, ...otherParts], ...rest }
    },
    wrapStream: async ({ doStream }) => {
      const { stream, ...rest } = await doStream()
      let hasReasoning = false
      let bufferedText: LanguageModelV2StreamPart[] = []

      const flushBufferedText = (controller: TransformStreamDefaultController<LanguageModelV2StreamPart>) => {
        if (bufferedText.length === 0) {
          return
        }
        for (const part of bufferedText) {
          controller.enqueue(part)
        }
        bufferedText = []
      }

      return {
        stream: stream.pipeThrough(
          new TransformStream<LanguageModelV2StreamPart, LanguageModelV2StreamPart>({
            transform(chunk, controller) {
              if (isReasoningPart(chunk)) {
                hasReasoning = true
                controller.enqueue(chunk)
                flushBufferedText(controller)
                return
              }

              if (!hasReasoning && isTextPart(chunk)) {
                bufferedText.push(chunk)
                return
              }

              if (!hasReasoning && (chunk.type === 'finish' || chunk.type === 'error')) {
                flushBufferedText(controller)
              }

              controller.enqueue(chunk)
            },
            flush(controller) {
              flushBufferedText(controller)
            }
          })
        ),
        ...rest
      }
    }
  }
}
