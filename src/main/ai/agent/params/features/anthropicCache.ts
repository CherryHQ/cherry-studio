/**
 * Anthropic Prompt Caching Middleware
 *
 * Adds `providerOptions.anthropic.cacheControl = { type: 'ephemeral' }` markers
 * on qualifying system / trailing messages so Anthropic-compatible providers
 * re-use the prefix KV cache.
 *
 * @see https://ai-sdk.dev/providers/ai-sdk-providers/anthropic#cache-control
 */

import type { LanguageModelV3Message } from '@ai-sdk/provider'
import { definePlugin } from '@cherrystudio/ai-core'
import type { Provider } from '@shared/data/types/provider'
import type { LanguageModelMiddleware } from 'ai'
import { estimateTokenCount } from 'tokenx'

const cacheProviderOptions = {
  anthropic: { cacheControl: { type: 'ephemeral' } }
}

function estimateContentTokens(content: LanguageModelV3Message['content']): number {
  if (typeof content === 'string') return estimateTokenCount(content)
  if (Array.isArray(content)) {
    return content.reduce((acc, part) => {
      if (part.type === 'text') {
        return acc + estimateTokenCount(part.text)
      }
      return acc
    }, 0)
  }
  return 0
}

function anthropicCacheMiddleware(provider: Provider): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => {
      const settings = provider.settings?.cacheControl
      if (!settings?.enabled || !settings.tokenThreshold) return params
      if (!Array.isArray(params.prompt) || params.prompt.length === 0) return params

      const { tokenThreshold, cacheSystemMessage, cacheLastNMessages } = settings
      const messages = [...params.prompt]
      let cachedCount = 0

      if (cacheSystemMessage) {
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i]
          if (msg.role === 'system' && estimateContentTokens(msg.content) >= tokenThreshold) {
            messages[i] = { ...msg, providerOptions: cacheProviderOptions }
            break
          }
        }
      }

      if (cacheLastNMessages && cacheLastNMessages > 0) {
        const cumsumTokens: number[] = []
        let tokenSum = 0
        for (let i = 0; i < messages.length; i++) {
          tokenSum += estimateContentTokens(messages[i].content)
          cumsumTokens.push(tokenSum)
        }

        for (let i = messages.length - 1; i >= 0 && cachedCount < cacheLastNMessages; i--) {
          const msg = messages[i]
          if (msg.role === 'system' || cumsumTokens[i] < tokenThreshold || msg.content.length === 0) {
            continue
          }
          const newContent = [...msg.content]
          const lastIndex = newContent.length - 1
          newContent[lastIndex] = {
            ...newContent[lastIndex],
            providerOptions: cacheProviderOptions
          }
          messages[i] = { ...msg, content: newContent } as LanguageModelV3Message
          cachedCount++
        }
      }

      return { ...params, prompt: messages }
    }
  }
}

// TODO: use context manager replace middleware
function createAnthropicCachePlugin(provider: Provider) {
  return definePlugin({
    name: 'anthropicCache',
    enforce: 'pre',
    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(anthropicCacheMiddleware(provider))
    }
  })
}

import type { RequestFeature } from '../feature'

/** Gated on provider-level cacheControl settings. */
export const anthropicCacheFeature: RequestFeature = {
  name: 'anthropic-cache',
  applies: (scope) =>
    Boolean(scope.provider.settings?.cacheControl?.enabled && scope.provider.settings.cacheControl.tokenThreshold),
  contributeModelAdapters: (scope) => [createAnthropicCachePlugin(scope.provider)]
}
