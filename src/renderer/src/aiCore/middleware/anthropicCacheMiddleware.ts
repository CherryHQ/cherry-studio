/**
 * Anthropic Prompt Caching Middleware
 * @see https://ai-sdk.dev/providers/ai-sdk-providers/anthropic#cache-control
 */
import { estimateTextTokens } from '@renderer/services/TokenService'
import type { Provider } from '@renderer/types'
import type { LanguageModelMiddleware } from 'ai'

const cacheProviderOptions = {
  anthropic: { cacheControl: { type: 'ephemeral' } }
}

function estimateContentTokens(content: unknown): number {
  if (typeof content === 'string') return estimateTextTokens(content)
  if (Array.isArray(content)) {
    return content.reduce((acc, part) => {
      if (typeof part === 'object' && part !== null && 'text' in part) {
        return acc + estimateTextTokens(part.text as string)
      }
      return acc
    }, 0)
  }
  return 0
}

function addCacheToContentParts(content: unknown): unknown {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content, providerOptions: cacheProviderOptions }]
  }
  if (Array.isArray(content) && content.length > 0) {
    const result = [...content]
    const last = result[result.length - 1]
    if (typeof last === 'object' && last !== null) {
      result[result.length - 1] = { ...last, providerOptions: cacheProviderOptions }
    }
    return result
  }
  return content
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
          const msg = messages[i] as any
          if (msg.role === 'system' && estimateContentTokens(msg.content) >= tokenThreshold) {
            messages[i] = { ...msg, providerOptions: cacheProviderOptions }
            break
          }
        }
      }

      // Cache last N non-system messages (providerOptions on content parts)
      if (cacheLastNMessages > 0) {
        for (let i = messages.length - 1; i >= 0 && cachedCount < cacheLastNMessages; i--) {
          const msg = messages[i] as any
          if (msg.role !== 'system' && estimateContentTokens(msg.content) >= tokenThreshold) {
            messages[i] = { ...msg, content: addCacheToContentParts(msg.content) }
            cachedCount++
          }
        }
      }

      return { ...params, prompt: messages }
    }
  }
}
