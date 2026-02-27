/**
 * Creation 模块类型定义
 */
import type { JSONObject, LanguageModelV3Middleware } from '@ai-sdk/provider'

import type { ProviderId, ProviderSettingsMap } from '../providers/types'

export interface ModelConfig<T extends ProviderId = ProviderId> {
  providerId: T
  modelId: string
  providerSettings: ProviderSettingsMap[T] & { mode?: 'chat' | 'responses' }
  middlewares?: LanguageModelV3Middleware[]
  extraModelConfig?: JSONObject
}
