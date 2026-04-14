/**
 * Anthropic Prompt Caching Middleware
 *
 * Uses a multi-breakpoint strategy to ensure smooth, incremental cache growth
 * across multi-turn conversations AND tool-use loops.
 *
 * Breakpoints (up to 3, Anthropic allows max 4):
 *  1. System message — cache the system prompt
 *  2. Second-to-last input message — reads cache created by the PREVIOUS request
 *  3. Last input message — creates cache for the NEXT request to read
 *
 * @see https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
 */
import type { LanguageModelV3Message } from '@ai-sdk/provider'
import { definePlugin } from '@cherrystudio/ai-core/core/plugins'
import type { AnthropicCacheControlSettings, Provider } from '@renderer/types'
import { isLegacyCacheSettings } from '@renderer/types/provider'
import type { LanguageModelMiddleware } from 'ai'

function makeCacheProviderOptions(ttl?: AnthropicCacheControlSettings['ttl']) {
  const cacheControl =
    ttl === '1h' ? { type: 'ephemeral' as const, ttl: '1h' as const } : { type: 'ephemeral' as const }
  return { anthropic: { cacheControl } }
}

function isInputMessage(msg: LanguageModelV3Message): boolean {
  return msg.role === 'user' || msg.role === 'tool'
}

function addBreakpointToMessage(
  messages: LanguageModelV3Message[],
  index: number,
  cacheOpts: ReturnType<typeof makeCacheProviderOptions>
) {
  const msg = messages[index]
  if (Array.isArray(msg.content) && msg.content.length > 0) {
    const newContent = [...msg.content]
    const lastIdx = newContent.length - 1
    newContent[lastIdx] = { ...newContent[lastIdx], providerOptions: cacheOpts }
    messages[index] = { ...msg, content: newContent } as LanguageModelV3Message
  } else {
    messages[index] = { ...msg, providerOptions: cacheOpts }
  }
}

function anthropicCacheMiddleware(provider: Provider): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => {
      if (!Array.isArray(params.prompt) || params.prompt.length === 0) {
        return params
      }

      const raw = provider.anthropicCacheControl
      const ttl = raw && !isLegacyCacheSettings(raw) ? raw.ttl : undefined
      const cacheOpts = makeCacheProviderOptions(ttl)

      const messages = [...params.prompt]

      // --- Breakpoint 1: System message ---
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role !== 'system') continue
        messages[i] = { ...messages[i], providerOptions: cacheOpts }
        break
      }

      // --- Breakpoints 2 & 3: Last two input messages ---
      const inputIndices: number[] = []
      for (let i = messages.length - 1; i >= 0 && inputIndices.length < 2; i--) {
        if (isInputMessage(messages[i])) {
          inputIndices.push(i)
        }
      }

      // Breakpoint 3: Last input message — creates cache for next request
      if (inputIndices.length >= 1) {
        addBreakpointToMessage(messages, inputIndices[0], cacheOpts)
      }

      // Breakpoint 2: Second-to-last input — reads cache from previous request
      if (inputIndices.length >= 2) {
        addBreakpointToMessage(messages, inputIndices[1], cacheOpts)
      }

      return { ...params, prompt: messages }
    }
  }
}

export const createAnthropicCachePlugin = (provider: Provider) =>
  definePlugin({
    name: 'anthropicCache',
    enforce: 'pre',
    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(anthropicCacheMiddleware(provider))
    }
  })
