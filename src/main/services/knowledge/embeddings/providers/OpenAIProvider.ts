import { createOpenAI } from '@ai-sdk/openai'
import type { ApiClient } from '@types'
import type { EmbeddingModel } from 'ai'
import { net } from 'electron'

import type { EmbeddingProvider, EmbeddingProviderOptions } from '../types'
import { EMBEDDING_PROVIDERS } from '../types'

/**
 * OpenAI embedding provider
 */
export class OpenAIProvider implements EmbeddingProvider {
  readonly providerId = EMBEDDING_PROVIDERS.OPENAI

  createModel(client: ApiClient): EmbeddingModel<string> {
    const { apiKey, baseURL, model, provider } = client
    const openaiProvider = createOpenAI({
      apiKey,
      baseURL: baseURL?.trim() ? baseURL : undefined,
      fetch: net.fetch as typeof fetch,
      name: provider
    })
    return openaiProvider.embedding(model)
  }

  buildProviderOptions(dimensions?: number): EmbeddingProviderOptions {
    if (!dimensions) {
      return undefined
    }
    return {
      openai: { dimensions }
    }
  }
}
