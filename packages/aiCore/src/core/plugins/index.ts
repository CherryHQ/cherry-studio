// 核心类型和接口
export type {
  AiPlugin,
  AiRequestContext,
  AiRequestMetadata,
  GenerateTextParams,
  GenerateTextResult,
  HookResult,
  PluginManagerConfig,
  RecursiveCallFn,
  StreamTextParams,
  StreamTextResult
} from './types'
import type { ImageModel, LanguageModel } from 'ai'

import type { ProviderId } from '../providers'
import type { AiPlugin, AiRequestContext } from './types'

// 插件管理器
export { PluginManager } from './manager'

// 工具函数
export function createContext<T extends ProviderId, TParams = unknown, TResult = unknown>(
  providerId: T,
  model: LanguageModel | ImageModel,
  originalParams: TParams
): AiRequestContext<TParams, TResult> {
  return {
    providerId,
    model,
    originalParams,
    metadata: {},
    startTime: Date.now(),
    requestId: `${providerId}-${typeof model === 'string' ? model : model?.modelId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    isRecursiveCall: false,
    recursiveDepth: 0, // 初始化递归深度为 0
    maxRecursiveDepth: 10, // 默认最大递归深度为 10
    extensions: new Map(),
    middlewares: [],
    // 占位递归调用函数，实际使用时会被 PluginEngine 替换
    recursiveCall: () => Promise.resolve(null as any)
  }
}

// 插件构建器 - 便于创建插件

// 重载 1: 泛型插件（显式指定类型参数）
export function definePlugin<TParams, TResult>(plugin: AiPlugin<TParams, TResult>): AiPlugin<TParams, TResult>

// 重载 2: 非泛型插件（默认 unknown）
export function definePlugin(plugin: AiPlugin): AiPlugin

// 重载 3: 插件工厂函数
export function definePlugin<T extends (...args: any[]) => AiPlugin>(pluginFactory: T): T

// 实现
export function definePlugin(plugin: AiPlugin | ((...args: any[]) => AiPlugin)) {
  return plugin
}
