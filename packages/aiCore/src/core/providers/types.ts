import { type AnthropicProviderSettings } from '@ai-sdk/anthropic'
import { type AzureOpenAIProviderSettings } from '@ai-sdk/azure'
import { type DeepSeekProviderSettings } from '@ai-sdk/deepseek'
import { type GoogleGenerativeAIProviderSettings } from '@ai-sdk/google'
import { type OpenAIProviderSettings } from '@ai-sdk/openai'
import { type OpenAICompatibleProviderSettings } from '@ai-sdk/openai-compatible'
import {
  EmbeddingModelV2 as EmbeddingModel,
  ImageModelV2 as ImageModel,
  LanguageModelV2 as LanguageModel,
  ProviderV2,
  SpeechModelV2 as SpeechModel,
  TranscriptionModelV2 as TranscriptionModel
} from '@ai-sdk/provider'
import { type XaiProviderSettings } from '@ai-sdk/xai'

// 导入基于 Zod 的 ProviderId 类型
import { type ProviderId as ZodProviderId } from './schemas'

export interface ExtensibleProviderSettingsMap {
  // 基础的静态providers
  openai: OpenAIProviderSettings
  'openai-responses': OpenAIProviderSettings
  'openai-compatible': OpenAICompatibleProviderSettings
  anthropic: AnthropicProviderSettings
  google: GoogleGenerativeAIProviderSettings
  xai: XaiProviderSettings
  azure: AzureOpenAIProviderSettings
  deepseek: DeepSeekProviderSettings
}

// 动态扩展的provider类型注册表
export interface DynamicProviderRegistry {
  [key: string]: any
}

// 合并基础和动态provider类型
export type ProviderSettingsMap = ExtensibleProviderSettingsMap & DynamicProviderRegistry

// 错误类型
export class ProviderError extends Error {
  constructor(
    message: string,
    public providerId: string,
    public code?: string,
    public cause?: Error
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

// 动态ProviderId类型 - 基于 Zod Schema，支持运行时扩展和验证
export type ProviderId = ZodProviderId

export interface ProviderTypeRegistrar {
  registerProviderType<T extends string, S>(providerId: T, settingsType: S): void
  getProviderSettings<T extends string>(providerId: T): any
}

// 重新导出所有类型供外部使用
export type {
  AnthropicProviderSettings,
  AzureOpenAIProviderSettings,
  DeepSeekProviderSettings,
  GoogleGenerativeAIProviderSettings,
  OpenAICompatibleProviderSettings,
  OpenAIProviderSettings,
  XaiProviderSettings
}

export type AiSdkModel = LanguageModel | ImageModel | EmbeddingModel<string> | TranscriptionModel | SpeechModel

export type AiSdkModelType = 'text' | 'image' | 'embedding' | 'transcription' | 'speech'

export const METHOD_MAP = {
  text: 'languageModel',
  image: 'imageModel',
  embedding: 'textEmbeddingModel',
  transcription: 'transcriptionModel',
  speech: 'speechModel'
} as const satisfies Record<AiSdkModelType, keyof ProviderV2>

export type AiSdkModelMethodMap = Record<AiSdkModelType, keyof ProviderV2>

export type AiSdkModelReturnMap = {
  text: LanguageModel
  image: ImageModel
  embedding: EmbeddingModel<string>
  transcription: TranscriptionModel
  speech: SpeechModel
}

export type AiSdkMethodName<T extends AiSdkModelType> = (typeof METHOD_MAP)[T]

export type AiSdkModelReturn<T extends AiSdkModelType> = AiSdkModelReturnMap[T]
