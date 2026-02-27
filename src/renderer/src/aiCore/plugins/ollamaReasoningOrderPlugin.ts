import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { definePlugin } from '@cherrystudio/ai-core'
import type { LanguageModelMiddleware } from 'ai'

/**
 * Ollama Reasoning Order Middleware
 * Reorders reasoning chunks to always appear before text chunks (Issue #12642)
 * @returns LanguageModelMiddleware
 */
function createOllamaReasoningOrderMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
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
      let bufferedText: LanguageModelV3StreamPart[] = []
      // Track IDs of text parts whose text-start is still in the buffer and not yet emitted
      // downstream. text-delta/text-end for these parts must also be buffered to prevent the AI
      // SDK from receiving a text-delta before the corresponding text-start is registered.
      const bufferedTextPartIds = new Set<string>()

      const flushBufferedText = (controller: TransformStreamDefaultController<LanguageModelV3StreamPart>) => {
        if (bufferedText.length === 0) {
          return
        }
        for (const part of bufferedText) {
          controller.enqueue(part)
        }
        bufferedText = []
        bufferedTextPartIds.clear()
      }

      const endActiveReasoning = (controller: TransformStreamDefaultController<LanguageModelV3StreamPart>) => {
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
          new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
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
                return
              }

              if (chunk.type === 'reasoning-end') {
                isActiveReasoning = false
                controller.enqueue(chunk)
                flushBufferedText(controller)
                return
              }

              // End reasoning before text starts
              if (chunk.type === 'text-start') {
                endActiveReasoning(controller)
                if (!hasReasoning) {
                  bufferedTextPartIds.add(chunk.id)
                  bufferedText.push(chunk)
                  return
                }
                flushBufferedText(controller)
                controller.enqueue(chunk)
                return
              }

              if (chunk.type === 'text-delta' || chunk.type === 'text-end') {
                if (bufferedTextPartIds.has(chunk.id)) {
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

export const createOllamaReasoningOrderPlugin = () =>
  definePlugin({
    name: 'ollamaReasoningOrder',
    enforce: 'pre',

    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(createOllamaReasoningOrderMiddleware())
    }
  })
