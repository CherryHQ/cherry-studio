/**
 * Web Search Plugin
 * Provides unified web-search capability across multiple AI providers.
 */

import { definePlugin } from '../../'
import type { WebSearchPluginConfig } from './helper'
import { DEFAULT_WEB_SEARCH_CONFIG, switchWebSearchTool } from './helper'

/**
 * @param config - Static configuration passed during plugin initialization.
 */
export const webSearchPlugin = (config: WebSearchPluginConfig = DEFAULT_WEB_SEARCH_CONFIG) =>
  definePlugin({
    name: 'webSearch',
    enforce: 'pre',

    transformParams: async (params: any, context) => {
      let { providerId } = context

      // For cherryin providers, extract the actual provider from the model's provider string
      // Expected format: "cherryin.{actualProvider}" (e.g., "cherryin.gemini")
      if (providerId === 'cherryin' || providerId === 'cherryin-chat') {
        const provider = params.model?.provider
        if (provider && typeof provider === 'string' && provider.includes('.')) {
          const extractedProviderId = provider.split('.')[1]
          if (extractedProviderId) {
            providerId = extractedProviderId
          }
        }
      }

      switchWebSearchTool(config, params, { ...context, providerId })
      return params
    }
  })

// Export types for plugin consumers.
export * from './helper'

// Default export for convenience.
export default webSearchPlugin
