/**
 * Anthropic Prompt Caching Middleware
 * @see https://ai-sdk.dev/providers/ai-sdk-providers/anthropic#cache-control
 */
import type { LanguageModelV2Message } from '@ai-sdk/provider'
import { estimateTextTokens } from '@renderer/services/TokenService'
import type { Provider } from '@renderer/types'
import type { LanguageModelMiddleware } from 'ai'

const cacheProviderOptions = {
  anthropic: { cacheControl: { type: 'ephemeral' } }
}

function estimateContentTokens(content: LanguageModelV2Message['content']): number {
  if (typeof content === 'string') return estimateTextTokens(content)
  if (Array.isArray(content)) {
    return content.reduce((acc, part) => {
      if (part.type === 'text') {
        return acc + estimateTextTokens(part.text as string)
      }
      return acc
    }, 0)
  }
  return 0
}

export function anthropicCacheMiddleware(provider: Provider): LanguageModelMiddleware {
  return {
    middlewareVersion: 'v2',
    transformParams: async ({ params }) => {
      const settings = provider.anthropicCacheControl
      if (!settings?.tokenThreshold || !Array.isArray(params.prompt) || params.prompt.length === 0) {
        return params
      }

      const { tokenThreshold, cacheSystemMessage, cacheLastNMessages } = settings
      const messages = [...params.prompt]
      let cachedCount = 0

      // Cache system message (providerOptions on message object)
      if (cacheSystemMessage) {
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i] as LanguageModelV2Message
          if (msg.role === 'system' && estimateContentTokens(msg.content) >= tokenThreshold) {
            messages[i] = { ...msg, providerOptions: cacheProviderOptions }
            break
          }
        }
      }

      // Cache last N non-system messages (providerOptions on content parts)
      if (cacheLastNMessages > 0) {
        const cumsumTokens = [] as Array<number>
        let tokenSum = 0 as number
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i] as LanguageModelV2Message
          tokenSum += estimateContentTokens(msg.content)
          cumsumTokens.push(tokenSum)
        }

        for (let i = messages.length - 1; i >= 0 && cachedCount < cacheLastNMessages; i--) {
          const msg = messages[i] as LanguageModelV2Message
          if (msg.role === 'system' || cumsumTokens[i] < tokenThreshold || msg.content.length === 0) {
            continue
          }

          const newContent = [...msg.content]
          const lastIndex = newContent.length - 1
          newContent[lastIndex] = {
            ...newContent[lastIndex],
            providerOptions: cacheProviderOptions
          }

          messages[i] = {
            ...msg,
            content: newContent
          } as LanguageModelV2Message
          cachedCount++
        }
      }

      return { ...params, prompt: messages }
    }
  }
}
