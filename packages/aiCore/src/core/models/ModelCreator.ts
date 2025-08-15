/**
 * Model Creator
 * 负责基于 Provider 创建 AI SDK 的 Language Model 和 Image Model 实例
 */
import { ImageModelV2, type LanguageModelV2 } from '@ai-sdk/provider'

import { isOpenAIChatCompletionOnlyModel } from '../../utils/model'
import { createImageProvider, createProvider } from '../providers/creator'
import { aiProviderRegistry } from '../providers/registry'
import { type ProviderId, type ProviderSettingsMap } from '../providers/types'

// 错误类型
export class ModelCreationError extends Error {
  constructor(
    message: string,
    public providerId?: string,
    public cause?: Error
  ) {
    super(message)
    this.name = 'ModelCreationError'
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
}: {
  providerId: T
  modelId: string
  providerSettings: ProviderSettingsMap[T] & { mode?: 'chat' | 'responses' }
  extraModelConfig?: any
}): Promise<LanguageModelV2>

export async function createBaseModel({
  providerId,
  modelId,
  providerSettings,
  extraModelConfig
}: {
  providerId: string
  modelId: string
  providerSettings: ProviderSettingsMap['openai-compatible'] & { mode?: 'chat' | 'responses' }
  extraModelConfig?: any
}): Promise<LanguageModelV2>

export async function createBaseModel({
  providerId,
  modelId,
  providerSettings,
  extraModelConfig
}: {
  providerId: string
  modelId: string
  providerSettings: ProviderSettingsMap[ProviderId] & { mode?: 'chat' | 'responses' }
  extraModelConfig?: any
}): Promise<LanguageModelV2> {
  try {
    // 获取Provider配置
    const providerConfig = aiProviderRegistry.getProvider(providerId)
    if (!providerConfig) {
      throw new ModelCreationError(`Provider "${providerId}" is not registered`, providerId)
    }

    // 创建 provider 实例
    const provider = await createProvider(providerConfig, providerSettings)

    // 根据 provider 类型处理特殊逻辑
    const finalProvider = handleProviderSpecificLogic(provider, providerConfig.id, providerSettings, modelId)

    // 创建模型实例
    if (typeof finalProvider === 'function') {
      const model: LanguageModelV2 = finalProvider(modelId, extraModelConfig)
      return model
    } else {
      throw new ModelCreationError(`Unknown model access pattern for provider "${providerId}"`)
    }
  } catch (error) {
    if (error instanceof ModelCreationError) {
      throw error
    }
    throw new ModelCreationError(
      `Failed to create base model for provider "${providerId}": ${error instanceof Error ? error.message : 'Unknown error'}`,
      providerId,
      error instanceof Error ? error : undefined
    )
  }
}

/**
 * 处理特定 Provider 的逻辑
 */
function handleProviderSpecificLogic(provider: any, providerId: string, providerSettings: any, modelId: string): any {
  // OpenAI 特殊处理
  if (providerId === 'openai') {
    if (
      'mode' in providerSettings &&
      providerSettings.mode === 'responses' &&
      !isOpenAIChatCompletionOnlyModel(modelId)
    ) {
      return provider.responses
    } else {
      return provider.chat
    }
  }

  // 其他 provider 直接返回
  return provider
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
      throw new ModelCreationError(`Provider "${providerId}" is not supported`, providerId)
    }

    const providerConfig = aiProviderRegistry.getProvider(providerId)
    if (!providerConfig) {
      throw new ModelCreationError(`Provider "${providerId}" is not registered`, providerId)
    }

    if (!providerConfig.supportsImageGeneration) {
      throw new ModelCreationError(`Provider "${providerId}" does not support image generation`, providerId)
    }

    // 创建图像 provider 实例
    const provider = await createImageProvider(providerConfig, options)

    if (provider && typeof provider.image === 'function') {
      return provider.image(modelId)
    } else {
      throw new ModelCreationError(`Image model function not found for provider "${providerId}"`)
    }
  } catch (error) {
    if (error instanceof ModelCreationError) {
      throw error
    }
    throw new ModelCreationError(
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
  return aiProviderRegistry.getAllProviders().map((provider) => ({
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
