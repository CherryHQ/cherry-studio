import { definePlugin } from '@cherrystudio/ai-core'
import { extractReasoningMiddleware } from 'ai'

/**
 * Reasoning Extraction Plugin
 * Extracts reasoning/thinking tags from OpenAI/Azure responses
 * Uses AI SDK's built-in extractReasoningMiddleware
 */
const createReasoningExtractionPlugin = (options: { tagName?: string } = {}) =>
  definePlugin({
    name: 'reasoning-extraction',
    enforce: 'pre',

    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(
        extractReasoningMiddleware({
          tagName: options.tagName || 'thinking'
        })
      )
    }
  })

import { isAzureOpenAIProvider } from '@shared/utils/provider'

import { getAiSdkProviderId } from '../../../provider/factory'
import { getReasoningTagName } from '../../../utils/reasoning'
import type { RequestFeature } from '../feature'

/**
 * For OpenAI-family / Azure-OpenAI providers. Must run BEFORE simulateStreaming
 * so that after `wrapLanguageModel` reverses the middleware chain,
 * extractReasoning wraps simulateStreaming and resolves unclosed <think>
 * tags produced by the simulated stream.
 */
export const reasoningExtractionFeature: RequestFeature = {
  name: 'reasoning-extraction',
  applies: (scope) => {
    const id = getAiSdkProviderId(scope.provider)
    return (
      isAzureOpenAIProvider(scope.provider) ||
      id === 'openai' ||
      id === 'openai-chat' ||
      id === 'openai-response' ||
      id === 'openai-compatible'
    )
  },
  contributeModelAdapters: (scope) => [
    createReasoningExtractionPlugin({ tagName: getReasoningTagName(scope.model.id.toLowerCase()) })
  ]
}
