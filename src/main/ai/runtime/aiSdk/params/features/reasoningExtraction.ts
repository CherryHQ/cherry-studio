import { extractReasoningMiddleware } from 'ai'

import { definePlugin } from '@cherrystudio/ai-core'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { getReasoningTagName } from '../../../../utils/reasoning'
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

/**
 * Must run BEFORE simulateStreaming so that after `wrapLanguageModel`
 * reverses the middleware chain, extractReasoning wraps simulateStreaming
 * and resolves unclosed `<think>` tags produced by the simulated stream.
 *
 * Applies to `openai-chat-completions` and Ollama. Chat-completions has no native reasoning field;
 * Ollama supports one, but custom model templates can still emit inline `<tag>…</tag>` text. Native
 * Ollama reasoning remains separate and passes through untouched. Other native-reasoning endpoints
 * (anthropic-messages / google / openai-responses) are left untouched, so literal tags stay content.
 */
export const reasoningExtractionFeature: RequestFeature = {
  name: 'reasoning-extraction',
  applies: (scope) =>
    scope.endpointType === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS || scope.endpointType === ENDPOINT_TYPE.OLLAMA_CHAT,
  contributeModelAdapters: (scope) => [
    createReasoningExtractionPlugin({ tagName: getReasoningTagName(scope.model.id.toLowerCase()) })
  ]
}
