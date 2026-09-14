import type { LanguageModelMiddleware } from 'ai'

import { definePlugin } from '@cherrystudio/ai-core'
import { matchesPreset } from '@shared/utils/provider'
import { SystemProviderIds } from '@shared/utils/systemProviderId'

import type { RequestFeature } from '../feature'

/**
 * The HuggingFace router 400s on any reasoning input item, so replayed assistant
 * turns must drop their reasoning parts — the same outcome @ai-sdk/huggingface
 * produced by discarding them, minus the tool-history loss.
 */
export function createStripReasoningReplayMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',

    transformParams: async ({ params }) => {
      if (!Array.isArray(params.prompt)) return params
      return {
        ...params,
        prompt: params.prompt.map((message) => {
          if (message.role !== 'assistant') return message
          const content = message.content.filter((part) => part.type !== 'reasoning')
          return content.length === message.content.length ? message : { ...message, content }
        })
      }
    }
  }
}

const createStripReasoningReplayPlugin = () =>
  definePlugin({
    name: 'strip-reasoning-replay',
    enforce: 'pre',

    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(createStripReasoningReplayMiddleware())
    }
  })

/** Providers whose Responses endpoint rejects reasoning input items. */
export const stripReasoningReplayFeature: RequestFeature = {
  name: 'strip-reasoning-replay',
  applies: (scope) =>
    scope.aiSdkProviderId === 'open-responses' && matchesPreset(scope.provider, SystemProviderIds.huggingface),
  contributeModelAdapters: () => [createStripReasoningReplayPlugin()]
}
