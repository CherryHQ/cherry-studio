/**
 * Runtime 层类型定义
 */
import type { ImageModelV3 } from '@ai-sdk/provider'
import type { generateImage, generateText, streamText } from 'ai'

import { type ModelConfig } from '../models/types'
import { type AiPlugin } from '../plugins'
import type { CoreProviderSettingsMap, RegisteredProviderId } from '../providers/types'

/**
 * 运行时执行器配置
 *
 * @typeParam T - Provider ID 类型
 * @typeParam TSettingsMap - Provider Settings Map（默认 CoreProviderSettingsMap）
 */
export interface RuntimeConfig<
  T extends RegisteredProviderId | (string & {}) = RegisteredProviderId,
  TSettingsMap extends Record<string, any> = CoreProviderSettingsMap
> {
  providerId: T
  providerSettings: ModelConfig<T, TSettingsMap>['providerSettings']
  plugins?: AiPlugin[]
}

export type generateImageParams = Omit<Parameters<typeof generateImage>[0], 'model'> & {
  model: string | ImageModelV3
}
export type generateTextParams = Parameters<typeof generateText>[0]
export type streamTextParams = Parameters<typeof streamText>[0]
