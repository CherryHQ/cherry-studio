import { definePlugin } from '@cherrystudio/ai-core'
import type { LanguageModelMiddleware } from 'ai'

/**
 * Qwen Thinking Middleware
 * Controls thinking mode for Qwen models on providers that don't support enable_thinking parameter (like Ollama)
 * Appends '/think' or '/no_think' suffix to user messages based on reasoning_effort setting
 *
 * NOTE: Qwen3.5 does not officially support the soft switch of Qwen3, i.e., /think and /nothink.
 *
 * @param enableThinking - Whether thinking mode is enabled (based on reasoning_effort !== undefined)
 * @returns LanguageModelMiddleware
 */
function createQwenThinkingMiddleware(enableThinking: boolean): LanguageModelMiddleware {
  const suffix = enableThinking ? ' /think' : ' /no_think'

  return {
    specificationVersion: 'v3',

    transformParams: async ({ params }) => {
      const transformedParams = { ...params }
      // Process messages in prompt
      if (transformedParams.prompt && Array.isArray(transformedParams.prompt)) {
        transformedParams.prompt = transformedParams.prompt.map((message) => {
          // Only process user messages
          if (message.role === 'user' && Array.isArray(message.content)) {
            // Map to NEW part objects instead of mutating caller-owned parts in place.
            return {
              ...message,
              content: message.content.map((part) =>
                part.type === 'text' && !part.text.endsWith('/think') && !part.text.endsWith('/no_think')
                  ? { ...part, text: part.text + suffix }
                  : part
              )
            }
          }
          return message
        })
      }

      return transformedParams
    }
  }
}

const createQwenThinkingPlugin = (enableThinking: boolean) =>
  definePlugin({
    name: 'qwen-thinking',
    enforce: 'pre',

    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(createQwenThinkingMiddleware(enableThinking))
    }
  })

import { isQwen35to39Model, isSupportedThinkingTokenQwenModel } from '@shared/utils/model'
import { isOllamaProvider, isSupportEnableThinkingProvider } from '@shared/utils/provider'

import type { RequestFeature } from '../feature'

/** Qwen thinking toggle for providers that don't support the native
 *  `enable_thinking` parameter (e.g. non-Ollama Qwen serving). */
export const qwenThinkingFeature: RequestFeature = {
  name: 'qwen-thinking',
  applies: (scope) =>
    Boolean(scope.assistant) &&
    !isOllamaProvider(scope.provider) &&
    isSupportedThinkingTokenQwenModel(scope.model) &&
    !isQwen35to39Model(scope.model) &&
    !isSupportEnableThinkingProvider(scope.provider),
  contributeModelAdapters: (scope) => [
    createQwenThinkingPlugin(scope.assistant!.settings?.reasoning_effort !== undefined)
  ]
}
