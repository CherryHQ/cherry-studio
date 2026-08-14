import { definePlugin } from '@cherrystudio/ai-core'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { extractReasoningMiddleware } from 'ai'

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
 * Applies only on the `openai-chat-completions` wire. That wire has no native reasoning field, so a
 * reasoning model served over it emits its chain inline as `<tag>…</tag>` in the
 * text channel — this covers third-party models behind a bespoke-family gateway
 * (e.g. AiHubMix's compat route) and native chat-completions providers
 * (groq, mistral, …) alike. Endpoints with a native
 * reasoning channel (anthropic-messages / google / openai-responses) are left
 * untouched, so a literal `<tag>` there stays real content.
 */
export const reasoningExtractionFeature: RequestFeature = {
  name: 'reasoning-extraction',
  applies: (scope) => scope.endpointType === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  contributeModelAdapters: (scope) => [
    createReasoningExtractionPlugin({ tagName: getReasoningTagName(scope.model.id.toLowerCase()) })
  ]
}
