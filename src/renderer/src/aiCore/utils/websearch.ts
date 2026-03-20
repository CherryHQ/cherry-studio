import type { WebSearchPluginConfig } from '@cherrystudio/ai-core/core/plugins/built-in/webSearchPlugin/helper'
import type { AppProviderId } from '@renderer/aiCore/types'
import { isOpenAIDeepResearchModel, isOpenAIWebSearchChatCompletionOnlyModel } from '@renderer/config/models'
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

  // https://creator.poe.com/docs/external-applications/openai-compatible-api#using-custom-parameters-with-extra_body
  if (model.provider === 'poe') {
    return {
      extra_body: {
        web_search: true
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
function mapMaxResultToOpenAIContextSize(
  maxResults: number
): NonNullable<WebSearchPluginConfig['openai']>['searchContextSize'] {
  if (maxResults <= 33) return 'low'
  if (maxResults <= 66) return 'medium'
  return 'high'
}

export function buildProviderBuiltinWebSearchConfig(
  providerId: AppProviderId,
  webSearchConfig: CherryWebSearchConfig,
  model?: Model
): WebSearchPluginConfig | undefined {
  switch (providerId) {
    case 'azure-responses':
    case 'openai': {
      const searchContextSize = isOpenAIDeepResearchModel(model)
        ? 'medium'
        : mapMaxResultToOpenAIContextSize(webSearchConfig.maxResults)
      return {
        openai: {
          searchContextSize
        }
      }
    }
    case 'openai-chat': {
      const searchContextSize = isOpenAIDeepResearchModel(model)
        ? 'medium'
        : mapMaxResultToOpenAIContextSize(webSearchConfig.maxResults)
      return {
        'openai-chat': {
          searchContextSize
        }
      }
    }
    case 'anthropic': {
      const blockedDomains = mapRegexToPatterns(webSearchConfig.excludeDomains)
      const anthropicSearchOptions: NonNullable<WebSearchPluginConfig['anthropic']> = {
        maxUses: webSearchConfig.maxResults,
        blockedDomains: blockedDomains.length > 0 ? blockedDomains : undefined
      }
      return {
        anthropic: anthropicSearchOptions
      }
    }
    case 'xai':
    case 'xai-responses': {
      const excludeDomains = mapRegexToPatterns(webSearchConfig.excludeDomains)
      const xaiWebConfig: NonNullable<NonNullable<WebSearchPluginConfig['xai-responses']>['webSearch']> = {
        enableImageUnderstanding: true
      }
      if (excludeDomains.length > 0) {
        xaiWebConfig.excludedDomains = excludeDomains.slice(0, 5)
      }
      return {
        'xai-responses': {
          webSearch: xaiWebConfig,
          xSearch: { enableImageUnderstanding: true }
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
    case 'cherryin': {
      const _providerId =
        { 'openai-response': 'openai', openai: 'openai-chat' }[model?.endpoint_type ?? ''] ?? model?.endpoint_type
      return buildProviderBuiltinWebSearchConfig(_providerId, webSearchConfig, model)
    }
    default: {
      return {}
    }
  }
}
