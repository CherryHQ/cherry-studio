import { anthropic } from '@ai-sdk/anthropic'
import { google } from '@ai-sdk/google'
import { openai } from '@ai-sdk/openai'
import type { InferToolInput, InferToolOutput } from 'ai'
import { type Tool } from 'ai'

import { createOpenRouterOptions, createXaiOptions, mergeProviderOptions } from '../../../options'
import type { ProviderOptionsMap } from '../../../options/types'
import type { AiRequestContext } from '../../'
import type { OpenRouterSearchConfig } from './openrouter'

/**
 * 从 AI SDK 的工具函数中提取参数类型，以确保类型安全。
 */
export type OpenAISearchConfig = NonNullable<Parameters<typeof openai.tools.webSearch>[0]>
export type OpenAISearchPreviewConfig = NonNullable<Parameters<typeof openai.tools.webSearchPreview>[0]>
export type AnthropicSearchConfig = NonNullable<Parameters<typeof anthropic.tools.webSearch_20250305>[0]>
export type GoogleSearchConfig = NonNullable<Parameters<typeof google.tools.googleSearch>[0]>
export type XAISearchConfig = NonNullable<ProviderOptionsMap['xai']['searchParameters']>

type NormalizeTool<T> = T extends Tool<infer INPUT, infer OUTPUT> ? Tool<INPUT, OUTPUT> : Tool<any, any>

type AnthropicWebSearchTool = NormalizeTool<ReturnType<typeof anthropic.tools.webSearch_20250305>>
type OpenAIWebSearchTool = NormalizeTool<ReturnType<typeof openai.tools.webSearch>>
type OpenAIChatWebSearchTool = NormalizeTool<ReturnType<typeof openai.tools.webSearchPreview>>
type GoogleWebSearchTool = NormalizeTool<ReturnType<typeof google.tools.googleSearch>>

/**
 * 插件初始化时接收的完整配置对象
 *
 * 其结构与 ProviderOptions 保持一致，方便上游统一管理配置
 */
export interface WebSearchPluginConfig {
  openai?: OpenAISearchConfig
  'openai-chat'?: OpenAISearchPreviewConfig
  anthropic?: AnthropicSearchConfig
  xai?: ProviderOptionsMap['xai']['searchParameters']
  google?: GoogleSearchConfig
  openrouter?: OpenRouterSearchConfig
}

/**
 * 插件的默认配置
 */
export const DEFAULT_WEB_SEARCH_CONFIG: WebSearchPluginConfig = {
  google: {},
  openai: {},
  'openai-chat': {},
  xai: {
    mode: 'on',
    returnCitations: true,
    maxSearchResults: 5,
    sources: [{ type: 'web' }, { type: 'x' }, { type: 'news' }]
  },
  anthropic: {
    maxUses: 5
  },
  openrouter: {
    plugins: [
      {
        id: 'web',
        max_results: 5
      }
    ]
  }
}

export type WebSearchToolOutputSchema = {
  // Anthropic 工具 - 手动定义
  anthropic: InferToolOutput<AnthropicWebSearchTool>

  // OpenAI 工具 - 基于实际输出
  // TODO: 上游定义不规范,是unknown
  // openai: InferToolOutput<ReturnType<typeof openai.tools.webSearch>>
  openai: {
    status: 'completed' | 'failed'
  }
  'openai-chat': {
    status: 'completed' | 'failed'
  }
  // Google 工具
  // TODO: 上游定义不规范,是unknown
  // google: InferToolOutput<ReturnType<typeof google.tools.googleSearch>>
  google: {
    webSearchQueries?: string[]
    groundingChunks?: Array<{
      web?: { uri: string; title: string }
    }>
  }
}

export type WebSearchToolInputSchema = {
  anthropic: InferToolInput<AnthropicWebSearchTool>
  openai: InferToolInput<OpenAIWebSearchTool>
  google: InferToolInput<GoogleWebSearchTool>
  'openai-chat': InferToolInput<OpenAIChatWebSearchTool>
}

export const switchWebSearchTool = (config: WebSearchPluginConfig, params: any, context?: AiRequestContext) => {
  // ProviderId-first: decide by provider, then fall back to config presence
  switch (context?.providerId) {
    case 'openai': {
      if (!params.tools) params.tools = {}
      const cfg = config.openai ?? DEFAULT_WEB_SEARCH_CONFIG.openai
      params.tools.web_search = openai.tools.webSearch(cfg)
      return params
    }
    case 'openai-chat': {
      if (!params.tools) params.tools = {}
      const cfg = (config['openai-chat'] ?? DEFAULT_WEB_SEARCH_CONFIG['openai-chat']) as OpenAISearchPreviewConfig
      params.tools.web_search_preview = openai.tools.webSearchPreview(cfg)
      return params
    }
    case 'anthropic': {
      if (!params.tools) params.tools = {}
      const cfg = config.anthropic ?? DEFAULT_WEB_SEARCH_CONFIG.anthropic
      params.tools.web_search = anthropic.tools.webSearch_20250305(cfg)
      return params
    }
    case 'google': {
      if (!params.tools) params.tools = {}
      const cfg = (config.google ?? DEFAULT_WEB_SEARCH_CONFIG.google) as GoogleSearchConfig
      params.tools.web_search = google.tools.googleSearch(cfg)
      return params
    }
    case 'xai': {
      const cfg = config.xai ?? DEFAULT_WEB_SEARCH_CONFIG.xai
      const searchOptions = createXaiOptions({
        searchParameters: { ...cfg, mode: 'on' }
      })
      params.providerOptions = mergeProviderOptions(params.providerOptions, searchOptions)
      return params
    }
    case 'openrouter': {
      const cfg = (config.openrouter ?? DEFAULT_WEB_SEARCH_CONFIG.openrouter) as OpenRouterSearchConfig
      const searchOptions = createOpenRouterOptions(cfg)
      params.providerOptions = mergeProviderOptions(params.providerOptions, searchOptions)
      return params
    }
    default: {
      // No-op for providers handled elsewhere (azure, azure-responses, google-vertex, etc.)
      break
    }
  }

  // Fallback: apply based on available config keys
  if (config.openai) {
    if (!params.tools) params.tools = {}
    params.tools.web_search = openai.tools.webSearch(config.openai)
  } else if (config['openai-chat']) {
    if (!params.tools) params.tools = {}
    params.tools.web_search_preview = openai.tools.webSearchPreview(config['openai-chat'] as OpenAISearchPreviewConfig)
  } else if (config.anthropic) {
    if (!params.tools) params.tools = {}
    params.tools.web_search = anthropic.tools.webSearch_20250305(config.anthropic)
  } else if (config.google) {
    if (!params.tools) params.tools = {}
    params.tools.web_search = google.tools.googleSearch(config.google as GoogleSearchConfig)
  } else if (config.xai) {
    const searchOptions = createXaiOptions({
      searchParameters: { ...config.xai, mode: 'on' }
    })
    params.providerOptions = mergeProviderOptions(params.providerOptions, searchOptions)
  } else if (config.openrouter) {
    const searchOptions = createOpenRouterOptions(config.openrouter as OpenRouterSearchConfig)
    params.providerOptions = mergeProviderOptions(params.providerOptions, searchOptions)
  }
  return params
}
