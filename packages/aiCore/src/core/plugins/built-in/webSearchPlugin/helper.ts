import { anthropic } from '@ai-sdk/anthropic'
import { google } from '@ai-sdk/google'
import { openai } from '@ai-sdk/openai'
import { xai } from '@ai-sdk/xai'
import type { InferToolInput, InferToolOutput } from 'ai'
import { type Tool } from 'ai'

import { createOpenRouterOptions, mergeProviderOptions } from '../../../options'
import type { AiRequestContext } from '../../'
import type { OpenRouterSearchConfig } from './openrouter'

/**
 * 从 AI SDK 的工具函数中提取参数类型，以确保类型安全。
 */
export type OpenAISearchConfig = NonNullable<Parameters<typeof openai.tools.webSearch>[0]>
export type OpenAISearchPreviewConfig = NonNullable<Parameters<typeof openai.tools.webSearchPreview>[0]>
export type AnthropicSearchConfig = NonNullable<Parameters<typeof anthropic.tools.webSearch_20250305>[0]>
export type GoogleSearchConfig = NonNullable<Parameters<typeof google.tools.googleSearch>[0]>
export type XAISearchConfig = NonNullable<Parameters<typeof xai.tools.webSearch>[0]>

type NormalizeTool<T> = T extends Tool<infer INPUT, infer OUTPUT> ? Tool<INPUT, OUTPUT> : Tool<any, any>

type AnthropicWebSearchTool = NormalizeTool<ReturnType<typeof anthropic.tools.webSearch_20250305>>
type OpenAIWebSearchTool = NormalizeTool<ReturnType<typeof openai.tools.webSearch>>
type OpenAIChatWebSearchTool = NormalizeTool<ReturnType<typeof openai.tools.webSearchPreview>>
type GoogleWebSearchTool = NormalizeTool<ReturnType<typeof google.tools.googleSearch>>
type XAIWebSearchTool = NormalizeTool<ReturnType<typeof xai.tools.webSearch>>

/**
 * 插件初始化时接收的完整配置对象
 *
 * 其结构与 ProviderOptions 保持一致，方便上游统一管理配置
 */
export interface WebSearchPluginConfig {
  openai?: OpenAISearchConfig
  'openai-chat'?: OpenAISearchPreviewConfig
  anthropic?: AnthropicSearchConfig
  xai?: XAISearchConfig
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
  xai: {},
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
  // xAI 工具
  xai: InferToolOutput<XAIWebSearchTool>
}

export type WebSearchToolInputSchema = {
  anthropic: InferToolInput<AnthropicWebSearchTool>
  openai: InferToolInput<OpenAIWebSearchTool>
  google: InferToolInput<GoogleWebSearchTool>
  'openai-chat': InferToolInput<OpenAIChatWebSearchTool>
  xai: InferToolInput<XAIWebSearchTool>
}

/**
 * Helper function to ensure params.tools object exists
 */
const ensureToolsObject = (params: any) => {
  if (!params.tools) params.tools = {}
}

/**
 * Helper function to apply tool-based web search configuration
 */
const applyToolBasedSearch = (params: any, toolName: string, toolInstance: any) => {
  ensureToolsObject(params)
  params.tools[toolName] = toolInstance
}

/**
 * Helper function to apply provider options-based web search configuration
 */
const applyProviderOptionsSearch = (params: any, searchOptions: any) => {
  params.providerOptions = mergeProviderOptions(params.providerOptions, searchOptions)
}

export const switchWebSearchTool = (config: WebSearchPluginConfig, params: any, context?: AiRequestContext) => {
  const providerId = context?.providerId

  // Provider-specific configuration map
  const providerHandlers: Record<string, () => void> = {
    openai: () => {
      const cfg = config.openai ?? DEFAULT_WEB_SEARCH_CONFIG.openai
      applyToolBasedSearch(params, 'web_search', openai.tools.webSearch(cfg))
    },
    'openai-chat': () => {
      const cfg = (config['openai-chat'] ?? DEFAULT_WEB_SEARCH_CONFIG['openai-chat']) as OpenAISearchPreviewConfig
      applyToolBasedSearch(params, 'web_search_preview', openai.tools.webSearchPreview(cfg))
    },
    anthropic: () => {
      const cfg = config.anthropic ?? DEFAULT_WEB_SEARCH_CONFIG.anthropic
      applyToolBasedSearch(params, 'web_search', anthropic.tools.webSearch_20250305(cfg))
    },
    google: () => {
      const cfg = (config.google ?? DEFAULT_WEB_SEARCH_CONFIG.google) as GoogleSearchConfig
      applyToolBasedSearch(params, 'web_search', google.tools.googleSearch(cfg))
    },
    xai: () => {
      const cfg = config.xai ?? DEFAULT_WEB_SEARCH_CONFIG.xai
      applyToolBasedSearch(params, 'web_search', xai.tools.webSearch(cfg))
    },
    openrouter: () => {
      const cfg = (config.openrouter ?? DEFAULT_WEB_SEARCH_CONFIG.openrouter) as OpenRouterSearchConfig
      const searchOptions = createOpenRouterOptions(cfg)
      applyProviderOptionsSearch(params, searchOptions)
    }
  }

  // Try provider-specific handler first
  const handler = providerId && providerHandlers[providerId]
  if (handler) {
    handler()
    return params
  }

  // Fallback: apply based on available config keys (prioritized order)
  const fallbackOrder: Array<keyof WebSearchPluginConfig> = [
    'openai',
    'openai-chat',
    'anthropic',
    'google',
    'xai',
    'openrouter'
  ]

  for (const key of fallbackOrder) {
    if (config[key]) {
      providerHandlers[key]()
      break
    }
  }

  return params
}
