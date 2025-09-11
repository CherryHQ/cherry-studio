import { anthropic } from '@ai-sdk/anthropic'
import { google } from '@ai-sdk/google'
import { openai } from '@ai-sdk/openai'

import { ProviderOptionsMap } from '../../../options/types'

/**
 * 从 AI SDK 的工具函数中提取参数类型，以确保类型安全。
 */
type OpenAISearchConfig = Parameters<typeof openai.tools.webSearchPreview>[0]
type AnthropicSearchConfig = Parameters<typeof anthropic.tools.webSearch_20250305>[0]
type GoogleSearchConfig = Parameters<typeof google.tools.googleSearch>[0]

/**
 * 插件初始化时接收的完整配置对象
 *
 * 其结构与 ProviderOptions 保持一致，方便上游统一管理配置
 */
export interface WebSearchPluginConfig {
  openai?: OpenAISearchConfig
  anthropic?: AnthropicSearchConfig
  xai?: ProviderOptionsMap['xai']['searchParameters']
  google?: GoogleSearchConfig
  'google-vertex'?: GoogleSearchConfig
}

/**
 * 插件的默认配置
 */
export const DEFAULT_WEB_SEARCH_CONFIG: WebSearchPluginConfig = {
  google: {},
  'google-vertex': {},
  openai: {},
  xai: {
    mode: 'on',
    returnCitations: true,
    maxSearchResults: 5,
    sources: [{ type: 'web' }, { type: 'x' }, { type: 'news' }]
  },
  anthropic: {
    maxUses: 5
  }
}

export type WebSearchToolOutputSchema = {
  // Anthropic 工具 - 手动定义
  anthropicWebSearch: Array<{
    url: string
    title: string
    pageAge: string | null
    encryptedContent: string
    type: string
  }>

  // OpenAI 工具 - 基于实际输出
  openaiWebSearch: {
    status: 'completed' | 'failed'
  }

  // Google 工具
  googleSearch: {
    webSearchQueries?: string[]
    groundingChunks?: Array<{
      web?: { uri: string; title: string }
    }>
  }
}
