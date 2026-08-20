import { definePlugin } from '@cherrystudio/ai-core'
import { matchesPreset } from '@shared/utils/provider'
import { SystemProviderIds } from '@shared/utils/systemProviderId'
import type { LanguageModelMiddleware } from 'ai'

import type { RequestFeature } from '../feature'
import { ARK_REASONING_REPLAY_MODEL } from './stripReasoningReplay'

/**
 * Ark's stateless thinking passback: request `include:
 * ['reasoning.encrypted_content']` so reasoning output items carry
 * `encrypted_content`, which the persistence layer round-trips via
 * `providerMetadata.openai.reasoningEncryptedContent` and the patched
 * open-responses converter replays. The doc marks this as required for
 * agent multi-turn quality when `previous_response_id` is not used.
 */
export function createArkEncryptedReasoningMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',

    transformParams: async ({ params }) => {
      const openai = params.providerOptions?.openai
      return {
        ...params,
        providerOptions: {
          ...params.providerOptions,
          openai: { ...openai, include: ['reasoning.encrypted_content'] }
        }
      }
    }
  }
}

const createArkEncryptedReasoningPlugin = () =>
  definePlugin({
    name: 'ark-encrypted-reasoning',
    enforce: 'pre',

    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(createArkEncryptedReasoningMiddleware())
    }
  })

/** Ark seed-2.x models on the open-responses family (encrypted_content支持 seed-2-0-lite-260428+). */
export const arkEncryptedReasoningFeature: RequestFeature = {
  name: 'ark-encrypted-reasoning',
  applies: (scope) =>
    scope.aiSdkProviderId === 'open-responses' &&
    matchesPreset(scope.provider, SystemProviderIds.doubao) &&
    ARK_REASONING_REPLAY_MODEL.test(scope.model.apiModelId ?? scope.model.id),
  contributeModelAdapters: () => [createArkEncryptedReasoningPlugin()]
}
