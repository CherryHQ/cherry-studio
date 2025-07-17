/**
 * Provider 创建器
 * 负责动态导入 AI SDK providers 并创建基础模型实例
 */
import { ImageModelV2, type LanguageModelV2 } from '@ai-sdk/provider'

import { type ProviderId, type ProviderSettingsMap } from '../../types'
import { isOpenAIChatCompletionOnlyModel } from '../../utils/model'
import { aiProviderRegistry, type ProviderConfig } from '../providers/registry'

// 错误类型
export class ProviderCreationError extends Error {
  constructor(
    message: string,
    public providerId?: string,
    public cause?: Error
  ) {
    super(message)
    this.name = 'ProviderCreationError'
  }
}

/**
 * 创建基础 AI SDK 模型实例
 * 对于已知的 Provider 使用严格类型检查，未知的 Provider 默认使用 openai-compatible
 */
export async function createBaseModel<T extends ProviderId>({
  providerId,
  modelId,
  providerSettings,
  extraModelConfig
  // middlewares
}: {
  providerId: T
  modelId: string
  providerSettings: ProviderSettingsMap[T] & { mode?: 'chat' | 'responses' }
  extraModelConfig?: any
  // middlewares?: LanguageModelV1Middleware[]
}): Promise<LanguageModelV2>

export async function createBaseModel({
  providerId,
  modelId,
  providerSettings,
  extraModelConfig
  // middlewares
}: {
  providerId: string
  modelId: string
  providerSettings: ProviderSettingsMap['openai-compatible'] & { mode?: 'chat' | 'responses' }
  extraModelConfig?: any
  // middlewares?: LanguageModelV1Middleware[]
}): Promise<LanguageModelV2>

export async function createBaseModel({
  providerId,
  modelId,
  providerSettings,
  // middlewares,
  extraModelConfig
}: {
  providerId: string
  modelId: string
  providerSettings: ProviderSettingsMap[ProviderId] & { mode?: 'chat' | 'responses' }
  // middlewares?: LanguageModelV1Middleware[]
  extraModelConfig?: any
}): Promise<LanguageModelV2> {
  try {
    // 对于不在注册表中的 provider，默认使用 openai-compatible
    const effectiveProviderId = aiProviderRegistry.isSupported(providerId) ? providerId : 'openai-compatible'

    // 获取Provider配置
    const providerConfig = aiProviderRegistry.getProvider(effectiveProviderId)
    if (!providerConfig) {
      throw new ProviderCreationError(`Provider "${effectiveProviderId}" is not registered`, providerId)
    }

    // 动态导入模块
    const module = await providerConfig.import()

    // 获取创建函数
    const creatorFunction = module[providerConfig.creatorFunctionName]

    if (typeof creatorFunction !== 'function') {
      throw new ProviderCreationError(
        `Creator function "${providerConfig.creatorFunctionName}" not found in the imported module for provider "${effectiveProviderId}"`
      )
    }
    // TODO: 对openai 的 providerSettings.mode参数是否要删除,目前看没毛病
    // 创建provider实例
    let provider = creatorFunction(providerSettings)

    // 加一个特判
    if (providerConfig.id === 'openai') {
      if (
        'mode' in providerSettings &&
        providerSettings.mode === 'responses' &&
        !isOpenAIChatCompletionOnlyModel(modelId)
      ) {
        provider = provider.responses
      } else {
        provider = provider.chat
      }
    }
    // 返回模型实例
    if (typeof provider === 'function') {
      // extraModelConfig:例如google的useSearchGrounding
      const model: LanguageModelV2 = provider(modelId, extraModelConfig)

      // // 应用 AI SDK 中间件
      // if (middlewares && middlewares.length > 0) {
      //   model = wrapLanguageModel({
      //     model: model,
      //     middleware: middlewares
      //   })
      // }

      return model
    } else {
      throw new ProviderCreationError(`Unknown model access pattern for provider "${effectiveProviderId}"`)
    }
  } catch (error) {
    if (error instanceof ProviderCreationError) {
      throw error
    }
    throw new ProviderCreationError(
      `Failed to create base model for provider "${providerId}": ${error instanceof Error ? error.message : 'Unknown error'}`,
      providerId,
      error instanceof Error ? error : undefined
    )
  }
}

/**
 * 创建图像生成模型实例
 */
export async function createImageModel<T extends ProviderId>(
  providerId: T,
  modelId: string,
  options: ProviderSettingsMap[T]
): Promise<ImageModelV2>
export async function createImageModel(
  providerId: string,
  modelId: string,
  options: ProviderSettingsMap['openai-compatible']
): Promise<ImageModelV2>
export async function createImageModel(
  providerId: string,
  modelId: string = 'default',
  options: any
): Promise<ImageModelV2> {
  try {
    if (!aiProviderRegistry.isSupported(providerId)) {
      throw new ProviderCreationError(`Provider "${providerId}" is not supported`, providerId)
    }

    const providerConfig = aiProviderRegistry.getProvider(providerId)
    if (!providerConfig) {
      throw new ProviderCreationError(`Provider "${providerId}" is not registered`, providerId)
    }

    if (!providerConfig.supportsImageGeneration) {
      throw new ProviderCreationError(`Provider "${providerId}" does not support image generation`, providerId)
    }

    const module = await providerConfig.import()

    const creatorFunction = module[providerConfig.creatorFunctionName]

    if (typeof creatorFunction !== 'function') {
      throw new ProviderCreationError(
        `Creator function "${providerConfig.creatorFunctionName}" not found in the imported module for provider "${providerId}"`
      )
    }

    const provider = creatorFunction(options)

    if (provider && typeof provider.image === 'function') {
      return provider.image(modelId)
    } else {
      throw new ProviderCreationError(`Image model function not found for provider "${providerId}"`)
    }
  } catch (error) {
    if (error instanceof ProviderCreationError) {
      throw error
    }
    throw new ProviderCreationError(
      `Failed to create image model for provider "${providerId}": ${error instanceof Error ? error.message : 'Unknown error'}`,
      providerId,
      error instanceof Error ? error : undefined
    )
  }
}

/**
 * 获取支持的 Providers 列表
 */
export function getSupportedProviders(): Array<{
  id: string
  name: string
}> {
  return aiProviderRegistry.getAllProviders().map((provider: ProviderConfig) => ({
    id: provider.id,
    name: provider.name
  }))
}

/**
 * 获取 Provider 信息
 */
export function getProviderInfo(providerId: string): {
  id: string
  name: string
  isSupported: boolean
  effectiveProvider: string
} {
  const effectiveProviderId = aiProviderRegistry.isSupported(providerId) ? providerId : 'openai-compatible'
  const provider = aiProviderRegistry.getProvider(effectiveProviderId)

  return {
    id: providerId,
    name: provider?.name || providerId,
    isSupported: aiProviderRegistry.isSupported(providerId),
    effectiveProvider: effectiveProviderId
  }
}
