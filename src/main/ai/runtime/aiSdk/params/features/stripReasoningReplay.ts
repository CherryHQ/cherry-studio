import { definePlugin } from '@cherrystudio/ai-core'
import { matchesPreset } from '@shared/utils/provider'
import { SystemProviderIds } from '@shared/utils/systemProviderId'
import type { LanguageModelMiddleware } from 'ai'

import type { RequestFeature } from '../feature'

/**
 * Some Responses dialects reject replayed reasoning input items outright:
 * Ark 400s with "Item reasoning is not supported" (pre-seed-2.x) and the HF
 * router 400s on any reasoning item. Strip reasoning parts from replayed
 * assistant turns for those providers — exactly what the retired
 * @ai-sdk/openai path did by dropping metadata-less reasoning.
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

/** Ark generations before seed-2.x reject reasoning items; seed-2.x accepts them (verified live). */
const ARK_REASONING_REPLAY_MODEL = /seed-2|seed-evolving/i

/** Providers whose Responses endpoint rejects reasoning input items. */
export const stripReasoningReplayFeature: RequestFeature = {
  name: 'strip-reasoning-replay',
  applies: (scope) => {
    if (scope.aiSdkProviderId !== 'open-responses') return false
    if (matchesPreset(scope.provider, SystemProviderIds.huggingface)) return true
    return (
      matchesPreset(scope.provider, SystemProviderIds.doubao) &&
      !ARK_REASONING_REPLAY_MODEL.test(scope.model.apiModelId ?? scope.model.id)
    )
  },
  contributeModelAdapters: () => [createStripReasoningReplayPlugin()]
}
