import type { WebSearchToolConfigMap } from '@cherrystudio/ai-core/provider'
import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { mapRegexToPatterns } from '@shared/utils/blacklistMatchPattern'
import { getRawModelId, isOpenAIDeepResearchModel, isOpenAIWebSearchChatCompletionOnlyModel } from '@shared/utils/model'
import { isBuiltinWebFetchAvailable, matchesPreset } from '@shared/utils/provider'

import type { KimiFormulaCredentials } from '../provider/custom/moonshotProvider'
import type { AppProviderId } from '../types'

/**
 * aiCore derives `WebSearchToolConfigMap` from ITS OWN extensions, so an app-registered one (Moonshot)
 * has no key there. Widen it here rather than teaching aiCore about a vendor it does not ship —
 * `providerToolPlugin` takes the config as a plain record, so nothing downstream needs the extra key.
 */
export type AppWebSearchPluginConfig = WebSearchToolConfigMap & { moonshot?: KimiFormulaCredentials }

/** Inputs for provider-builtin web-search plugin configuration. */
export interface CherryWebSearchConfig {
  maxResults: number
  excludeDomains: string[]
}

/**
 * Key delivery off the PRESET identity, never the runtime provider id: a user-copied Zhipu/Bailian/Poe
 * provider keeps its own id while `ProviderService` still hands it the preset's `serverTools` and
 * `config.ts` still routes it through the preset's transform (both use `matchesPreset`). Comparing
 * `model.providerId` there routed those copies to the server side and then injected nothing.
 */
export function getWebSearchParams(model: Model, provider: Provider | undefined): Record<string, any> {
  if (provider && matchesPreset(provider, 'zhipu')) {
    // BigModel's web search rides the tools array, which providerOptions cannot
    // reach — transformZhipuRequestBody moves this marker into `tools`
    // (docs.bigmodel.cn/cn/guide/tools/web-search).
    return { web_search: { enable: true, search_engine: 'search_pro', search_result: true } }
  }

  if (provider && matchesPreset(provider, 'dashscope')) {
    // Chat-Completions web search (help.aliyun.com/zh/model-studio/web-search). The newest qwen-max and
    // multimodal (omni/vl) SKUs only search under the `agent` strategy; older SKUs use the default. When
    // the model also serves the web-extractor (url-context) tool, `agent_max` upgrades the strategy to
    // fetch full page content (help.aliyun.com/zh/model-studio/web-extractor); thinking mode is required.
    const apiModelId = getRawModelId(model)
    const searchStrategy = isBuiltinWebFetchAvailable(model, provider)
      ? 'agent_max'
      : /qwen3-max|omni|qwen3-vl/.test(apiModelId)
        ? 'agent'
        : undefined
    return {
      enable_search: true,
      search_options: {
        forced_search: true,
        ...(searchStrategy ? { search_strategy: searchStrategy } : {})
      }
    }
  }

  // https://creator.poe.com/docs/external-applications/openai-compatible-api#using-custom-parameters-with-extra_body
  if (provider && matchesPreset(provider, 'poe')) {
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
  // Key off the shared wire-id resolution: `apiModelId` alone is optional on the
  // runtime Model, and reading it directly made this silently return false — the
  // route still picked the server side, so the request went out with no search
  // tool AND no client tools.
  return /^qwen3[.-]/.test(getRawModelId(model))
}

/**
 * range in [0, 100]
 * @param maxResults
 */
function mapMaxResultToOpenAIContextSize(
  maxResults: number
): NonNullable<WebSearchToolConfigMap['openai']>['searchContextSize'] {
  if (maxResults <= 33) return 'low'
  if (maxResults <= 66) return 'medium'
  return 'high'
}

export function buildProviderBuiltinWebSearchConfig(
  providerId: AppProviderId,
  webSearchConfig: CherryWebSearchConfig,
  model?: Model,
  provider?: Provider,
  serving?: KimiFormulaCredentials
): AppWebSearchPluginConfig | undefined {
  switch (providerId) {
    // Kimi's tool EXECUTES a formula fiber, so it needs this request's credential. The tool factory
    // cannot read it off the provider instance (`getToolProvider` hands it a settings-less one), so
    // the resolved serving credential rides the plugin config.
    case 'moonshot':
      return { moonshot: serving ?? {} }
    case 'azure-responses':
    case 'openai': {
      // Doubao (Ark) and DashScope (Bailian) responses-endpoint models ride the openai Responses
      // adapter, but their built-in web_search tool only accepts the bare `{type:'web_search'}` shape —
      // openai-only knobs like search_context_size are not documented and must not be sent. Ark serves
      // web search on Responses only (chat has no parameter), so this is doubao's whole delivery.
      // (DashScope chat-endpoint models resolve to `openai-compatible` here → default `{}` → no tool;
      // their web search comes from getWebSearchParams instead.)
      if (provider && matchesPreset(provider, 'doubao')) {
        return { openai: {} }
      }
      // DeepSeek implements the bare Responses web_search tool and ignores OpenAI-only options such
      // as search_context_size and user_location (api-docs.deepseek.com/guides/responses_api).
      if (provider && matchesPreset(provider, 'deepseek')) {
        return { openai: {} }
      }
      if (model && provider && matchesPreset(provider, 'dashscope')) {
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
      const anthropicSearchOptions: NonNullable<WebSearchToolConfigMap['anthropic']> = {
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
      const xaiWebConfig: NonNullable<NonNullable<WebSearchToolConfigMap['xai-responses']>['webSearch']> = {
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
      const excludedDomains = mapRegexToPatterns(webSearchConfig.excludeDomains)
      const openrouterWebConfig: NonNullable<WebSearchToolConfigMap['openrouter']> = {
        maxResults: webSearchConfig.maxResults
      }
      if (excludedDomains.length > 0) {
        openrouterWebConfig.excludedDomains = excludedDomains
      }
      return { openrouter: openrouterWebConfig }
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
      return proxied ? buildProviderBuiltinWebSearchConfig(proxied, webSearchConfig, model, provider, serving) : {}
    }
    default: {
      return {}
    }
  }
}
