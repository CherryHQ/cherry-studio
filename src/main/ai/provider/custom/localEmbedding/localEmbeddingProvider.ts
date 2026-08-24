import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3, ProviderV3 } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import { LOCAL_EMBEDDING_PROVIDER_ID } from '@shared/data/presets/localEmbedding'

import { embedTexts } from './localEmbeddingRuntime'

/**
 * `EmbeddingModelV3` backed by the in-process transformers.js runtime. Pooling
 * and normalization live in `localEmbeddingRuntime`; this is a thin AI SDK adapter.
 */
class LocalEmbeddingModel implements EmbeddingModelV3 {
  readonly specificationVersion = 'v3'
  readonly provider = LOCAL_EMBEDDING_PROVIDER_ID
  readonly modelId: string
  /** No hard cap — we iterate internally; this only sizes SDK-side batching. */
  readonly maxEmbeddingsPerCall = 2048
  /** A single shared in-process pipeline → no benefit from parallel calls. */
  readonly supportsParallelCalls = false

  constructor(modelId: string) {
    this.modelId = modelId
  }

  async doEmbed(
    options: Parameters<EmbeddingModelV3['doEmbed']>[0]
  ): Promise<Awaited<ReturnType<EmbeddingModelV3['doEmbed']>>> {
    const embeddings = await embedTexts(options.values, options.abortSignal)
    return { embeddings, warnings: [] }
  }
}

export interface LocalEmbeddingProviderSettings {
  /** In-process, no auth — accepted for type symmetry with other extensions. */
  apiKey?: string
  /**
   * Unused in-process (no HTTP), but the shared provider config builder does
   * `config.providerSettings.fetch ??= customFetch` across the settings union,
   * so every member must carry this field. See `provider/config.ts`.
   */
  fetch?: FetchFunction
}

/**
 * Embedding-only `ProviderV3`. Language / image models throw, since this
 * provider exists solely to serve the knowledge base's local text embeddings.
 */
// `_settings` is unused (in-process provider, no config) but its type is how the
// extension registry infers this provider's settings type — keep the parameter.
// oxlint-disable-next-line no-unused-vars
export function createLocalEmbeddingProvider(_settings: LocalEmbeddingProviderSettings = {}): ProviderV3 {
  const embeddingModel = (modelId: string): EmbeddingModelV3 => new LocalEmbeddingModel(modelId)
  const unsupported = (capability: string) => (): never => {
    throw new Error(`local-embedding provider only supports text embeddings, not ${capability}`)
  }

  return {
    specificationVersion: 'v3',
    embeddingModel,
    textEmbeddingModel: embeddingModel,
    languageModel: unsupported('language models') as (modelId: string) => LanguageModelV3,
    imageModel: unsupported('image models') as (modelId: string) => ImageModelV3
  }
}
