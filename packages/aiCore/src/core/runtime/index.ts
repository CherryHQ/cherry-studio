/**
 * Runtime 模块导出
 * 专注于运行时插件化AI调用处理
 */

// 主要的运行时执行器
export { RuntimeExecutor } from './executor'

// 导出类型
export type { RuntimeConfig } from './types'

// === 便捷工厂函数 ===

import { LanguageModelV2Middleware } from '@ai-sdk/provider'

import { type AiPlugin } from '../plugins'
import { type ProviderId, type ProviderSettingsMap } from '../providers/types'
import { RuntimeExecutor } from './executor'

/**
 * 创建运行时执行器 - 支持类型安全的已知provider
 */
export function createExecutor<T extends ProviderId>(
  providerId: T,
  options: ProviderSettingsMap[T] & { mode?: 'chat' | 'responses' },
  plugins?: AiPlugin[]
): RuntimeExecutor<T> {
  return RuntimeExecutor.create(providerId, options, plugins)
}

/**
 * 创建OpenAI Compatible执行器
 */
export function createOpenAICompatibleExecutor(
  options: ProviderSettingsMap['openai-compatible'] & { mode?: 'chat' | 'responses' },
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
  options: ProviderSettingsMap[T] & { mode?: 'chat' | 'responses' },
  params: Parameters<RuntimeExecutor<T>['streamText']>[0],
  plugins?: AiPlugin[],
  middlewares?: LanguageModelV2Middleware[]
): Promise<ReturnType<RuntimeExecutor<T>['streamText']>> {
  const executor = createExecutor(providerId, options, plugins)
  return executor.streamText(params, { middlewares })
}

/**
 * 直接生成文本 - 支持middlewares
 */
export async function generateText<T extends ProviderId>(
  providerId: T,
  options: ProviderSettingsMap[T] & { mode?: 'chat' | 'responses' },
  params: Parameters<RuntimeExecutor<T>['generateText']>[0],
  plugins?: AiPlugin[],
  middlewares?: LanguageModelV2Middleware[]
): Promise<ReturnType<RuntimeExecutor<T>['generateText']>> {
  const executor = createExecutor(providerId, options, plugins)
  return executor.generateText(params, { middlewares })
}

/**
 * 直接生成结构化对象 - 支持middlewares
 */
export async function generateObject<T extends ProviderId>(
  providerId: T,
  options: ProviderSettingsMap[T] & { mode?: 'chat' | 'responses' },
  params: Parameters<RuntimeExecutor<T>['generateObject']>[0],
  plugins?: AiPlugin[],
  middlewares?: LanguageModelV2Middleware[]
): Promise<ReturnType<RuntimeExecutor<T>['generateObject']>> {
  const executor = createExecutor(providerId, options, plugins)
  return executor.generateObject(params, { middlewares })
}

/**
 * 直接流式生成结构化对象 - 支持middlewares
 */
export async function streamObject<T extends ProviderId>(
  providerId: T,
  options: ProviderSettingsMap[T] & { mode?: 'chat' | 'responses' },
  params: Parameters<RuntimeExecutor<T>['streamObject']>[0],
  plugins?: AiPlugin[],
  middlewares?: LanguageModelV2Middleware[]
): Promise<ReturnType<RuntimeExecutor<T>['streamObject']>> {
  const executor = createExecutor(providerId, options, plugins)
  return executor.streamObject(params, { middlewares })
}

/**
 * 直接生成图像 - 支持middlewares
 */
export async function generateImage<T extends ProviderId>(
  providerId: T,
  options: ProviderSettingsMap[T] & { mode?: 'chat' | 'responses' },
  params: Parameters<RuntimeExecutor<T>['generateImage']>[0],
  plugins?: AiPlugin[]
): Promise<ReturnType<RuntimeExecutor<T>['generateImage']>> {
  const executor = createExecutor(providerId, options, plugins)
  return executor.generateImage(params)
}

// === Agent 功能预留 ===
// 未来将在 ../agents/ 文件夹中添加：
// - AgentExecutor.ts
// - WorkflowManager.ts
// - ConversationManager.ts
// 并在此处导出相关API
