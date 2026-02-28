/**
 * Hub Provider - 支持路由到多个底层provider
 *
 * 支持格式: hubId:providerId:modelId
 * 例如: aihubmix:anthropic:claude-3.5-sonnet
 */

import type {
  EmbeddingModelV3,
  ImageModelV3,
  LanguageModelV3,
  ProviderV3,
  RerankingModelV3,
  SpeechModelV3,
  TranscriptionModelV3
} from '@ai-sdk/provider'
import { customProvider, wrapProvider } from 'ai'

import { DEFAULT_SEPARATOR, globalRegistryManagement } from './RegistryManagement'
import type { AiSdkProvider } from './types'

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
  const parts = modelId.split(DEFAULT_SEPARATOR)
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
export function createHubProvider(config: HubProviderConfig): AiSdkProvider {
  const { hubId } = config

  function getTargetProvider(providerId: string): ProviderV3 {
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
      // 使用 wrapProvider 确保返回的是 V3 provider
      // 这样可以自动处理 V2 provider 到 V3 的转换
      return wrapProvider({ provider, languageModelMiddleware: [] })
    } catch (error) {
      throw new HubProviderError(
        `Failed to get provider "${providerId}": ${error instanceof Error ? error.message : 'Unknown error'}`,
        hubId,
        providerId,
        error instanceof Error ? error : undefined
      )
    }
  }

  // 创建符合 ProviderV3 规范的 fallback provider
  const hubFallbackProvider = {
    specificationVersion: 'v3' as const,

    languageModel: (modelId: string): LanguageModelV3 => {
      const { provider, actualModelId } = parseHubModelId(modelId)
      const targetProvider = getTargetProvider(provider)
      return targetProvider.languageModel(actualModelId)
    },

    embeddingModel: (modelId: string): EmbeddingModelV3 => {
      const { provider, actualModelId } = parseHubModelId(modelId)
      const targetProvider = getTargetProvider(provider)
      return targetProvider.embeddingModel(actualModelId)
    },

    imageModel: (modelId: string): ImageModelV3 => {
      const { provider, actualModelId } = parseHubModelId(modelId)
      const targetProvider = getTargetProvider(provider)
      return targetProvider.imageModel(actualModelId)
    },

    transcriptionModel: (modelId: string): TranscriptionModelV3 => {
      const { provider, actualModelId } = parseHubModelId(modelId)
      const targetProvider = getTargetProvider(provider)

      if (!targetProvider.transcriptionModel) {
        throw new HubProviderError(`Provider "${provider}" does not support transcription models`, hubId, provider)
      }

      return targetProvider.transcriptionModel(actualModelId)
    },

    speechModel: (modelId: string): SpeechModelV3 => {
      const { provider, actualModelId } = parseHubModelId(modelId)
      const targetProvider = getTargetProvider(provider)

      if (!targetProvider.speechModel) {
        throw new HubProviderError(`Provider "${provider}" does not support speech models`, hubId, provider)
      }

      return targetProvider.speechModel(actualModelId)
    },
    rerankingModel: (modelId: string): RerankingModelV3 => {
      const { provider, actualModelId } = parseHubModelId(modelId)
      const targetProvider = getTargetProvider(provider)

      if (!targetProvider.rerankingModel) {
        throw new HubProviderError(`Provider "${provider}" does not support reranking models`, hubId, provider)
      }

      return targetProvider.rerankingModel(actualModelId)
    }
  }

  return customProvider({
    fallbackProvider: hubFallbackProvider
  })
}
