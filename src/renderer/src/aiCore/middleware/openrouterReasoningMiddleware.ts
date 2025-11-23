import type { LanguageModelV2StreamPart } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'

/**
 * https://openrouter.ai/docs/docs/best-practices/reasoning-tokens#example-preserving-reasoning-blocks-with-openrouter-and-claude
 *
 * @returns LanguageModelMiddleware - a middleware filter redacted block
 */
export function openrouterReasoningMiddleware(): LanguageModelMiddleware {
  const REDACTED_BLOCK = '[REDACTED]'
  return {
    middlewareVersion: 'v2',
    wrapGenerate: async ({ doGenerate }) => {
      const { content, ...rest } = await doGenerate()
      const modifiedContent = content.map((part) => {
        if (part.type === 'reasoning' && part.text.includes(REDACTED_BLOCK)) {
          return {
            ...part,
            text: part.text.replace(REDACTED_BLOCK, '')
          }
        }
        return part
      })
      return { content: modifiedContent, ...rest }
    },
    wrapStream: async ({ doStream }) => {
      const { stream, ...rest } = await doStream()
      return {
        stream: stream.pipeThrough(
          new TransformStream<LanguageModelV2StreamPart, LanguageModelV2StreamPart>({
            transform(
              chunk: LanguageModelV2StreamPart,
              controller: TransformStreamDefaultController<LanguageModelV2StreamPart>
            ) {
              if (chunk.type === 'reasoning-delta' && chunk.delta.includes(REDACTED_BLOCK)) {
                controller.enqueue({
                  ...chunk,
                  delta: chunk.delta.replace(REDACTED_BLOCK, '')
                })
              } else {
                controller.enqueue(chunk)
              }
            }
          })
        ),
        ...rest
      }
    }
  }
}
