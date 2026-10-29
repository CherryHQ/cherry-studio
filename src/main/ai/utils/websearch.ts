import type { WebSearchToolConfigMap } from '@cherrystudio/ai-core/provider'
import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { mapRegexToPatterns } from '@shared/utils/blacklistMatchPattern'
import { getRawModelId, isOpenAIDeepResearchModel, isOpenAIWebSearchChatCompletionOnlyModel } from '@shared/utils/model'
import {
  DASHSCOPE_HOSTED_WEB_SEARCH_MODELS,
  isBuiltinWebFetchAvailable,
  isBuiltinWebSearchAvailable,
  matchesPreset
} from '@shared/utils/provider'

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
// DeepSeek-V4 / GLM-5.2 / Kimi-K3 on QwenCloud serve web search through the Responses `web_search`
// tool only; the supported-models table marks these lines "Responses API only" as a CLOSED id list,
// so the pattern anchors exactly — flash-vision-exp and glm-5.2-fast/-fast-preview stay out. Dots and
// hyphens both appear depending on id origin (wire apiModelId vs catalog modelId).
const qwencloudResponsesOnlySearch =
  /^(?:deepseek-v4-(?:pro(?:-0813)?|flash(?:-0731)?)|deepseek-v4[.-]1-flash(?:-1017)?|glm-5[.-]2|kimi-k3)$/

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

  if (provider && matchesPreset(provider, 'qwencloud')) {
    // Qwen3.8 text models reject agent search on Chat; Omni Flash requires it.
    // https://docs.qwencloud.com/developer-guides/tool-calling/web-search
    const apiModelId = getRawModelId(model)
    // DeepSeek-V4 / GLM-5.2 search through the Responses `web_search` tool only ("Responses API only"
    // in the table) — Chat's enable_search is not served for them, so inject nothing on this path.
    if (qwencloudResponsesOnlySearch.test(apiModelId)) {
      return {}
    }
    // Unlike mainland Bailian, the international table is a closed list with no qwen-plus/flash/turbo
    // rows, so chat injects enable_search only for lines the registry declared eligible.
    if (!isBuiltinWebSearchAvailable(model, provider)) {
      return {}
    }
    const searchStrategy =
      /qwen3[.-]8-omni-flash|qwen3[.-]7-(?:max|plus|flash)|qwen3[.-]6-(?:plus|flash)|qwen3[.-]5-(?:plus|flash)|qwen3-max/.test(
        apiModelId
      )
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

// Bailian Responses search covers Qwen3.x and the hosted SKUs in the shared hosted-model declaration.
// Qwen aliases outside Qwen3.x keep Chat search; see DASHSCOPE_HOSTED_WEB_SEARCH_MODELS.
function servesResponsesWebSearch(model: Model): boolean {
  // Use shared wire-id resolution: runtime Model.apiModelId is optional; reading it directly can
  // return false while the route stays `server`, leaving the request with neither server nor client tools.
  const rawId = getRawModelId(model)
  return (
    /^qwen3[.-]/.test(rawId) ||
    DASHSCOPE_HOSTED_WEB_SEARCH_MODELS.some((row) => row.wireIds.some((wireId) => wireId === rawId))
  )
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
    // open-responses models keep the 'openai' config key: their provider string is
    // 'openai.responses', so tool-factory resolution lands on the OpenAI extension.
    case 'azure-responses':
    case 'open-responses':
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
      if (model && provider && matchesPreset(provider, 'qwencloud')) {
        // Only the DeepSeek-V4/GLM-5.2/Kimi-K3 lines take the Responses web_search tool
        // (docs.qwencloud.com web-search); Qwen lines search via Chat's enable_search — `undefined`
        // keeps the tool off.
        return qwencloudResponsesOnlySearch.test(getRawModelId(model)) ? { openai: {} } : undefined
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
