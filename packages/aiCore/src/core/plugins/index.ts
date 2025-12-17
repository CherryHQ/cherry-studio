// 核心类型和接口
export type { AiPlugin, AiRequestContext, HookResult, PluginManagerConfig } from './types'
import type { ImageModelV2 } from '@ai-sdk/provider'
import type { LanguageModel } from 'ai'

import type { ProviderId } from '../providers'
import type { AiPlugin, AiRequestContext } from './types'

// 插件管理器
export { PluginManager } from './manager'

// 工具函数
export function createContext<T extends ProviderId>(
  providerId: T,
  model: LanguageModel | ImageModelV2,
  originalParams: any
): AiRequestContext {
  return {
    providerId,
    model,
    originalParams,
    metadata: {},
    startTime: Date.now(),
    requestId: `${providerId}-${typeof model === 'string' ? model : model?.modelId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    // 占位
    recursiveCall: () => Promise.resolve(null)
  }
}

// 插件构建器 - 便于创建插件
export function definePlugin(plugin: AiPlugin): AiPlugin
export function definePlugin<T extends (...args: any[]) => AiPlugin>(pluginFactory: T): T
export function definePlugin(plugin: AiPlugin | ((...args: any[]) => AiPlugin)) {
  return plugin
}
