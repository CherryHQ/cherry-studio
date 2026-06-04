import type { WebSearchPluginConfig } from '@cherrystudio/ai-core/core/plugins/built-in/webSearchPlugin'
import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import { mapRegexToPatterns } from '@shared/utils/blacklistMatchPattern'
import { isOpenAIDeepResearchModel, isOpenAIWebSearchChatCompletionOnlyModel } from '@shared/utils/model'

import type { AppProviderId } from '../types'

/** Inputs for provider-builtin web-search plugin configuration. */
export interface CherryWebSearchConfig {
  maxResults: number
  excludeDomains: string[]
}

export function getWebSearchParams(model: Model): Record<string, any> {
  if (model.providerId === 'hunyuan') {
    return { enable_enhancement: true, citation: true, search_info: true }
  }

  if (model.providerId === 'dashscope') {
    return {
      enable_search: true,
      search_options: {
        forced_search: true
      }
    }
  }

  // https://creator.poe.com/docs/external-applications/openai-compatible-api#using-custom-parameters-with-extra_body
  if (model.providerId === 'poe') {
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
      const searchContextSize =
        model && isOpenAIDeepResearchModel(model)
          ? 'medium'
          : mapMaxResultToOpenAIContextSize(webSearchConfig.maxResults)
      return {
        openai: {
          searchContextSize
        }
      }
    }
    case 'openai-chat': {
      const searchContextSize =
        model && isOpenAIDeepResearchModel(model)
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
      // cherryin proxies to a real endpoint forced via model.endpointTypes[0];
      // map it to the AppProviderId whose web-search case applies.
      const endpoint = model?.endpointTypes?.[0]
      const proxied: AppProviderId | undefined =
        endpoint === ENDPOINT_TYPE.OPENAI_RESPONSES
          ? 'openai'
          : endpoint === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
            ? 'openai-chat'
            : endpoint === ENDPOINT_TYPE.ANTHROPIC_MESSAGES
              ? 'anthropic'
              : endpoint
      return proxied ? buildProviderBuiltinWebSearchConfig(proxied, webSearchConfig, model) : {}
    }
    default: {
      return {}
    }
  }
}
