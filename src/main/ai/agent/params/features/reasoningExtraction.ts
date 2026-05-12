import { definePlugin } from '@cherrystudio/ai-core'
import { isAzureOpenAIProvider } from '@shared/utils/provider'
import { extractReasoningMiddleware } from 'ai'

import { getAiSdkProviderId } from '../../../provider/factory'
import { getReasoningTagName } from '../../../utils/reasoning'
import type { RequestFeature } from '../feature'

/**
 * Reasoning Extraction Plugin — extracts inline `<tag>…</tag>` reasoning
 * blocks from the `text` channel into `reasoning-delta` chunks using AI
 * SDK's built-in `extractReasoningMiddleware`.
 *
 * Tag name comes from `getReasoningTagName(modelId)`; the default for
 * unknown models is `<think>`, which covers MiniMax M2, DeepSeek R1, QwQ,
 * Qwen3-thinking, and most openai-compatible thinking models.
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
