/**
 * Hub Provider - 支持路由到多个底层provider
 *
 * 支持格式: hubId:providerId:modelId
 * 例如: aihubmix:anthropic:claude-3.5-sonnet
 */

import { ProviderV2 } from '@ai-sdk/provider'
import { customProvider } from 'ai'

import { globalRegistryManagement } from './RegistryManagement'
import type { AiSdkMethodName, AiSdkModelReturn, AiSdkModelType } from './types'

export interface HubProviderConfig {
  /** Hub的唯一标识符 */
  hubId: string
  /** 是否启用调试日志 */
  debug?: boolean
}

export class HubProviderError extends Error {
  constructor(
    message: string,
    public readonly hubId: string,
    public readonly providerId?: string,
    public readonly originalError?: Error
  ) {
    super(message)
    this.name = 'HubProviderError'
  }
}

/**
 * 解析Hub模型ID
 */
function parseHubModelId(modelId: string): { provider: string; actualModelId: string } {
  const parts = modelId.split(':')
  if (parts.length !== 2) {
    throw new HubProviderError(`Invalid hub model ID format. Expected "provider:modelId", got: ${modelId}`, 'unknown')
  }
  return {
    provider: parts[0],
    actualModelId: parts[1]
  }
}

/**
 * 创建Hub Provider
 */
export function createHubProvider(config: HubProviderConfig): ProviderV2 {
  const { hubId } = config

  function getTargetProvider(providerId: string): ProviderV2 {
    // 从全局注册表获取provider实例
    try {
      const provider = globalRegistryManagement.getProvider(providerId)
      if (!provider) {
        throw new HubProviderError(
          `Provider "${providerId}" is not initialized. Please call initializeProvider("${providerId}", options) first.`,
          hubId,
          providerId
        )
      }
      return provider
    } catch (error) {
      throw new HubProviderError(
        `Failed to get provider "${providerId}": ${error instanceof Error ? error.message : 'Unknown error'}`,
        hubId,
        providerId,
        error instanceof Error ? error : undefined
      )
    }
  }

  function resolveModel<T extends AiSdkModelType>(
    modelId: string,
    modelType: T,
    methodName: AiSdkMethodName<T>
  ): AiSdkModelReturn<T> {
    const { provider, actualModelId } = parseHubModelId(modelId)
    const targetProvider = getTargetProvider(provider)

    const fn = targetProvider[methodName] as (id: string) => AiSdkModelReturn<T>

    if (!fn) {
      throw new HubProviderError(`Provider "${provider}" does not support ${modelType}`, hubId, provider)
    }

    return fn(actualModelId)
  }

  return customProvider({
    fallbackProvider: {
      languageModel: (modelId: string) => resolveModel(modelId, 'text', 'languageModel'),
      textEmbeddingModel: (modelId: string) => resolveModel(modelId, 'embedding', 'textEmbeddingModel'),
      imageModel: (modelId: string) => resolveModel(modelId, 'image', 'imageModel'),
      transcriptionModel: (modelId: string) => resolveModel(modelId, 'transcription', 'transcriptionModel'),
      speechModel: (modelId: string) => resolveModel(modelId, 'speech', 'speechModel')
    }
  })
}
