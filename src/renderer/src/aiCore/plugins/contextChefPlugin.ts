/**
 * Context Chef Plugin
 * Intelligent context management via @context-chef/ai-sdk-middleware.
 * Provides transparent history compression, tool result truncation,
 * and mechanical compaction of old tool-result/thinking content.
 */
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { definePlugin } from '@cherrystudio/ai-core'
import { createMiddleware } from '@context-chef/ai-sdk-middleware'

const DEFAULT_CONTEXT_WINDOW = 128_000

export interface ContextChefPluginOptions {
  /** Resolved LanguageModelV3 used for compression summarization */
  languageModel: LanguageModelV3
  /** Model's context window size in tokens. Defaults to 128K */
  contextWindow?: number
}

export const createContextChefPlugin = (options: ContextChefPluginOptions) =>
  definePlugin({
    name: 'contextChef',
    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(
        createMiddleware({
          contextWindow: options.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
          compress: {
            model: options.languageModel,
            preserveRatio: 0.8
          },
          truncate: {
            threshold: 5000,
            headChars: 500,
            tailChars: 1000
          },
          compact: {
            clear: ['tool-result', 'thinking']
          }
        })
      )
    }
  })
