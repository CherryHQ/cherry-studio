import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { generateId, type LanguageModelMiddleware, type ProviderMetadata } from 'ai'

import { definePlugin } from '@cherrystudio/ai-core'
import { SystemProviderIds } from '@shared/utils/systemProviderId'

import type { RequestFeature } from '../feature'

function getReplayMetadata(metadata: ProviderMetadata | undefined): ProviderMetadata | undefined {
  const details = metadata?.openrouter?.reasoning_details
  if (Array.isArray(details) && details.length > 0) {
    return { openrouter: { reasoning_details: details } }
  }
  return undefined
}

/**
 * https://openrouter.ai/docs/docs/best-practices/reasoning-tokens#example-preserving-reasoning-blocks-with-openrouter-and-claude
 *
 * @returns LanguageModelMiddleware - a middleware filter redacted block
 */
export function createOpenrouterReasoningMiddleware(): LanguageModelMiddleware {
  const REDACTED_BLOCK = '[REDACTED]'
  return {
    specificationVersion: 'v3',
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
      if (!content.some((part) => part.type === 'reasoning' || part.type === 'tool-call')) {
        const providerMetadata = getReplayMetadata(rest.providerMetadata)
        if (providerMetadata) modifiedContent.unshift({ type: 'reasoning', text: '', providerMetadata })
      }
      return { content: modifiedContent, ...rest }
    },
    wrapStream: async ({ doStream }) => {
      const { stream, ...rest } = await doStream()
      let hasReplayPart = false
      return {
        stream: stream.pipeThrough(
          new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
            transform(
              chunk: LanguageModelV3StreamPart,
              controller: TransformStreamDefaultController<LanguageModelV3StreamPart>
            ) {
              if (chunk.type === 'reasoning-start' || chunk.type === 'tool-call') hasReplayPart = true
              if (chunk.type === 'finish' && !hasReplayPart && chunk.finishReason.unified !== 'error') {
                const providerMetadata = getReplayMetadata(chunk.providerMetadata)
                if (providerMetadata) {
                  const id = generateId()
                  controller.enqueue({ type: 'reasoning-start', id })
                  controller.enqueue({ type: 'reasoning-end', id, providerMetadata })
                }
              }
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

const createOpenrouterReasoningPlugin = () =>
  definePlugin({
    name: 'openrouter-reasoning',
    enforce: 'pre',

    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(createOpenrouterReasoningMiddleware())
    }
  })

/** Preserve OpenRouter reasoning metadata and remove redaction markers from displayed text. */
export const openrouterReasoningFeature: RequestFeature = {
  name: 'openrouter-reasoning',
  applies: (scope) => scope.provider.id === SystemProviderIds.openrouter,
  contributeModelAdapters: () => [createOpenrouterReasoningPlugin()]
}
