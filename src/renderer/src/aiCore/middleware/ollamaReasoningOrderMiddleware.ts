import type { LanguageModelV2StreamPart } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'

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
      let isActiveReasoning = false
      let reasoningId: string | undefined
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

      const endActiveReasoning = (controller: TransformStreamDefaultController<LanguageModelV2StreamPart>) => {
        if (isActiveReasoning) {
          controller.enqueue({
            type: 'reasoning-end',
            id: reasoningId ?? 'reasoning-0'
          })
          isActiveReasoning = false
        }
      }

      return {
        stream: stream.pipeThrough(
          new TransformStream<LanguageModelV2StreamPart, LanguageModelV2StreamPart>({
            transform(chunk, controller) {
              if (chunk.type === 'reasoning-start') {
                hasReasoning = true
                isActiveReasoning = true
                reasoningId = chunk.id
                controller.enqueue(chunk)
                flushBufferedText(controller)
                return
              }

              if (chunk.type === 'reasoning-delta') {
                hasReasoning = true
                controller.enqueue(chunk)
                flushBufferedText(controller)
                return
              }

              if (chunk.type === 'reasoning-end') {
                isActiveReasoning = false
                controller.enqueue(chunk)
                return
              }

              // End reasoning before text starts
              if (chunk.type === 'text-start') {
                endActiveReasoning(controller)
                if (!hasReasoning) {
                  bufferedText.push(chunk)
                  return
                }
                controller.enqueue(chunk)
                return
              }

              if (chunk.type === 'text-delta' || chunk.type === 'text-end') {
                if (!hasReasoning) {
                  bufferedText.push(chunk)
                  return
                }
                controller.enqueue(chunk)
                return
              }

              // End reasoning before tool calls
              if (chunk.type === 'tool-call-start' || chunk.type === 'tool-call') {
                endActiveReasoning(controller)
                controller.enqueue(chunk)
                return
              }

              if (!hasReasoning && (chunk.type === 'finish' || chunk.type === 'error')) {
                flushBufferedText(controller)
              }

              controller.enqueue(chunk)
            },
            flush(controller) {
              endActiveReasoning(controller)
              flushBufferedText(controller)
            }
          })
        ),
        ...rest
      }
    }
  }
}
