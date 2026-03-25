import type { WebSearchToolConfigMap } from '../../../providers'

export type OpenRouterSearchConfig = {
  plugins?: Array<{
    id: 'web'
    /**
     * Maximum number of search results to include (default: 5)
     */
    max_results?: number
    /**
     * Custom search prompt to guide the search query
     */
    search_prompt?: string
  }>
  /**
   * Built-in web search options for models that support native web search
   */
  web_search_options?: {
    /**
     * Maximum number of search results to include
     */
    max_results?: number
    /**
     * Custom search prompt to guide the search query
     */
    search_prompt?: string
  }
}

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
