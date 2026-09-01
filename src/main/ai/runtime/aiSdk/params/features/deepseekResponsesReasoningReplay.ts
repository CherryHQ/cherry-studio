import type { LanguageModelMiddleware } from 'ai'

import { definePlugin } from '@cherrystudio/ai-core'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { isDeepSeekModel } from '@shared/utils/model'

import type { RequestFeature } from '../feature'

/**
 * DeepSeek's Responses dialect requires reasoning passed back on replayed
 * assistant turns ("must be passed back to the API", #18150). Gateway clients
 * echo reasoning as plain text, which `@ai-sdk/openai` would otherwise drop
 * ("Non-OpenAI reasoning parts"). Tag those parts so the patched serializer
 * emits them as raw `reasoning_text` content; parts that already carry an
 * OpenAI `itemId`/`reasoningEncryptedContent` keep their native round-trip.
 */
function createDeepseekResponsesReasoningReplayMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',

    transformParams: async ({ params }) => {
      if (!Array.isArray(params.prompt)) return params
      return {
        ...params,
        prompt: params.prompt.map((message) => {
          if (message.role !== 'assistant') return message
          return {
            ...message,
            content: message.content.map((part) => {
              if (part.type !== 'reasoning') return part
              const openai = part.providerOptions?.openai
              if (openai?.itemId != null || openai?.reasoningEncryptedContent != null) return part
              return {
                ...part,
                providerOptions: {
                  ...part.providerOptions,
                  openai: { ...openai, rawReasoningContent: true }
                }
              }
            })
          }
        })
      }
    }
  }
}

export const createDeepseekResponsesReasoningReplayPlugin = () =>
  definePlugin({
    name: 'deepseek-responses-reasoning-replay',
    enforce: 'pre',

    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(createDeepseekResponsesReasoningReplayMiddleware())
    }
  })

/** Replay reasoning to DeepSeek-style Responses endpoints as raw reasoning_text. */
export const deepseekResponsesReasoningReplayFeature: RequestFeature = {
  name: 'deepseek-responses-reasoning-replay',
  applies: (scope) => scope.endpointType === ENDPOINT_TYPE.OPENAI_RESPONSES && isDeepSeekModel(scope.model),
  contributeModelAdapters: () => [createDeepseekResponsesReasoningReplayPlugin()]
}
