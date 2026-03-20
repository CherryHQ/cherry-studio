/**
 * Provider Tool Plugin
 * 通用的 provider 工具注入插件
 *
 * 通过 extensionRegistry.resolveToolCapability 查找 provider 声明的 toolFactory，
 * factory 返回 ToolFactoryPatch（tools 或 providerOptions），plugin 统一合并到 params。
 *
 * webSearchPlugin 和 urlContextPlugin 都是它的特化。
 */

import { mergeProviderOptions } from '../../options'
import { extensionRegistry } from '../../providers'
import type { ToolCapability } from '../../providers/types/toolFactory'
import { definePlugin } from '../'

/**
 * 通用 provider 工具插件
 *
 * @param capability - 工具能力标识（如 'webSearch', 'urlContext'）
 * @param config - 按 providerId 索引的配置，传给 factory
 */
export const providerToolPlugin = (capability: ToolCapability, config: Record<string, any> = {}) =>
  definePlugin({
    name: capability,
    enforce: 'pre',

    transformParams: async (params: any, context) => {
      const { providerId } = context

      const modelProvider =
        context.model && typeof context.model !== 'string' && 'provider' in context.model
          ? (context.model.provider as string)
          : undefined

      const resolved = await extensionRegistry.resolveToolCapability(providerId, capability, modelProvider)
      if (!resolved) return params

      const userConfig = config[providerId] ?? {}
      const patch = resolved.factory(resolved.provider)(userConfig)

      if (patch.tools) {
        params.tools = { ...params.tools, ...patch.tools }
      }
      if (patch.providerOptions) {
        params.providerOptions = mergeProviderOptions(params.providerOptions, patch.providerOptions)
      }

      return params
    }
  })
