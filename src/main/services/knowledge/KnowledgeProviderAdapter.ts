/**
 * Knowledge Provider Adapter
 *
 * Adapts KnowledgeBase configuration to API client parameters.
 *
 * TODO: [DataApi Migration] This adapter currently depends on Redux for
 * provider/model configuration. Once providers and models are available
 * via DataApi, this should be refactored to use DataApi instead of reduxService.
 */

import { loggerService } from '@logger'
import { reduxService } from '@main/services/ReduxService'
import { DataApiErrorFactory, ErrorCode } from '@shared/data/api'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { ModelMeta } from '@shared/data/types/meta'
import type { ApiClient, KnowledgeBaseParams, Provider } from '@types'
import { SystemProviderIds } from '@types'

const logger = loggerService.withContext('KnowledgeProviderAdapter')

const SEARCH_ENDPOINTS = ['chat/completions', 'responses', 'messages', 'generateContent', 'streamGenerateContent']

export class KnowledgeProviderAdapter {
  private static instance: KnowledgeProviderAdapter

  private constructor() {}

  public static getInstance(): KnowledgeProviderAdapter {
    if (!KnowledgeProviderAdapter.instance) {
      KnowledgeProviderAdapter.instance = new KnowledgeProviderAdapter()
    }
    return KnowledgeProviderAdapter.instance
  }

  public async buildBaseParams(
    base: KnowledgeBase,
    field: 'embeddingModelId' | 'rerankModelId'
  ): Promise<KnowledgeBaseParams> {
    const embedApiClient = await this.resolveApiClient(
      base.embeddingModelId,
      base.embeddingModelMeta,
      'embeddingModelId'
    )

    const rerankApiClient =
      field === 'rerankModelId' && base.rerankModelId
        ? await this.resolveApiClient(base.rerankModelId, base.rerankModelMeta, 'rerankModelId')
        : undefined

    if (field === 'rerankModelId' && !rerankApiClient) {
      throw DataApiErrorFactory.validation({ rerankModelId: ['Rerank model is not configured'] })
    }

    return {
      id: base.id,
      dimensions: base.embeddingModelMeta?.dimensions,
      chunkSize: base.chunkSize,
      chunkOverlap: base.chunkOverlap,
      embedApiClient,
      rerankApiClient
    }
  }

  private async resolveApiClient(
    modelId: string,
    modelMeta: KnowledgeBase['embeddingModelMeta'] | ModelMeta | undefined,
    field: 'embeddingModelId' | 'rerankModelId'
  ): Promise<ApiClient> {
    if (!modelId?.trim()) {
      throw DataApiErrorFactory.validation({ [field]: ['Model id is required'] })
    }

    const { providerId, resolvedModelId } = this.parseModelId(modelId, modelMeta?.provider)

    if (!providerId) {
      throw DataApiErrorFactory.validation({ [field]: ['Provider is required'] })
    }

    const providers = await this.getProviders()
    const provider = providers.find((item) => item.id === providerId)

    if (!provider) {
      throw DataApiErrorFactory.validation({ [field]: [`Provider '${providerId}' is not configured`] })
    }

    const baseURL = this.resolveProviderBaseUrl(provider)

    if (!baseURL) {
      throw DataApiErrorFactory.create(ErrorCode.SERVICE_UNAVAILABLE, `Provider '${providerId}' base URL is missing`)
    }

    return {
      model: resolvedModelId,
      provider: provider.id,
      apiKey: provider.apiKey || 'secret',
      baseURL
    }
  }

  private parseModelId(modelId: string, metaProvider?: string): { providerId?: string; resolvedModelId: string } {
    if (modelId.includes(':')) {
      const [providerId, ...rest] = modelId.split(':')
      return { providerId, resolvedModelId: rest.join(':') }
    }

    return { providerId: metaProvider, resolvedModelId: modelId }
  }

  private resolveProviderBaseUrl(provider: Provider): string {
    let baseURL = this.normalizeBaseUrl(provider.apiHost || '')

    if (provider.type === 'gemini') {
      baseURL = `${baseURL}/openai`
    }

    if (provider.type === 'azure-openai') {
      baseURL = `${baseURL}/v1`
    }

    if (provider.id === SystemProviderIds.ollama) {
      baseURL = baseURL.replace(/\/api$/, '')
    }

    return baseURL
  }

  private normalizeBaseUrl(apiHost: string): string {
    const trimmedHost = apiHost.trim()
    if (!trimmedHost) return ''

    if (!trimmedHost.endsWith('#')) {
      return trimmedHost.replace(/\/+$/, '')
    }

    const host = trimmedHost.slice(0, -1)
    const endpointMatch = SEARCH_ENDPOINTS.find((endpoint) => host.endsWith(endpoint))
    const baseSegment = endpointMatch ? host.slice(0, host.length - endpointMatch.length) : host
    return baseSegment.replace(/\/+$/, '').replace(/:$/, '')
  }

  // TODO: [DataApi Migration] Replace with DataApi call once providers are migrated
  private async getProviders(): Promise<Provider[]> {
    try {
      const providers = await reduxService.select('state.llm.providers')
      if (!Array.isArray(providers)) {
        return []
      }
      return providers as Provider[]
    } catch (error) {
      logger.error('Failed to resolve providers from Redux', error as Error)
      return []
    }
  }
}

export const knowledgeProviderAdapter = KnowledgeProviderAdapter.getInstance()
