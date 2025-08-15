import { type AnthropicProviderSettings } from '@ai-sdk/anthropic'
import { type AzureOpenAIProviderSettings } from '@ai-sdk/azure'
import { type DeepSeekProviderSettings } from '@ai-sdk/deepseek'
import { type GoogleGenerativeAIProviderSettings } from '@ai-sdk/google'
import { type OpenAIProviderSettings } from '@ai-sdk/openai'
import { type OpenAICompatibleProviderSettings } from '@ai-sdk/openai-compatible'
import { type XaiProviderSettings } from '@ai-sdk/xai'

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

/**
 * Provider 相关核心类型定义
 * 只定义必要的接口，其他类型直接使用 AI SDK
 */

// Provider 配置接口 - 支持灵活的创建方式
export interface ProviderConfig {
  id: string
  name: string

  // 方式一：直接提供 creator 函数（推荐用于自定义）
  creator?: (options: any) => any

  // 方式二：动态导入 + 函数名（用于包导入）
  import?: () => Promise<any>
  creatorFunctionName?: string

  // 图片生成支持
  supportsImageGeneration?: boolean
  imageCreator?: (options: any) => any

  // 可选的验证函数
  validateOptions?: (options: any) => boolean
}

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

// 动态ProviderId类型 - 支持运行时扩展
export type ProviderId = keyof ExtensibleProviderSettingsMap | string

// Provider类型注册工具
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
// 新的provider类型已经在上面直接export，不需要重复导出
