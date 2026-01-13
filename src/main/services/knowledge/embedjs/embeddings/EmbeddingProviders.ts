import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { loggerService } from '@logger'
import type { ApiClient } from '@types'
import type { EmbeddingModel } from 'ai'
import { net } from 'electron'
import { createOllama } from 'ollama-ai-provider-v2'

const logger = loggerService.withContext('Embeddings')

export type EmbeddingProviderOptions = Record<string, { dimensions: number }> | undefined

export interface EmbeddingProvider {
  createModel(client: ApiClient): EmbeddingModel<string>
  buildProviderOptions(dimensions?: number): EmbeddingProviderOptions
}

export function resolveEmbeddingProvider(client: ApiClient): EmbeddingProvider {
  if (client.provider === 'openai') {
    return new OpenAIProvider()
  }
  if (client.provider === 'ollama') {
    return new OllamaProvider()
  }
  return new OpenAICompatibleProvider(client.provider)
}

class OpenAIProvider implements EmbeddingProvider {
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

class OpenAICompatibleProvider implements EmbeddingProvider {
  constructor(private readonly providerId: string) {}

  createModel(client: ApiClient): EmbeddingModel<string> {
    const { apiKey, baseURL, model, provider } = client

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
      [this.providerId]: { dimensions }
    }
  }
}

class OllamaProvider implements EmbeddingProvider {
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
