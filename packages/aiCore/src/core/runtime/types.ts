/**
 * Runtime 层类型定义
 */
import { ImageModelV2 } from '@ai-sdk/provider'
import { experimental_generateImage, generateObject, generateText, streamObject, streamText } from 'ai'

import { type ModelConfig } from '../models/types'
import { type AiPlugin } from '../plugins'
import { type ProviderId } from '../providers/types'

/**
 * 运行时执行器配置
 */
export interface RuntimeConfig<T extends ProviderId = ProviderId> {
  providerId: T
  providerSettings: ModelConfig<T>['providerSettings'] & { mode?: 'chat' | 'responses' }
  plugins?: AiPlugin[]
}

export type generateImageParams = Omit<Parameters<typeof experimental_generateImage>[0], 'model'> & {
  model: string | ImageModelV2
}
export type generateObjectParams = Parameters<typeof generateObject>[0]
export type generateTextParams = Parameters<typeof generateText>[0]
export type streamObjectParams = Parameters<typeof streamObject>[0]
export type streamTextParams = Parameters<typeof streamText>[0]
