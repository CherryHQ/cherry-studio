import { definePlugin } from '@cherrystudio/ai-core'
import type { AppProviderId } from '@main/ai/types'
import { extractReasoningMiddleware } from 'ai'

import { getReasoningTagName } from '../../../utils/reasoning'
import type { RequestFeature } from '../feature'

/**
 * Reasoning Extraction Plugin — extracts inline `<tag>…</tag>` reasoning
 * blocks from the openai-style `text` channel into `reasoning-delta`
 * chunks (using AI SDK's `extractReasoningMiddleware`).
 *
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

const INLINE_REASONING_SDK_PROVIDER_IDS: ReadonlySet<AppProviderId> = new Set([
  'openai',
  'openai-chat',
  'openai-response',
  'openai-compatible',
  'azure',
  'azure-responses'
])

/**
 * Must run BEFORE simulateStreaming so that after `wrapLanguageModel`
 * reverses the middleware chain, extractReasoning wraps simulateStreaming
 * and resolves unclosed `<think>` tags produced by the simulated stream.
 */
export const reasoningExtractionFeature: RequestFeature = {
  name: 'reasoning-extraction',
  applies: (scope) => INLINE_REASONING_SDK_PROVIDER_IDS.has(scope.aiSdkProviderId),
  contributeModelAdapters: (scope) => [
    createReasoningExtractionPlugin({ tagName: getReasoningTagName(scope.model.id.toLowerCase()) })
  ]
}
