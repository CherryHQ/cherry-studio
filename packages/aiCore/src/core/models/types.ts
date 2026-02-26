/**
 * Creation 模块类型定义
 */
import type { JSONObject, LanguageModelV3Middleware } from '@ai-sdk/provider'

import type { CoreProviderSettingsMap, RegisteredProviderId } from '../providers/types'

/**
 * 模型配置
 *
 * @typeParam T - Provider ID 类型
 * @typeParam TSettingsMap - Provider Settings Map（默认 CoreProviderSettingsMap）
 */
export interface ModelConfig<
  T extends RegisteredProviderId | (string & {}) = RegisteredProviderId,
  TSettingsMap extends Record<string, any> = CoreProviderSettingsMap
> {
  providerId: T
  modelId: string
  providerSettings: TSettingsMap[T & keyof TSettingsMap]
  middlewares?: LanguageModelV3Middleware[]
  extraModelConfig?: JSONObject
}
