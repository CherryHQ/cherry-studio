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
      const { providerId } = context
      if (providerId === 'cherryin' || providerId === 'cherryin-chat') {
        // cherryin.gemini
        const provider = params.model?.provider
        if (provider && typeof provider === 'string' && provider.includes('.')) {
          const _providerId = provider.split('.')[1]
          switchWebSearchTool(config, params, { ...context, providerId: _providerId })
        }
      } else {
        switchWebSearchTool(config, params, context)
      }
      return params
    }
  })

// 导出类型定义供开发者使用
export * from './helper'

// 默认导出
export default webSearchPlugin
