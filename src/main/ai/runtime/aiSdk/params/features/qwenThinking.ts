import type { LanguageModelMiddleware } from 'ai'

import { definePlugin } from '@cherrystudio/ai-core'

import { type ReasoningControl, resolveCallReasoning } from '../reasoningControl'
import { createRequestReasoningControl } from './reasoningControl'

/**
 * Qwen Thinking Middleware
 * Controls thinking mode for Qwen models on providers that don't support enable_thinking parameter (like Ollama)
 * Appends '/think' or '/no_think' suffix to user messages based on reasoning_effort setting
 *
 * NOTE: Qwen3.5 does not officially support the soft switch of Qwen3, i.e., /think and /nothink.
 *
 * @param control - Registry contract and request baseline, resolved independently for each call.
 * @returns LanguageModelMiddleware
 */
function createQwenThinkingMiddleware(control: ReasoningControl): LanguageModelMiddleware {
  return {
    specificationVersion: 'v4',

    transformParams: async ({ params }) => {
      const reasoning = resolveCallReasoning(control, params)
      if (reasoning.kind === 'omit') return params
      const suffix = reasoning.kind === 'off' ? ' /no_think' : ' /think'
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

const createQwenThinkingPlugin = (control: ReasoningControl) =>
  definePlugin({
    name: 'qwen-thinking',
    enforce: 'pre',

    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(createQwenThinkingMiddleware(control))
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
    !isOllamaProvider(scope.provider) &&
    isSupportedThinkingTokenQwenModel(scope.model) &&
    !isQwen35to39Model(scope.model) &&
    !isSupportEnableThinkingProvider(scope.provider),
  contributeModelAdapters: (scope) => [createQwenThinkingPlugin(createRequestReasoningControl(scope))]
}
