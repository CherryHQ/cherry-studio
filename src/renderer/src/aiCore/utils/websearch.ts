import type {
  AnthropicSearchConfig,
  OpenAISearchConfig,
  WebSearchPluginConfig
} from '@cherrystudio/ai-core/core/plugins/built-in/webSearchPlugin/helper'
import type { BaseProviderId } from '@cherrystudio/ai-core/provider'
import { isOpenAIDeepResearchModel, isOpenAIWebSearchChatCompletionOnlyModel } from '@renderer/config/models'
import type { CherryWebSearchConfig } from '@renderer/store/websearch'
import type { Model } from '@renderer/types'
import { mapRegexToPatterns } from '@renderer/utils/blacklistMatchPattern'

const X_AI_MAX_SEARCH_RESULT = 30

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

  if (model.provider === 'baidu-cloud') {
    // 根据模型ID判断支持的搜索参数
    const modelId = model.id.toLowerCase()

    // ernie-x1-turbo-32k 只支持 enable 参数
    if (modelId.includes('ernie-x1-turbo')) {
      return {
        web_search: {
          enable: true
        }
      }
    }

    // ERNIE系列不支持 search_mode 参数（强制搜索）
    if (modelId.includes('ernie')) {
      return {
        web_search: {
          enable: true,
          enable_trace: true,
          enable_status: true,
          enable_citation: true,
          search_number: 10,
          reference_number: 5
        }
      }
    }

    // 其他模型支持完整参数
    return {
      web_search: {
        enable: true,
        enable_trace: true,
        enable_status: true,
        enable_citation: true,
        search_mode: 'auto',
        search_number: 10,
        reference_number: 5
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
      const anthropicSearchOptions: AnthropicSearchConfig = {
        maxUses: webSearchConfig.maxResults,
        blockedDomains: blockedDomains.length > 0 ? blockedDomains : undefined
      }
      return {
        anthropic: anthropicSearchOptions
      }
    }
    case 'xai': {
      const excludeDomains = mapRegexToPatterns(webSearchConfig.excludeDomains)
      return {
        xai: {
          maxSearchResults: Math.min(webSearchConfig.maxResults, X_AI_MAX_SEARCH_RESULT),
          returnCitations: true,
          sources: [
            {
              type: 'web',
              excludedWebsites: excludeDomains.slice(0, Math.min(excludeDomains.length, 5))
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
