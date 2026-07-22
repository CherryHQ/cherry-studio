/**
 * Perplexity — in-house provider over the Agent API (`POST /v1/agent`).
 *
 * The legacy Sonar chat-completions endpoint (bare ids like `sonar` / `sonar-pro`)
 * is deprecated and no longer served, so every model routes through the Agent API
 * (`perplexity/sonar`, `openai/gpt-5.6-*`, `anthropic/claude-*`, …). The bespoke
 * `LanguageModelV3` lives in `./PerplexityAgentLanguageModel`.
 */
import { type LanguageModelV3, NoSuchModelError, type ProviderV3 } from '@ai-sdk/provider'
import { type FetchFunction, loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils'

import { PerplexityAgentLanguageModel } from './PerplexityAgentLanguageModel'

export const PERPLEXITY_PROVIDER_NAME = 'perplexity' as const

export interface PerplexityProviderSettings {
  apiKey?: string
  baseURL?: string
  headers?: Record<string, string>
  fetch?: FetchFunction
}

export interface PerplexityProvider extends ProviderV3 {
  (modelId: string): LanguageModelV3
  languageModel(modelId: string): LanguageModelV3
  chatModel(modelId: string): LanguageModelV3
}

export function createPerplexityProvider(settings: PerplexityProviderSettings = {}): PerplexityProvider {
  const baseURL = withoutTrailingSlash(settings.baseURL ?? 'https://api.perplexity.ai') as string
  const headers = () => ({
    Authorization: `Bearer ${loadApiKey({
      apiKey: settings.apiKey,
      environmentVariableName: 'PERPLEXITY_API_KEY',
      description: 'Perplexity'
    })}`,
    ...settings.headers
  })

  const createLanguageModel = (modelId: string): LanguageModelV3 =>
    new PerplexityAgentLanguageModel(modelId, { baseURL, headers, fetch: settings.fetch })

  const provider = (modelId: string) => createLanguageModel(modelId)
  provider.specificationVersion = 'v3' as const
  provider.languageModel = createLanguageModel
  provider.chatModel = createLanguageModel
  provider.embeddingModel = (modelId: string) => {
    throw new NoSuchModelError({ modelId, modelType: 'embeddingModel' })
  }
  provider.textEmbeddingModel = provider.embeddingModel
  provider.imageModel = (modelId: string) => {
    throw new NoSuchModelError({ modelId, modelType: 'imageModel' })
  }

  return provider as PerplexityProvider
}
