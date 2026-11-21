import type { LanguageModelMiddleware } from 'ai'

import { definePlugin } from '@cherrystudio/ai-core'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import type { RequestFeature } from '../feature'

/**
 * Chat Completions routes behind some gateways validate `content` as a plain string.
 * The adapter only emits a string for a single text part, so collapse text-only user
 * messages (e.g. injected knowledge-base / skill parts) into one text part.
 */
export function createFlattenTextContentMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',

    transformParams: async ({ params }) => {
      if (!Array.isArray(params.prompt)) return params
      return {
        ...params,
        prompt: params.prompt.map((message) => {
          if (message.role !== 'user' || message.content.length < 2) return message
          if (!message.content.every((part) => part.type === 'text')) return message
          const text = message.content.map((part) => (part as { text: string }).text).join('\n\n')
          return { ...message, content: [{ type: 'text' as const, text }] }
        })
      }
    }
  }
}

const createFlattenTextContentPlugin = () =>
  definePlugin({
    name: 'flatten-text-content',
    enforce: 'pre',

    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(createFlattenTextContentMiddleware())
    }
  })

export const flattenTextContentFeature: RequestFeature = {
  name: 'flatten-text-content',
  applies: (scope) => scope.endpointType === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  contributeModelAdapters: () => [createFlattenTextContentPlugin()]
}
