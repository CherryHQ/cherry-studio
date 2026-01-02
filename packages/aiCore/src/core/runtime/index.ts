/**
 * Runtime 模块导出
 * 专注于运行时插件化AI调用处理
 */

// 主要的运行时执行器
export { RuntimeExecutor } from './executor'

// 导出类型
export type { EmbedManyParams, EmbedManyResult, RuntimeConfig } from './types'

// === 便捷工厂函数 ===

import type { LanguageModelV3Middleware } from '@ai-sdk/provider'

import { type AiPlugin } from '../plugins'
import { extensionRegistry } from '../providers'
import { type CoreProviderSettingsMap, type StringKeys } from '../providers/types'
import { RuntimeExecutor } from './executor'

/**
 * 创建运行时执行器 - 支持类型安全的已知provider
 * 自动确保 provider 已初始化
 */
export async function createExecutor<
  TSettingsMap extends Record<string, any> = CoreProviderSettingsMap,
  T extends StringKeys<TSettingsMap> = StringKeys<TSettingsMap>
>(providerId: T, options: TSettingsMap[T], plugins?: AiPlugin[]): Promise<RuntimeExecutor<TSettingsMap, T>> {
  if (!extensionRegistry.has(providerId)) {
    throw new Error(`Provider extension "${providerId}" not registered`)
  }

  const provider = await extensionRegistry.createProvider(providerId, options || {})
  return RuntimeExecutor.create<TSettingsMap, T>(providerId, provider, options, plugins)
}

/**
 * 直接流式文本生成 - 支持middlewares
 */
export async function streamText<
  TSettingsMap extends Record<string, any> = CoreProviderSettingsMap,
  T extends StringKeys<TSettingsMap> = StringKeys<TSettingsMap>
>(
  providerId: T,
  options: TSettingsMap[T],
  params: Parameters<RuntimeExecutor<TSettingsMap, T>['streamText']>[0],
  plugins?: AiPlugin[],
  middlewares?: LanguageModelV3Middleware[]
): Promise<ReturnType<RuntimeExecutor<TSettingsMap, T>['streamText']>> {
  const executor = await createExecutor<TSettingsMap, T>(providerId, options, plugins)
  return executor.streamText(params, { middlewares })
}

/**
 * 直接生成文本 - 支持middlewares
 */
export async function generateText<
  TSettingsMap extends Record<string, any> = CoreProviderSettingsMap,
  T extends StringKeys<TSettingsMap> = StringKeys<TSettingsMap>
>(
  providerId: T,
  options: TSettingsMap[T],
  params: Parameters<RuntimeExecutor<TSettingsMap, T>['generateText']>[0],
  plugins?: AiPlugin[],
  middlewares?: LanguageModelV3Middleware[]
): Promise<ReturnType<RuntimeExecutor<TSettingsMap, T>['generateText']>> {
  const executor = await createExecutor<TSettingsMap, T>(providerId, options, plugins)
  return executor.generateText(params, { middlewares })
}

/**
 * 直接生成图像 - 支持middlewares
 */
export async function generateImage<
  TSettingsMap extends Record<string, any> = CoreProviderSettingsMap,
  T extends StringKeys<TSettingsMap> = StringKeys<TSettingsMap>
>(
  providerId: T,
  options: TSettingsMap[T],
  params: Parameters<RuntimeExecutor<TSettingsMap, T>['generateImage']>[0],
  plugins?: AiPlugin[]
): Promise<ReturnType<RuntimeExecutor<TSettingsMap, T>['generateImage']>> {
  const executor = await createExecutor<TSettingsMap, T>(providerId, options, plugins)
  return executor.generateImage(params)
}

/**
 * 直接批量嵌入文本
 * AI SDK v6 只有 embedMany，没有 embed
 */
export async function embedMany<
  TSettingsMap extends Record<string, any> = CoreProviderSettingsMap,
  T extends StringKeys<TSettingsMap> = StringKeys<TSettingsMap>
>(
  providerId: T,
  options: TSettingsMap[T],
  params: Parameters<RuntimeExecutor<TSettingsMap, T>['embedMany']>[0],
  plugins?: AiPlugin[]
): Promise<ReturnType<RuntimeExecutor<TSettingsMap, T>['embedMany']>> {
  const executor = await createExecutor<TSettingsMap, T>(providerId, options, plugins)
  return executor.embedMany(params)
}

/**
 * 创建 OpenAI Compatible 执行器
 */
export async function createOpenAICompatibleExecutor(
  options: CoreProviderSettingsMap['openai-compatible'],
  plugins?: AiPlugin[]
): Promise<RuntimeExecutor<CoreProviderSettingsMap, 'openai-compatible'>> {
  const provider = await extensionRegistry.createProvider('openai-compatible', options)

  return RuntimeExecutor.createOpenAICompatible(provider, options, plugins)
}

// === Agent 功能预留 ===
// 未来将在 ../agents/ 文件夹中添加：
// - AgentExecutor.ts
// - WorkflowManager.ts
// - ConversationManager.ts
// 并在此处导出相关API
