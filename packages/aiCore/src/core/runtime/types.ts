/**
 * Runtime 层类型定义
 */
import type { ImageModelV3, ProviderV3 } from '@ai-sdk/provider'
import type { generateImage, generateText, streamText } from 'ai'

import { type AiPlugin } from '../plugins'
import type { CoreProviderSettingsMap, StringKeys } from '../providers/types'

/**
 * 运行时执行器配置
 *
 * @typeParam TSettingsMap - Provider Settings Map（默认 CoreProviderSettingsMap）
 * @typeParam T - Provider ID 类型（从 TSettingsMap 的键推断）
 */
export interface RuntimeConfig<
  TSettingsMap extends Record<string, any> = CoreProviderSettingsMap,
  T extends StringKeys<TSettingsMap> = StringKeys<TSettingsMap>
> {
  providerId: T
  provider: ProviderV3
  providerSettings: TSettingsMap[T]
  plugins?: AiPlugin[]
}

export type generateImageParams = Omit<Parameters<typeof generateImage>[0], 'model'> & {
  model: string | ImageModelV3
}
export type generateTextParams = Parameters<typeof generateText>[0]
export type streamTextParams = Parameters<typeof streamText>[0]
