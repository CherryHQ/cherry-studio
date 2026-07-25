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
    // Chat-Completions web search (help.aliyun.com/zh/model-studio/web-search). The newest qwen-max and
    // multimodal (omni/vl) SKUs only search under the `agent` strategy; older SKUs use the default.
    const apiModelId = model.apiModelId ?? model.id
    const needsAgentStrategy = /qwen3-max|omni|qwen3-vl/.test(apiModelId)
    return {
      enable_search: true,
      search_options: {
        forced_search: true,
        ...(needsAgentStrategy ? { search_strategy: 'agent' } : {})
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
 * Bailian splits built-in web search by endpoint. The Responses `{ type: 'web_search' }` tool is served
 * for the Qwen3.x line only — "Responses API 仅支持 Qwen3.7 Max系列、Qwen3.6、Qwen3.5、qwen3-max"
 * (help.aliyun.com/zh/model-studio/web-search). The `qwen-plus` / `qwen-flash` / character aliases and the
 * hosted third-party models search through Chat Completions' `enable_search` instead (see
 * `getWebSearchParams`), so emitting the tool for them yields a provider error or an empty result.
 *
 * Those aliases are ordered chat-first in the registry, so this only guards a manual endpoint override.
 */
function servesResponsesWebSearch(model: Model): boolean {
  return /^qwen3[.-]/.test(model.apiModelId ?? '')
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
      // Doubao (Ark) and DashScope (Bailian) responses-endpoint models ride the openai Responses
      // adapter, but their built-in web_search tool only accepts the bare `{type:'web_search'}` shape —
      // openai-only knobs like search_context_size are not documented and must not be sent. (DashScope
      // chat-endpoint models resolve to `openai-compatible` here → default `{}` → no tool; their web
      // search comes from getWebSearchParams instead.)
      if (model?.providerId === 'doubao') {
        return { openai: {} }
      }
      if (model?.providerId === 'dashscope') {
        // `undefined` (not `{}`) is what suppresses the tool: `providerWebSearchFeature` applies on a
        // truthy config, so an empty object would still attach it.
        return servesResponsesWebSearch(model) ? { openai: {} } : undefined
      }
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
