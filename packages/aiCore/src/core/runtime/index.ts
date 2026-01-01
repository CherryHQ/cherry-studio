/**
 * Runtime 模块导出
 * 专注于运行时插件化AI调用处理
 */

// 主要的运行时执行器
export { RuntimeExecutor } from './executor'

// 导出类型
export type { RuntimeConfig } from './types'

// === 便捷工厂函数 ===

import type { LanguageModelV3Middleware } from '@ai-sdk/provider'

import { type AiPlugin } from '../plugins'
import { extensionRegistry, globalProviderStorage } from '../providers'
import { type CoreProviderSettingsMap, type RegisteredProviderId } from '../providers/types'
import { RuntimeExecutor } from './executor'

/**
 * 创建运行时执行器 - 支持类型安全的已知provider
 * 自动确保 provider 已初始化
 */
export async function createExecutor<T extends RegisteredProviderId & keyof CoreProviderSettingsMap>(
  providerId: T,
  options: CoreProviderSettingsMap[T],
  plugins?: AiPlugin[]
): Promise<RuntimeExecutor<T>>
export async function createExecutor<T extends string>(
  providerId: T,
  options: any,
  plugins?: AiPlugin[]
): Promise<RuntimeExecutor<T>>
export async function createExecutor(
  providerId: string,
  options: any,
  plugins?: AiPlugin[]
): Promise<RuntimeExecutor<string>> {
  // 确保 provider 已初始化
  if (!globalProviderStorage.has(providerId) && extensionRegistry.has(providerId)) {
    try {
      await extensionRegistry.createProvider(providerId, options || {}, providerId)
    } catch (error) {
      // 创建失败会在 ModelResolver 抛出更详细的错误
      console.warn(`Failed to auto-initialize provider "${providerId}":`, error)
    }
  }

  return RuntimeExecutor.create(providerId as RegisteredProviderId, options, plugins)
}

// === 直接调用API（无需创建executor实例）===

/**
 * 直接流式文本生成 - 支持middlewares
 */
export async function streamText<T extends RegisteredProviderId & keyof CoreProviderSettingsMap>(
  providerId: T,
  options: CoreProviderSettingsMap[T],
  params: Parameters<RuntimeExecutor<T>['streamText']>[0],
  plugins?: AiPlugin[],
  middlewares?: LanguageModelV3Middleware[]
): Promise<ReturnType<RuntimeExecutor<T>['streamText']>> {
  const executor = await createExecutor(providerId, options, plugins)
  return executor.streamText(params, { middlewares })
}

/**
 * 直接生成文本 - 支持middlewares
 */
export async function generateText<T extends RegisteredProviderId & keyof CoreProviderSettingsMap>(
  providerId: T,
  options: CoreProviderSettingsMap[T],
  params: Parameters<RuntimeExecutor<T>['generateText']>[0],
  plugins?: AiPlugin[],
  middlewares?: LanguageModelV3Middleware[]
): Promise<ReturnType<RuntimeExecutor<T>['generateText']>> {
  const executor = await createExecutor(providerId, options, plugins)
  return executor.generateText(params, { middlewares })
}

/**
 * 直接生成图像 - 支持middlewares
 */
export async function generateImage<T extends RegisteredProviderId & keyof CoreProviderSettingsMap>(
  providerId: T,
  options: CoreProviderSettingsMap[T],
  params: Parameters<RuntimeExecutor<T>['generateImage']>[0],
  plugins?: AiPlugin[]
): Promise<ReturnType<RuntimeExecutor<T>['generateImage']>> {
  const executor = await createExecutor(providerId, options, plugins)
  return executor.generateImage(params)
}

/**
 * 创建 OpenAI Compatible 执行器
 */
export function createOpenAICompatibleExecutor(
  options: CoreProviderSettingsMap['openai-compatible'],
  plugins?: AiPlugin[]
): RuntimeExecutor<'openai-compatible'> {
  return RuntimeExecutor.createOpenAICompatible(options, plugins)
}

// === Agent 功能预留 ===
// 未来将在 ../agents/ 文件夹中添加：
// - AgentExecutor.ts
// - WorkflowManager.ts
// - ConversationManager.ts
// 并在此处导出相关API
