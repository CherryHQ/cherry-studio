import { anthropic } from '@ai-sdk/anthropic'
import { google } from '@ai-sdk/google'
import { openai } from '@ai-sdk/openai'
import { InferToolInput, InferToolOutput, type Tool } from 'ai'

import { ProviderOptionsMap } from '../../../options/types'
import { OpenRouterSearchConfig } from './openrouter'

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
  'google-vertex'?: GoogleSearchConfig
  openrouter?: OpenRouterSearchConfig
}

/**
 * 插件的默认配置
 */
export const DEFAULT_WEB_SEARCH_CONFIG: WebSearchPluginConfig = {
  google: {},
  'google-vertex': {},
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
