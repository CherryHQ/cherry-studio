/**
 * Web Search Plugin
 * 提供统一的网络搜索能力，支持多个 AI Provider
 */

import { definePlugin } from '../../'
import type { AiRequestContext } from '../../types'
import { DEFAULT_WEB_SEARCH_CONFIG, switchWebSearchTool, WebSearchPluginConfig } from './helper'

/**
 * 网络搜索插件
 *
 * @param config - 在插件初始化时传入的静态配置
 */
export const webSearchPlugin = (config: WebSearchPluginConfig = DEFAULT_WEB_SEARCH_CONFIG) =>
  definePlugin({
    name: 'webSearch',
    enforce: 'pre',

    transformParams: async (params: any, context: AiRequestContext) => {
      const { providerId } = context
      switchWebSearchTool(providerId, config, params)
      if (providerId === 'cherryin') {
        // cherryin.gemini
        const providerId = params.model.provider.split('.')[1]
        switchWebSearchTool(providerId, config, params)
      }
      return params
    }
  })

// 导出类型定义供开发者使用
export type { WebSearchPluginConfig, WebSearchToolOutputSchema } from './helper'

// 默认导出
export default webSearchPlugin
