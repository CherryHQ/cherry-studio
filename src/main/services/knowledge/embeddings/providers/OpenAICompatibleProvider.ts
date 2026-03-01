import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { loggerService } from '@logger'
import type { ApiClient } from '@types'
import type { EmbeddingModel } from 'ai'
import { net } from 'electron'

import type { EmbeddingProvider, EmbeddingProviderOptions } from '../types'
import { EMBEDDING_PROVIDERS } from '../types'

const logger = loggerService.withContext('OpenAICompatibleProvider')

/**
 * OpenAI-compatible embedding provider for generic providers
 * Used as fallback for providers not explicitly registered
 */
export class OpenAICompatibleProvider implements EmbeddingProvider {
  readonly providerId = EMBEDDING_PROVIDERS.OPENAI_COMPATIBLE

  private currentProviderId: string = EMBEDDING_PROVIDERS.OPENAI_COMPATIBLE

  createModel(client: ApiClient): EmbeddingModel<string> {
    const { apiKey, baseURL, model, provider } = client

    this.currentProviderId = provider

    if (!baseURL?.trim()) {
      logger.warn('Embedding provider baseURL is missing; defaulting to OpenAI base URL', {
        provider,
        model
      })
    }

    const compatibleProvider = createOpenAICompatible({
      apiKey,
      baseURL: baseURL?.trim() ? `${baseURL}/v1` : 'https://api.openai.com/v1',
      fetch: net.fetch as typeof fetch,
      name: provider
    })
    return compatibleProvider.textEmbeddingModel(model)
  }

  buildProviderOptions(dimensions?: number): EmbeddingProviderOptions {
    if (!dimensions) {
      return undefined
    }
    return {
      'openai-compatible': { dimensions },
      [this.currentProviderId]: { dimensions }
    }
  }
}
