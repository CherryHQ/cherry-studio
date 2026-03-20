import type { xai } from '@ai-sdk/xai'

import type { WebSearchToolConfigMap } from '../../../providers'

import type { OpenRouterSearchConfig } from './openrouter'

/**
 * xAI 搜索配置
 *
 * xAI 的 toolFactories 尚未注册（create 函数用 customProvider 包装导致 .tools 丢失），
 * 所以 WebSearchToolConfigMap 不包含 xai。手动定义，待 xAI 迁移到 variants 后可删除。
 */
type XAIWebSearchConfig = NonNullable<Parameters<typeof xai.tools.webSearch>[0]>
type XAIXSearchConfig = NonNullable<Parameters<typeof xai.tools.xSearch>[0]>
export interface XAISearchConfig {
  webSearch?: XAIWebSearchConfig
  xSearch?: XAIXSearchConfig
}

/**
 * 插件初始化时接收的完整配置对象
 *
 * key = provider ID，value = 该 provider 的搜索配置
 *
 * - 大部分类型从 coreExtensions 的 toolFactories 声明中自动提取（WebSearchToolConfigMap）
 * - OpenRouter 使用自定义配置（非 SDK .tools 模式），从 openrouter.ts 导入
 * - xAI 暂时手动定义（待 toolFactories 注册后自动提取）
 */
export type WebSearchPluginConfig = WebSearchToolConfigMap & {
  openrouter?: OpenRouterSearchConfig
  xai?: XAISearchConfig
}

/**
 * 插件的默认配置
 */
export const DEFAULT_WEB_SEARCH_CONFIG: WebSearchPluginConfig = {
  google: {},
  openai: {},
  'openai-chat': {},
  xai: {
    webSearch: { enableImageUnderstanding: true },
    xSearch: { enableImageUnderstanding: true }
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
