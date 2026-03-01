import type { ApiClient } from '@types'
import type { EmbeddingModel } from 'ai'
import { net } from 'electron'
import { createOllama } from 'ollama-ai-provider-v2'

import type { EmbeddingProvider, EmbeddingProviderOptions } from '../types'
import { EMBEDDING_PROVIDERS } from '../types'

/**
 * Ollama embedding provider
 */
export class OllamaProvider implements EmbeddingProvider {
  readonly providerId = EMBEDDING_PROVIDERS.OLLAMA

  createModel(client: ApiClient): EmbeddingModel<string> {
    const { baseURL, model } = client
    const ollamaProvider = createOllama({
      baseURL: baseURL?.trim() ? `${baseURL}/api` : undefined,
      fetch: net.fetch as typeof fetch
    })
    return ollamaProvider.embedding(model)
  }

  buildProviderOptions(dimensions?: number): EmbeddingProviderOptions {
    if (!dimensions) {
      return undefined
    }
    return {
      ollama: { dimensions }
    }
  }
}
