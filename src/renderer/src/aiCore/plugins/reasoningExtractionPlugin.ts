import { definePlugin } from '@cherrystudio/ai-core'
import { extractReasoningMiddleware } from 'ai'

/**
 * Reasoning Extraction Plugin
 * Extracts reasoning/thinking tags from OpenAI/Azure responses
 * Uses AI SDK's built-in extractReasoningMiddleware
 */
export const createReasoningExtractionPlugin = (options: { tagName?: string } = {}) =>
  definePlugin({
    name: 'reasoningExtraction',
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
