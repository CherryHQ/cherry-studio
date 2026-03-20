import type { WebSearchToolConfigMap } from '../../../providers'

import type { OpenRouterSearchConfig } from './openrouter'

/**
 * 插件初始化时接收的完整配置对象
 *
 * key = provider ID，value = 该 provider 的搜索配置
 *
 * - 大部分类型从 coreExtensions 的 toolFactories 声明中自动提取（WebSearchToolConfigMap）
 * - OpenRouter 使用自定义配置（非 SDK .tools 模式），从 openrouter.ts 导入
 */
export type WebSearchPluginConfig = WebSearchToolConfigMap & {
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
