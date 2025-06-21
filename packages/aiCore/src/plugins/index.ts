// 核心类型和接口
export type { AiPlugin, AiRequestContext, HookResult, HookType, PluginManagerConfig } from './types'
import type { AiPlugin, AiRequestContext } from './types'

// 插件管理器
export { PluginManager } from './manager'

// 工具函数
export function createContext(providerId: string, modelId: string, originalParams: any): AiRequestContext {
  return {
    providerId,
    modelId,
    originalParams,
    metadata: {},
    startTime: Date.now(),
    requestId: `${providerId}-${modelId}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

// 插件构建器 - 便于创建插件
export function definePlugin(plugin: AiPlugin): AiPlugin {
  return plugin
}
