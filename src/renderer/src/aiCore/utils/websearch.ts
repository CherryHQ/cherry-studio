import type {
  AnthropicSearchConfig,
  OpenAISearchConfig,
  WebSearchPluginConfig
} from '@cherrystudio/ai-core/core/plugins/built-in/webSearchPlugin/helper'
import type { BaseProviderId } from '@cherrystudio/ai-core/provider'
import { isOpenAIWebSearchChatCompletionOnlyModel } from '@renderer/config/models'
import type { CherryWebSearchConfig } from '@renderer/store/websearch'
import type { Model } from '@renderer/types'
import { mapRegexToPatterns } from '@renderer/utils/blacklistMatchPattern'

export function getWebSearchParams(model: Model): Record<string, any> {
  if (model.provider === 'hunyuan') {
    return { enable_enhancement: true, citation: true, search_info: true }
  }

  if (model.provider === 'dashscope') {
    return {
      enable_search: true,
      search_options: {
        forced_search: true
      }
    }
  }

  if (isOpenAIWebSearchChatCompletionOnlyModel(model)) {
    return {
      web_search_options: {}
    }
  }
  return {}
}

/**
 * range in [0, 100]
 * @param maxResults
 */
function mapMaxResultToOpenAIContextSize(maxResults: number): OpenAISearchConfig['searchContextSize'] {
  if (maxResults <= 33) return 'low'
  if (maxResults <= 66) return 'medium'
  return 'high'
}

export function buildProviderBuiltinWebSearchConfig(
  providerId: BaseProviderId,
  webSearchConfig: CherryWebSearchConfig
): WebSearchPluginConfig {
  switch (providerId) {
    case 'openai': {
      return {
        openai: {
          searchContextSize: mapMaxResultToOpenAIContextSize(webSearchConfig.maxResults)
        }
      }
    }
    case 'openai-chat': {
      return {
        'openai-chat': {
          searchContextSize: mapMaxResultToOpenAIContextSize(webSearchConfig.maxResults)
        }
      }
    }
    case 'anthropic': {
      const anthropicSearchOptions: AnthropicSearchConfig = {
        maxUses: webSearchConfig.maxResults,
        blockedDomains: mapRegexToPatterns(webSearchConfig.excludeDomains)
      }
      return {
        anthropic: anthropicSearchOptions
      }
    }
    case 'xai': {
      return {
        xai: {
          maxSearchResults: webSearchConfig.maxResults,
          returnCitations: true,
          sources: [
            {
              type: 'web',
              excludedWebsites: mapRegexToPatterns(webSearchConfig.excludeDomains)
            },
            { type: 'news' },
            { type: 'x' }
          ],
          mode: 'on'
        }
      }
    }
    case 'openrouter': {
      return {
        openrouter: {
          plugins: [
            {
              id: 'web',
              max_results: webSearchConfig.maxResults
            }
          ]
        }
      }
    }
    default: {
      throw new Error(`Unsupported provider: ${providerId}`)
    }
  }
}
