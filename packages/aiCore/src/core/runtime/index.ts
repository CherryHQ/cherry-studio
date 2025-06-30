/**
 * Runtime 模块导出
 * 专注于运行时插件化AI调用处理
 */

// 主要的运行时执行器
export { RuntimeExecutor } from './executor'

// 导出类型
export type {
  ExecutionOptions,
  // 向后兼容的类型别名
  ExecutorConfig,
  RuntimeConfig
} from './types'

// === 便捷工厂函数 ===

import { LanguageModelV1Middleware } from 'ai'

import { type ProviderId, type ProviderSettingsMap } from '../../types'
import { type AiPlugin } from '../plugins'
import { RuntimeExecutor } from './executor'

/**
 * 创建运行时执行器 - 支持类型安全的已知provider
 */
export function createExecutor<T extends ProviderId>(
  providerId: T,
  options: ProviderSettingsMap[T],
  plugins?: AiPlugin[]
): RuntimeExecutor<T> {
  return RuntimeExecutor.create(providerId, options, plugins)
}

/**
 * 创建OpenAI Compatible执行器
 */
export function createOpenAICompatibleExecutor(
  options: ProviderSettingsMap['openai-compatible'],
  plugins: AiPlugin[] = []
): RuntimeExecutor<'openai-compatible'> {
  return RuntimeExecutor.createOpenAICompatible(options, plugins)
}

// === 直接调用API（无需创建executor实例）===

/**
 * 直接流式文本生成 - 支持middlewares
 */
export async function streamText<T extends ProviderId>(
  providerId: T,
  options: ProviderSettingsMap[T],
  modelId: string,
  params: Parameters<RuntimeExecutor<T>['streamText']>[1],
  plugins?: AiPlugin[],
  middlewares?: LanguageModelV1Middleware[]
): Promise<ReturnType<RuntimeExecutor<T>['streamText']>> {
  const executor = createExecutor(providerId, options, plugins)
  return executor.streamText(modelId, params, { middlewares })
}

/**
 * 直接生成文本 - 支持middlewares
 */
export async function generateText<T extends ProviderId>(
  providerId: T,
  options: ProviderSettingsMap[T],
  modelId: string,
  params: Parameters<RuntimeExecutor<T>['generateText']>[1],
  plugins?: AiPlugin[],
  middlewares?: LanguageModelV1Middleware[]
): Promise<ReturnType<RuntimeExecutor<T>['generateText']>> {
  const executor = createExecutor(providerId, options, plugins)
  return executor.generateText(modelId, params, { middlewares })
}

/**
 * 直接生成结构化对象 - 支持middlewares
 */
export async function generateObject<T extends ProviderId>(
  providerId: T,
  options: ProviderSettingsMap[T],
  modelId: string,
  params: Parameters<RuntimeExecutor<T>['generateObject']>[1],
  plugins?: AiPlugin[],
  middlewares?: LanguageModelV1Middleware[]
): Promise<ReturnType<RuntimeExecutor<T>['generateObject']>> {
  const executor = createExecutor(providerId, options, plugins)
  return executor.generateObject(modelId, params, { middlewares })
}

/**
 * 直接流式生成结构化对象 - 支持middlewares
 */
export async function streamObject<T extends ProviderId>(
  providerId: T,
  options: ProviderSettingsMap[T],
  modelId: string,
  params: Parameters<RuntimeExecutor<T>['streamObject']>[1],
  plugins?: AiPlugin[],
  middlewares?: LanguageModelV1Middleware[]
): Promise<ReturnType<RuntimeExecutor<T>['streamObject']>> {
  const executor = createExecutor(providerId, options, plugins)
  return executor.streamObject(modelId, params, { middlewares })
}

// === Agent 功能预留 ===
// 未来将在 ../agents/ 文件夹中添加：
// - AgentExecutor.ts
// - WorkflowManager.ts
// - ConversationManager.ts
// 并在此处导出相关API
