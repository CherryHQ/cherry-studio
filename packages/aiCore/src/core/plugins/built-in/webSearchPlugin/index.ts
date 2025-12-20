/**
 * Web Search Plugin
 * 提供统一的网络搜索能力，支持多个 AI Provider
 */

import { definePlugin } from '../../'
import type { WebSearchPluginConfig } from './helper'
import { DEFAULT_WEB_SEARCH_CONFIG, switchWebSearchTool } from './helper'

/**
 * 网络搜索插件
 *
 * @param config - 在插件初始化时传入的静态配置
 */
export const webSearchPlugin = (config: WebSearchPluginConfig = DEFAULT_WEB_SEARCH_CONFIG) =>
  definePlugin({
    name: 'webSearch',
    enforce: 'pre',

    transformParams: async (params: any, context) => {
      let { providerId } = context

      // For cherryin providers, extract the actual provider from the model's provider string
      // Expected format: "cherryin.{actualProvider}" (e.g., "cherryin.gemini")
      if (providerId === 'cherryin' || providerId === 'cherryin-chat') {
        const provider = params.model?.provider
        if (provider && typeof provider === 'string' && provider.includes('.')) {
          const extractedProviderId = provider.split('.')[1]
          if (extractedProviderId) {
            providerId = extractedProviderId
          }
        }
      }

      switchWebSearchTool(config, params, { ...context, providerId })
      return params
    }
  })

// 导出类型定义供开发者使用
export * from './helper'

// 默认导出
export default webSearchPlugin
