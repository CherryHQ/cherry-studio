/**
 * Hub Provider - 支持路由到多个底层provider
 *
 * 支持格式: hubId|providerId|modelId
 * @example aihubmix|anthropic|claude-3.5-sonnet
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
import { customProvider } from 'ai'

import type { ExtensionRegistry } from '../core/ExtensionRegistry'
import type { CoreProviderSettingsMap } from '../types'

/** Model ID 分隔符 */
export const DEFAULT_SEPARATOR = '|'

export interface HubProviderConfig {
  /** Hub的唯一标识符 */
  hubId?: string
  /** 是否启用调试日志 */
  debug?: boolean
  /** ExtensionRegistry实例（用于获取provider extensions） */
  registry: ExtensionRegistry
  /** Provider配置映射 */
  providerSettingsMap: Map<string, CoreProviderSettingsMap[keyof CoreProviderSettingsMap]>
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
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new HubProviderError(
      `Invalid hub model ID format. Expected "provider${DEFAULT_SEPARATOR}modelId", got: ${modelId}`,
      'unknown'
    )
  }
  return {
    provider: parts[0],
    actualModelId: parts[1]
  }
}

/**
 * 异步创建Hub Provider
 *
 * 预创建所有provider实例以满足AI SDK的同步要求
 * 通过ExtensionRegistry复用ProviderExtension的LRU缓存
 */
export async function createHubProviderAsync(config: HubProviderConfig): Promise<ProviderV3> {
  const { registry, providerSettingsMap, debug, hubId = 'hub' } = config

  // 预创建所有 provider 实例
  const providers = new Map<string, ProviderV3>()

  for (const [providerId, settings] of providerSettingsMap.entries()) {
    const extension = registry.get(providerId)
    if (!extension) {
      const availableExtensions = registry
        .getAll()
        .map((ext) => ext.config.name)
        .join(', ')
      throw new HubProviderError(
        `Provider extension "${providerId}" not found in registry. Available: ${availableExtensions}`,
        hubId,
        providerId
      )
    }

    try {
      // 通过 extension 创建 provider（复用 LRU 缓存）
      const provider = await extension.createProvider(settings)
      providers.set(providerId, provider)
    } catch (error) {
      throw new HubProviderError(
        `Failed to create provider "${providerId}": ${error instanceof Error ? error.message : String(error)}`,
        hubId,
        providerId,
        error instanceof Error ? error : undefined
      )
    }
  }
  return createHubProviderWithProviders(hubId, providers, debug)
}

/**
 * 内部函数：使用预创建的providers创建HubProvider
 */
function createHubProviderWithProviders(
  hubId: string,
  providers: Map<string, ProviderV3>,
  debug?: boolean
): ProviderV3 {
  function getTargetProvider(providerId: string): ProviderV3 {
    const provider = providers.get(providerId)
    if (!provider) {
      const availableProviders = Array.from(providers.keys()).join(', ')
      throw new HubProviderError(
        `Provider "${providerId}" not initialized. Available: ${availableProviders}`,
        hubId,
        providerId
      )
    }
    if (debug) {
      console.log(`[HubProvider:${hubId}] Routing to provider: ${providerId}`)
    }
    return provider
  }

  const hubFallbackProvider: ProviderV3 = {
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
